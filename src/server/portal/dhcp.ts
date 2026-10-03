import { createSocket, type Socket } from 'node:dgram';
import { PORTAL_ADRESSE, PORTAL_MASKE, POOL_ERSTE, POOL_LETZTE, hostAnteil, poolAdresse } from './adresse.js';

/**
 * Ein kleiner DHCP-Dienst fuer das Fotobox-WLAN.
 *
 * Der Vonets ist nur eine WLAN-Bruecke und kann den Handys keinen eigenen
 * DNS-Server mitgeben. Also verteilt die Box die Adressen selbst - mit sich
 * selbst als Gateway und DNS. Erst dadurch landet die Internet-Pruefung des
 * Handys bei der Box, und das Portal-Fenster mit der Galerie geht auf.
 *
 * Bewusst klein: ein Netz, ein Adressbereich, Leases nur im Speicher. Nach
 * einem Neustart fragen die Handys einfach neu.
 *
 * Schutz vor Adresschaos: Meldet sich ein anderer DHCP-Server im Netz (etwa
 * der Vonets mit eingeschaltetem DHCP), schweigt die Box und meldet das.
 */

const MAGIC = 0x63825363;
const LEASE_SEKUNDEN = 3600;
const FREMD_RUHE_MS = 5 * 60_000;

/** DHCP-Nachrichtentypen (Option 53). */
export const TYP = { DISCOVER: 1, OFFER: 2, REQUEST: 3, DECLINE: 4, ACK: 5, NAK: 6, RELEASE: 7, INFORM: 8 } as const;

export interface DhcpAnfrage {
  typ: number;
  xid: number;
  flags: number;
  ciaddr: string;
  giaddr: string;
  chaddr: Buffer;
  mac: string;
  gewuenscht: string | null;
  server: string | null;
}

/** Liest eine DHCP-Anfrage. null bei allem, was keine gueltige Client-Anfrage ist. */
export function leseAnfrage(paket: Buffer): DhcpAnfrage | null {
  if (paket.length < 240 || paket[0] !== 1 || paket.readUInt32BE(236) !== MAGIC) return null;
  const hlen = Math.min(16, paket[2]!);
  const chaddr = Buffer.from(paket.subarray(28, 44));
  const optionen = new Map<number, Buffer>();
  let i = 240;
  while (i < paket.length) {
    const code = paket[i]!;
    if (code === 255) break;
    if (code === 0) {
      i += 1;
      continue;
    }
    const laenge = paket[i + 1];
    if (laenge === undefined || i + 2 + laenge > paket.length) return null;
    optionen.set(code, paket.subarray(i + 2, i + 2 + laenge));
    i += 2 + laenge;
  }
  const typ = optionen.get(53)?.[0];
  if (!typ) return null;
  const ip = (b: Buffer | undefined) => (b && b.length === 4 ? [...b].join('.') : null);
  return {
    typ,
    xid: paket.readUInt32BE(4),
    flags: paket.readUInt16BE(10),
    ciaddr: [...paket.subarray(12, 16)].join('.'),
    giaddr: [...paket.subarray(24, 28)].join('.'),
    chaddr,
    mac: [...chaddr.subarray(0, hlen)].map((b) => b.toString(16).padStart(2, '0')).join(':'),
    gewuenscht: ip(optionen.get(50)),
    server: ip(optionen.get(54)),
  };
}

interface Lease {
  adresse: string;
  bisMs: number;
}

/** Die vergebenen Adressen, je Geraet (MAC). */
export class Leases {
  private nachMac = new Map<string, Lease>();

  zuteilen(mac: string, gewuenscht: string | null, jetztMs: number): string | null {
    const eigene = this.nachMac.get(mac);
    if (eigene) return eigene.adresse;
    const belegt = new Set(
      [...this.nachMac.entries()].filter(([, l]) => l.bisMs > jetztMs).map(([, l]) => l.adresse),
    );
    const wunschHost = gewuenscht ? hostAnteil(gewuenscht) : null;
    if (wunschHost !== null && wunschHost >= POOL_ERSTE && wunschHost <= POOL_LETZTE && !belegt.has(gewuenscht!)) {
      return gewuenscht;
    }
    for (let host = POOL_ERSTE; host <= POOL_LETZTE; host += 1) {
      const adresse = poolAdresse(host);
      if (!belegt.has(adresse)) return adresse;
    }
    return null;
  }

  /** Die Adresse fest vergeben - erst beim ACK, nicht schon beim Angebot. */
  bestaetige(mac: string, adresse: string, jetztMs: number): boolean {
    for (const [andere, lease] of this.nachMac) {
      if (andere !== mac && lease.adresse === adresse && lease.bisMs > jetztMs) return false;
    }
    this.nachMac.set(mac, { adresse, bisMs: jetztMs + LEASE_SEKUNDEN * 1000 });
    return true;
  }

  gibFrei(mac: string): void {
    this.nachMac.delete(mac);
  }

  anzahl(jetztMs: number): number {
    return [...this.nachMac.values()].filter((l) => l.bisMs > jetztMs).length;
  }
}

export interface DhcpAntwort {
  paket: Buffer;
  /** Wohin die Antwort geht: an die Adresse des Geraets oder an alle. */
  ziel: string;
}

export type Entscheidung =
  | { art: 'antwort'; antwort: DhcpAntwort }
  | { art: 'fremder-server'; server: string }
  | { art: 'nichts' };

/**
 * Was auf eine Anfrage zu antworten ist. Rein - ohne Netz -, damit sie sich
 * vollstaendig testen laesst.
 */
export function beantworte(anfrage: DhcpAnfrage, leases: Leases, jetztMs: number): Entscheidung {
  // Der Client hat sich fuer das Angebot eines anderen Servers entschieden:
  // Es gibt also noch einen DHCP-Server im Netz.
  if (anfrage.typ === TYP.REQUEST && anfrage.server && anfrage.server !== PORTAL_ADRESSE) {
    return { art: 'fremder-server', server: anfrage.server };
  }
  if (anfrage.giaddr !== '0.0.0.0') return { art: 'nichts' }; // Relays gibt es hier nicht.

  switch (anfrage.typ) {
    case TYP.DISCOVER: {
      const adresse = leases.zuteilen(anfrage.mac, anfrage.gewuenscht, jetztMs);
      if (!adresse) return { art: 'nichts' };
      return { art: 'antwort', antwort: baueAntwort(anfrage, TYP.OFFER, adresse) };
    }
    case TYP.REQUEST: {
      const gewuenscht = anfrage.gewuenscht ?? (anfrage.ciaddr !== '0.0.0.0' ? anfrage.ciaddr : null);
      const host = gewuenscht ? hostAnteil(gewuenscht) : null;
      const imPool = host !== null && host >= POOL_ERSTE && host <= POOL_LETZTE;
      // Wer eine Adresse aus einem anderen Netz verlaengern will (das Handy
      // war vorher zu Hause im WLAN), bekommt ein NAK und fragt dann neu.
      if (!gewuenscht || !imPool || !leases.bestaetige(anfrage.mac, gewuenscht, jetztMs)) {
        return { art: 'antwort', antwort: baueAntwort(anfrage, TYP.NAK, '0.0.0.0') };
      }
      return { art: 'antwort', antwort: baueAntwort(anfrage, TYP.ACK, gewuenscht) };
    }
    case TYP.INFORM:
      return { art: 'antwort', antwort: baueAntwort(anfrage, TYP.ACK, '0.0.0.0') };
    case TYP.RELEASE:
    case TYP.DECLINE:
      leases.gibFrei(anfrage.mac);
      return { art: 'nichts' };
    default:
      return { art: 'nichts' };
  }
}

function ipBytes(adresse: string): number[] {
  return adresse.split('.').map(Number);
}

function baueAntwort(anfrage: DhcpAnfrage, typ: number, adresse: string): DhcpAntwort {
  const kopf = Buffer.alloc(240);
  kopf[0] = 2; // BOOTREPLY
  kopf[1] = 1; // Ethernet
  kopf[2] = 6;
  kopf.writeUInt32BE(anfrage.xid, 4);
  kopf.writeUInt16BE(anfrage.flags, 10);
  if (typ === TYP.ACK && anfrage.typ === TYP.INFORM) Buffer.from(ipBytes(anfrage.ciaddr)).copy(kopf, 12);
  Buffer.from(ipBytes(adresse)).copy(kopf, 16); // yiaddr
  anfrage.chaddr.copy(kopf, 28);
  kopf.writeUInt32BE(MAGIC, 236);

  const opt: number[] = [53, 1, typ, 54, 4, ...ipBytes(PORTAL_ADRESSE)];
  if (typ !== TYP.NAK) {
    opt.push(1, 4, ...ipBytes(PORTAL_MASKE));
    // Die Box als Gateway und DNS: Nur so landet die Internet-Pruefung des
    // Handys bei ihr. Echtes Internet gibt es hier nicht - das Handy merkt das
    // und bleibt fuer alles andere bei seinen mobilen Daten.
    opt.push(3, 4, ...ipBytes(PORTAL_ADRESSE));
    opt.push(6, 4, ...ipBytes(PORTAL_ADRESSE));
    if (anfrage.typ !== TYP.INFORM) {
      const lease = Buffer.alloc(4);
      lease.writeUInt32BE(LEASE_SEKUNDEN);
      opt.push(51, 4, ...lease);
    }
  }
  opt.push(255);

  // Ein Geraet ohne Adresse erreicht man nur per Rundruf; wer schon eine hat
  // (Verlaengerung, INFORM), bekommt die Antwort direkt.
  const ziel = anfrage.ciaddr !== '0.0.0.0' && typ !== TYP.NAK ? anfrage.ciaddr : '255.255.255.255';
  return { paket: Buffer.concat([kopf, Buffer.from(opt)]), ziel };
}

/**
 * Der laufende Dienst. Lauscht auf UDP 67 an der Portal-Adresse - nur dort,
 * nicht an allen Adaptern: Haengt die Box zusaetzlich im WLAN der Location,
 * soll sie dort niemandem Adressen verteilen.
 */
export class DhcpDienst {
  private socket: Socket | null = null;
  private leases = new Leases();
  /**
   * Ein anderer DHCP-Server antwortet im Netz - dann schweigt die Box. Fuenf
   * Minuten ohne neues Lebenszeichen von ihm (etwa nachdem am Vonets der
   * DHCP ausgeschaltet wurde), und sie verteilt wieder selbst.
   */
  private fremd: { server: string; zuletztMs: number } | null = null;

  get fremderServer(): string | null {
    if (this.fremd && Date.now() - this.fremd.zuletztMs > FREMD_RUHE_MS) this.fremd = null;
    return this.fremd?.server ?? null;
  }

  constructor(
    private readonly adresse = PORTAL_ADRESSE,
    private readonly port = 67,
    private readonly melde: (text: string) => void = () => undefined,
  ) {}

  get laeuft(): boolean {
    return this.socket !== null;
  }

  geraete(): number {
    return this.leases.anzahl(Date.now());
  }

  async starte(): Promise<void> {
    if (this.socket) return;
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((fertig, fehler) => {
      socket.once('error', fehler);
      socket.bind(this.port, this.adresse, () => {
        socket.off('error', fehler);
        socket.setBroadcast(true);
        fertig();
      });
    });
    socket.on('error', (f) => this.melde(`DHCP: ${f.message}`));
    socket.on('message', (paket) => this.verarbeite(socket, paket));
    this.socket = socket;
  }

  private verarbeite(socket: Socket, paket: Buffer): void {
    const anfrage = leseAnfrage(paket);
    if (!anfrage) return;
    const entscheidung = beantworte(anfrage, this.leases, Date.now());
    if (entscheidung.art === 'fremder-server') {
      if (this.fremderServer !== entscheidung.server) {
        this.melde(`Im Netz verteilt noch ein anderer DHCP-Server Adressen (${entscheidung.server}) - die Box schweigt.`);
      }
      this.fremd = { server: entscheidung.server, zuletztMs: Date.now() };
      return;
    }
    if (entscheidung.art !== 'antwort' || this.fremderServer) return;
    socket.send(entscheidung.antwort.paket, 68, entscheidung.antwort.ziel);
  }

  async stoppe(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (socket) await new Promise<void>((fertig) => socket.close(() => fertig()));
  }
}
