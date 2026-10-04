import { describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import dnsPacket from 'dns-packet';
import { PORTAL_ADRESSE, portalNetzEingerichtet } from '../portal/adresse.js';
import { Leases, TYP, beantworte, leseAnfrage, DhcpDienst } from '../portal/dhcp.js';
import { DnsDienst, beantworteDns } from '../portal/dns.js';
import { bauePortal } from '../portal/http.js';
import { Portalsteuerung, portalSoll } from '../portal/steuerung.js';

/*
 * Das Captive Portal ist ein Test-Schalter: Ist er aus und das Netz nicht
 * eingerichtet, darf sich an der Box nichts aendern. Ist er an, muss jedes
 * Handy beim WLAN-Beitritt bei der Galerie landen - und nie "Internet ok"
 * hoeren, damit es fuer alles andere bei den mobilen Daten bleibt.
 */

/** Eine DHCP-Anfrage, wie sie ein Handy schickt. */
function dhcpPaket(typ: number, mac: number[], opt: { gewuenscht?: string; server?: string; ciaddr?: string } = {}): Buffer {
  const kopf = Buffer.alloc(240);
  kopf[0] = 1;
  kopf[1] = 1;
  kopf[2] = 6;
  kopf.writeUInt32BE(0x12345678, 4);
  kopf.writeUInt16BE(0x8000, 10);
  if (opt.ciaddr) Buffer.from(opt.ciaddr.split('.').map(Number)).copy(kopf, 12);
  Buffer.from(mac).copy(kopf, 28);
  kopf.writeUInt32BE(0x63825363, 236);
  const o: number[] = [53, 1, typ];
  if (opt.gewuenscht) o.push(50, 4, ...opt.gewuenscht.split('.').map(Number));
  if (opt.server) o.push(54, 4, ...opt.server.split('.').map(Number));
  o.push(255);
  return Buffer.concat([kopf, Buffer.from(o)]);
}

/** Optionen einer Antwort als Karte Code -> Bytes. */
function optionen(paket: Buffer): Map<number, number[]> {
  const karte = new Map<number, number[]>();
  let i = 240;
  while (i < paket.length && paket[i] !== 255) {
    const laenge = paket[i + 1]!;
    karte.set(paket[i]!, [...paket.subarray(i + 2, i + 2 + laenge)]);
    i += 2 + laenge;
  }
  return karte;
}

const MAC_A = [0x02, 0, 0, 0, 0, 0xa1];
const MAC_B = [0x02, 0, 0, 0, 0, 0xb2];
const box = PORTAL_ADRESSE.split('.').map(Number);

describe('Adressdienst (DHCP)', () => {
  it('bietet eine Adresse an - mit der Box als Gateway und DNS', () => {
    const leases = new Leases();
    const e = beantworte(leseAnfrage(dhcpPaket(TYP.DISCOVER, MAC_A))!, leases, 0);
    expect(e.art).toBe('antwort');
    if (e.art !== 'antwort') return;
    const p = e.antwort.paket;
    expect([...p.subarray(16, 20)].join('.')).toBe('192.168.254.100');
    const o = optionen(p);
    expect(o.get(53)).toEqual([TYP.OFFER]);
    expect(o.get(3)).toEqual(box);
    expect(o.get(6)).toEqual(box);
    expect(o.get(54)).toEqual(box);
    expect(e.antwort.ziel).toBe('255.255.255.255');
  });

  it('bestaetigt die angebotene Adresse und gibt einem zweiten Handy eine andere', () => {
    const leases = new Leases();
    const ack = beantworte(
      leseAnfrage(dhcpPaket(TYP.REQUEST, MAC_A, { gewuenscht: '192.168.254.100', server: PORTAL_ADRESSE }))!,
      leases,
      0,
    );
    expect(ack.art === 'antwort' && optionen(ack.antwort.paket).get(53)).toEqual([TYP.ACK]);
    const zweites = beantworte(leseAnfrage(dhcpPaket(TYP.DISCOVER, MAC_B))!, leases, 0);
    expect(zweites.art === 'antwort' && [...zweites.antwort.paket.subarray(16, 20)].join('.')).toBe('192.168.254.101');
  });

  it('lehnt eine Adresse aus einem fremden Netz ab - das Handy fragt dann neu', () => {
    const e = beantworte(leseAnfrage(dhcpPaket(TYP.REQUEST, MAC_A, { gewuenscht: '192.168.1.23' }))!, new Leases(), 0);
    expect(e.art === 'antwort' && optionen(e.antwort.paket).get(53)).toEqual([TYP.NAK]);
  });

  it('erkennt einen anderen DHCP-Server im Netz', () => {
    const e = beantworte(
      leseAnfrage(dhcpPaket(TYP.REQUEST, MAC_A, { gewuenscht: '192.168.254.50', server: '192.168.254.254' }))!,
      new Leases(),
      0,
    );
    expect(e).toEqual({ art: 'fremder-server', server: '192.168.254.254' });
  });

  it('gibt eine Adresse frei, wenn das Handy geht', () => {
    const leases = new Leases();
    beantworte(leseAnfrage(dhcpPaket(TYP.REQUEST, MAC_A, { gewuenscht: '192.168.254.100', server: PORTAL_ADRESSE }))!, leases, 0);
    expect(leases.anzahl(0)).toBe(1);
    beantworte(leseAnfrage(dhcpPaket(TYP.RELEASE, MAC_A, { ciaddr: '192.168.254.100' }))!, leases, 0);
    expect(leases.anzahl(0)).toBe(0);
  });

  it('ignoriert Muell', () => {
    expect(leseAnfrage(Buffer.from('kein dhcp'))).toBeNull();
  });
});

describe('Namensdienst (DNS)', () => {
  const frage = (name: string, type: 'A' | 'AAAA') =>
    dnsPacket.encode({ type: 'query', id: 7, flags: dnsPacket.RECURSION_DESIRED, questions: [{ type, name }] });

  it('beantwortet jede A-Anfrage mit der Box', () => {
    for (const name of ['captive.apple.com', 'connectivitycheck.gstatic.com', 'www.whatsapp.com']) {
      const antwort = dnsPacket.decode(beantworteDns(frage(name, 'A'))!);
      expect(antwort.id).toBe(7);
      expect(antwort.answers).toEqual([expect.objectContaining({ type: 'A', name, data: PORTAL_ADRESSE })]);
    }
  });

  it('laesst IPv6 leer, damit das Handy auf IPv4 bleibt', () => {
    expect(dnsPacket.decode(beantworteDns(frage('captive.apple.com', 'AAAA'))!).answers).toEqual([]);
  });

  it('ignoriert Muell', () => {
    expect(beantworteDns(Buffer.from([1, 2, 3]))).toBeNull();
  });

  it('antwortet ueber das Netz', async () => {
    const dienst = new DnsDienst('127.0.0.1', 0);
    // Port 0 heisst: irgendein freier - den holen wir uns vom Socket.
    await dienst.starte();
    const port = (dienst as unknown as { socket: { address(): { port: number } } }).socket.address().port;
    const client = createSocket('udp4');
    const antwort = await new Promise<Buffer>((fertig) => {
      client.once('message', fertig);
      client.send(frage('captive.apple.com', 'A'), port, '127.0.0.1');
    });
    client.close();
    await dienst.stoppe();
    // Der Dienst antwortet mit der Adresse, an der er lauscht - im Test 127.0.0.1.
    expect(dnsPacket.decode(antwort).answers?.[0]).toMatchObject({ data: '127.0.0.1' });
  });
});

describe('Portal (Port 80)', () => {
  const galerie = 'http://192.168.254.1:8787/g/abc';

  it('leitet die Pruefadressen von iPhone und Android auf die Galerie - nie "Success", nie 204', async () => {
    const app = bauePortal(() => galerie);
    for (const [host, url] of [
      ['captive.apple.com', '/hotspot-detect.html'],
      ['connectivitycheck.gstatic.com', '/generate_204'],
      ['www.msftconnecttest.com', '/connecttest.txt'],
      ['irgendwas.de', '/'],
    ] as const) {
      const r = await app.inject({ method: 'GET', url, headers: { host } });
      expect(r.statusCode, host).toBe(302);
      expect(r.headers.location, host).toBe(galerie);
      expect(r.body).not.toContain('Success');
    }
    await app.close();
  });

  it('sagt freundlich Bescheid, wenn keine Galerie offen ist', async () => {
    const app = bauePortal(() => null);
    const r = await app.inject({ method: 'GET', url: '/generate_204' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('nicht geöffnet');
    await app.close();
  });
});

describe('Schalter und Steuerung', () => {
  it('Schalter aus und Netz nicht eingerichtet: es laeuft nichts - wie vorher', () => {
    expect(portalSoll({ schalter: false, eingerichtet: false, galerieAktiv: true })).toEqual({ dhcp: false, dns: false, portal: false });
    expect(portalSoll({ schalter: true, eingerichtet: false, galerieAktiv: true })).toEqual({ dhcp: false, dns: false, portal: false });
  });

  it('Netz eingerichtet: Adressen gibt es immer - auch mit ausgeschaltetem Portal', () => {
    expect(portalSoll({ schalter: false, eingerichtet: true, galerieAktiv: true })).toEqual({ dhcp: true, dns: false, portal: false });
  });

  it('Schalter an, Netz eingerichtet, Galerie offen: alles laeuft', () => {
    expect(portalSoll({ schalter: true, eingerichtet: true, galerieAktiv: true })).toEqual({ dhcp: true, dns: true, portal: true });
    expect(portalSoll({ schalter: true, eingerichtet: true, galerieAktiv: false })).toEqual({ dhcp: true, dns: false, portal: false });
  });

  it('Netz gilt nur als eingerichtet, wenn die Portal-Adresse wirklich am Adapter steht', () => {
    expect(portalNetzEingerichtet(['192.168.0.12'])).toBe(false);
    expect(portalNetzEingerichtet(['192.168.0.12', PORTAL_ADRESSE])).toBe(true);
  });

  it('startet und stoppt die Dienste - ein Fehler haelt die anderen nicht auf', async () => {
    const protokoll: string[] = [];
    const attrappe = (name: string, scheitert = false) => ({
      laeuft: false,
      async starte() {
        if (scheitert) throw new Error('listen EADDRINUSE: address already in use');
        this.laeuft = true;
        protokoll.push(`${name} an`);
      },
      async stoppe() {
        this.laeuft = false;
        protokoll.push(`${name} aus`);
      },
    });
    const steuerung = new Portalsteuerung(() => null, () => undefined, {
      dhcp: Object.assign(attrappe('dhcp'), { geraete: () => 0, fremderServer: null }) as unknown as DhcpDienst,
      dns: attrappe('dns', true) as unknown as DnsDienst,
      portal: attrappe('portal') as never,
    });
    await steuerung.abgleichen({ dhcp: true, dns: true, portal: true });
    expect(protokoll).toEqual(['dhcp an', 'portal an']);
    expect(steuerung.zustand().fehler[0]).toContain('schon belegt');
    await steuerung.stoppeAlles();
    expect(protokoll).toEqual(['dhcp an', 'portal an', 'dhcp aus', 'portal aus']);
  });

  it('der echte Adressdienst laesst sich starten und stoppen', async () => {
    const dienst = new DhcpDienst('127.0.0.1', 0);
    await dienst.starte();
    expect(dienst.laeuft).toBe(true);
    await dienst.stoppe();
    expect(dienst.laeuft).toBe(false);
  });
});

describe('Selbstdiagnose', () => {
  it('liest die Windows-Ausgabe - auch einzelne Werte statt Listen', async () => {
    const { deuteRohdiagnose } = await import('../portal/diagnose.js');
    const roh = deuteRohdiagnose(
      JSON.stringify({
        adapter: { index: 7, name: 'Ethernet', beschreibung: 'Realtek', verbunden: true, dhcp: true, adressen: '192.168.254.23', dhcpServer: '192.168.254.254' },
        firewall: false,
        port80: 'World Wide Web Publishing Service',
      }),
    );
    expect(roh.port80).toBe('World Wide Web Publishing Service');
    expect(roh.adapter).toEqual([
      { index: 7, name: 'Ethernet', beschreibung: 'Realtek', verbunden: true, dhcp: true, adressen: ['192.168.254.23'], dhcpServer: '192.168.254.254' },
    ]);
  });

  it('vor dem Einrichten: nennt den Vonets als Adressverteiler und den naechsten Handgriff', async () => {
    const { bewerte } = await import('../portal/diagnose.js');
    const d = bewerte(
      {
        windows: true,
        firewall: false,
        port80: null,
        adapter: [{ index: 7, name: 'Ethernet', beschreibung: '', verbunden: true, dhcp: true, adressen: ['192.168.254.23'], dhcpServer: '192.168.254.254' }],
      },
      { vonets: true, anschluesse: [], zustand: null, schalter: false },
    );
    expect(d.eingerichtet).toBe(false);
    expect(d.bereit).toBe(false);
    const text = d.zeilen.map((z) => `${z.titel}: ${z.hinweis}`).join('\n');
    expect(text).toContain('Netzwerk für das Portal einrichten');
    expect(text).toContain('„DHCP Server“ „Disable“');
  });

  it('nach dem Einrichten: alles gruen, Schalter darf an', async () => {
    const { bewerte } = await import('../portal/diagnose.js');
    const d = bewerte(
      {
        windows: true,
        firewall: true,
        port80: null,
        adapter: [{ index: 7, name: 'Ethernet', beschreibung: '', verbunden: true, dhcp: false, adressen: [PORTAL_ADRESSE], dhcpServer: null }],
      },
      {
        vonets: true,
        anschluesse: [{ port: 53, ergebnis: true }, { port: 80, ergebnis: true }],
        zustand: { dhcp: true, dns: false, portal: false, geraete: 2, fremderDhcp: null, fehler: [] },
        schalter: false,
      },
    );
    expect(d.eingerichtet).toBe(true);
    expect(d.bereit).toBe(true);
    expect(d.zeilen.filter((z) => z.ok === false)).toEqual([]);
  });

  it('belegter Anschluss oder zweiter Adressverteiler: nicht bereit', async () => {
    const { bewerte } = await import('../portal/diagnose.js');
    const grund = {
      windows: true,
      firewall: true,
      port80: null as string | null,
      adapter: [{ index: 7, name: 'Ethernet', beschreibung: '', verbunden: true, dhcp: false, adressen: [PORTAL_ADRESSE], dhcpServer: null }],
    };
    const belegt = bewerte(grund, { vonets: true, anschluesse: [{ port: 53, ergebnis: 'EADDRINUSE' }], zustand: null, schalter: false });
    expect(belegt.bereit).toBe(false);
    expect(belegt.zeilen.find((z) => z.titel === 'Anschlüsse frei')?.hinweis).toContain('Hotspot');
    const fremd = bewerte(grund, {
      vonets: true,
      anschluesse: [],
      zustand: { dhcp: true, dns: false, portal: false, geraete: 0, fremderDhcp: '192.168.254.254', fehler: [] },
      schalter: false,
    });
    expect(fremd.bereit).toBe(false);
  });

  it('Anschluss 80 von einem Windows-Webdienst gehalten: nennt ihn, nicht bereit - laeuft das eigene Portal, zaehlt es nicht', async () => {
    const { bewerte } = await import('../portal/diagnose.js');
    const adapter = [{ index: 7, name: 'Ethernet', beschreibung: '', verbunden: true, dhcp: false, adressen: [PORTAL_ADRESSE], dhcpServer: null }];
    const iis = bewerte(
      { windows: true, firewall: true, port80: 'World Wide Web Publishing Service', adapter },
      { vonets: true, anschluesse: [{ port: 80, ergebnis: 'listen EACCES' }], zustand: null, schalter: false },
    );
    expect(iis.bereit).toBe(false);
    const hinweis = iis.zeilen.find((z) => z.titel === 'Anschlüsse frei')?.hinweis ?? '';
    expect(hinweis).toContain('„World Wide Web Publishing Service“');
    expect(hinweis).toContain('Deaktiviert');
    // Schon vor dem Einrichten sichtbar.
    const vorher = bewerte(
      { windows: true, firewall: false, port80: 'node', adapter: [{ ...adapter[0]!, dhcp: true, adressen: ['192.168.254.23'] }] },
      { vonets: true, anschluesse: [], zustand: null, schalter: false },
    );
    expect(vorher.zeilen.find((z) => z.titel === 'Anschlüsse frei')?.ok).toBe(false);
    const eigenes = bewerte(
      { windows: true, firewall: true, port80: 'node', adapter },
      { vonets: true, anschluesse: [], zustand: { dhcp: true, dns: true, portal: true, geraete: 0, fremderDhcp: null, fehler: [] }, schalter: true },
    );
    expect(eigenes.bereit).toBe(true);
  });

  it('die Fotobox selbst auf Anschluss 80 ist kein fremder Dienst', async () => {
    const { deuteRohdiagnose } = await import('../portal/diagnose.js');
    const json = (prozess: number) => JSON.stringify({ adapter: [], firewall: true, port80: 'node', port80Prozess: prozess });
    expect(deuteRohdiagnose(json(4242), 4242).port80).toBeNull();
    expect(deuteRohdiagnose(json(777), 4242).port80).toBe('node');
  });

  it('startet ein eigener Dienst waehrend der Diagnose, zaehlt sein Anschluss nicht als belegt', async () => {
    const { ohneEigene } = await import('../portal/diagnose.js');
    const belegt = [
      { port: 53, ergebnis: 'bind EADDRINUSE' as const },
      { port: 80, ergebnis: 'listen EADDRINUSE' as const },
      { port: 67, ergebnis: true as const },
    ];
    const zustand = { dhcp: true, dns: true, portal: true, geraete: 1, fremderDhcp: null, fehler: [] };
    expect(ohneEigene(belegt, zustand)).toEqual([]);
    expect(ohneEigene(belegt, null)).toHaveLength(3);
    expect(ohneEigene(belegt, { ...zustand, portal: false }).map((a) => a.port)).toEqual([80]);
  });

  it('ausserhalb von Windows: nur ein Hinweis, nichts einschaltbar', async () => {
    const { bewerte } = await import('../portal/diagnose.js');
    const d = bewerte({ windows: false, adapter: [], firewall: false, port80: null }, { vonets: null, anschluesse: [], zustand: null, schalter: false });
    expect(d.bereit).toBe(false);
    expect(d.zeilen).toHaveLength(1);
  });
});
