import { connect } from 'node:net';
import type { KameraStatus, KameraTreiber } from './kamera.js';

/**
 * Anbindung an digiCamControl ueber dessen HTTP-Schnittstelle auf Port 5513.
 *
 * Belegte Befehle laut Hersteller-Dokumentation:
 *   ?CMD=LiveViewWnd_Show    Live-View starten
 *   ?CMD=LiveViewWnd_Hide    Live-View beenden
 *   ?CMD=Capture             ausloesen
 *   ?CMD=All_Minimize        alle Fenster minimieren
 *   /liveview.jpg            aktuelles Live-View-Einzelbild
 *   /preview.jpg             zuletzt aufgenommenes Bild
 *
 * Zwei Dinge aus digiCamControls Quelltext (CameraControl.Core/Classes):
 *  - Der Webserver lauscht nur auf IPv4 (IPAddress.Any). "localhost" loest
 *    unter Windows zuerst nach ::1 auf - dort antwortet niemand, und die Box
 *    hielt digiCamControl fuer abgestuerzt. Deshalb fest 127.0.0.1.
 *  - Befehle (?CMD=..., ?slc=...) fuehrt er nur aus, wenn in seinen
 *    Einstellungen "Interaktion ueber Webserver erlauben" angehakt ist. Sonst
 *    antwortet er zwar, tut aber nichts - kein Live-View, kein Ausloesen.
 *
 * Und eine Eigenheit: Auf "?slc=..." antwortet digiCamControl mit doppeltem
 * Content-Length-Kopf (einmal von Hand gesetzt, einmal vom Webserver).
 * Browser sehen darueber hinweg, Node (fetch/llhttp) bricht mit
 * HPE_UNEXPECTED_CONTENT_LENGTH ab - die Box hielt digiCamControl deshalb fuer
 * "antwortet nicht", obwohl Ausloesen ging. Diese Anfragen gehen deshalb ueber
 * eine eigene, nachsichtige Abfrage (frageRoh).
 *
 * Die Pruefung fragt "?slc=list&param1=cameras": Die Antwort ist die Liste
 * der verbundenen Kameras (Seriennummern), "OK" bei keiner Kamera, und leer,
 * wenn Befehle gesperrt sind. Das unterscheidet alle drei Faelle.
 *
 * Die aufgenommene Datei holen wir bewusst NICHT ueber session.json ab, sondern
 * setzen digiCamControls Zielordner direkt auf 01_originale des aktiven Events
 * und ueberwachen diesen Ordner. Die Datei entsteht dort, wo sie ohnehin
 * hingehoert - kein Kopieren, kein Raetselraten um Dateinamen.
 */
export class DigiCamControlKamera implements KameraTreiber {
  readonly name = 'digiCamControl';
  private liveView = false;

  constructor(private readonly basis = 'http://127.0.0.1:5513') {}

  private async ruf(pfad: string, zeitlimitMs = 4000): Promise<Response> {
    const abbruch = AbortSignal.timeout(zeitlimitMs);
    return fetch(`${this.basis}${pfad}`, { signal: abbruch });
  }

  /**
   * HTTP-Anfrage ohne strengen Parser: Statuszeile und Rumpf werden selbst
   * gelesen, doppelte Kopfzeilen stoeren nicht.
   */
  private frageRoh(pfad: string, zeitlimitMs = 4000): Promise<{ status: number; text: string }> {
    const url = new URL(this.basis);
    return new Promise((fertig, fehler) => {
      const sock = connect({ host: url.hostname, port: Number(url.port) || 80 });
      let puffer = Buffer.alloc(0);
      let erledigt = false;
      const ende = (f: Error | null) => {
        if (erledigt) return;
        erledigt = true;
        clearTimeout(uhr);
        sock.destroy();
        if (f) return fehler(f);
        const roh = puffer.toString('utf8');
        const trenner = roh.indexOf('\r\n\r\n');
        if (trenner < 0) return fehler(new Error('Unvollständige Antwort von digiCamControl.'));
        const kopf = roh.slice(0, trenner);
        const status = Number(/^HTTP\/\d\.\d\s+(\d{3})/.exec(kopf)?.[1] ?? 0);
        const rumpf = roh.slice(trenner + 4);
        fertig({ status, text: /^transfer-encoding:\s*chunked/im.test(kopf) ? entstuecke(rumpf) : rumpf });
      };
      const uhr = setTimeout(() => {
        // Ist der Kopf schon da, reicht das - manche Antworten schliessen die Verbindung nicht.
        if (puffer.includes('\r\n\r\n')) ende(null);
        else ende(new Error(`Keine Antwort von digiCamControl innerhalb von ${zeitlimitMs} ms.`));
      }, zeitlimitMs);
      sock.on('connect', () => {
        sock.write(`GET ${pfad} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
      });
      sock.on('data', (stueck: Buffer) => {
        puffer = Buffer.concat([puffer, stueck]);
        const roh = puffer.toString('latin1');
        const trenner = roh.indexOf('\r\n\r\n');
        if (trenner < 0) return;
        // Fertig, sobald so viel Rumpf da ist, wie die groesste Laengenangabe verspricht.
        const laengen = [...roh.slice(0, trenner).matchAll(/^content-length:\s*(\d+)/gim)].map((m) => Number(m[1]));
        if (laengen.length > 0 && puffer.length - (trenner + 4) >= Math.max(...laengen)) ende(null);
      });
      sock.on('end', () => ende(null));
      sock.on('error', (f) => ende(f));
    });
  }

  private async befehl(cmd: string): Promise<void> {
    const antwort = await this.ruf(`/?CMD=${encodeURIComponent(cmd)}`);
    if (!antwort.ok) throw new Error(`digiCamControl lehnte ${cmd} ab (HTTP ${antwort.status}).`);
  }

  async pruefe(): Promise<KameraStatus> {
    let antwort: { status: number; text: string };
    let text: string;
    try {
      antwort = await this.frageRoh('/?slc=list&param1=cameras', 2500);
      text = antwort.text.trim();
    } catch (fehler) {
      return {
        verbunden: false,
        antwortet: false,
        liveViewLaeuft: false,
        meldung: fehler instanceof Error ? fehler.message : String(fehler),
        grund: 'antwortet-nicht',
      };
    }
    if (antwort.status < 200 || antwort.status >= 300 || text === '') {
      return { verbunden: false, antwortet: true, liveViewLaeuft: false, grund: 'befehle-gesperrt' };
    }
    if (text === 'OK') {
      return { verbunden: false, antwortet: true, liveViewLaeuft: false, grund: 'keine-kamera' };
    }
    return { verbunden: true, antwortet: true, liveViewLaeuft: this.liveView };
  }

  /** Das Programmfenster von digiCamControl aus dem Weg raeumen. */
  async fensterWeg(): Promise<void> {
    await this.befehl('All_Minimize').catch(() => undefined);
  }

  async starteLiveView(): Promise<void> {
    await this.befehl('LiveViewWnd_Show');
    // Das Live-View-Fenster von digiCamControl wuerde sonst ueber dem
    // Vollbild-Browser landen. Genau solche Kleinigkeiten kosten sonst einen
    // Abend auf der ersten Veranstaltung. digiCamControl baut das Fenster
    // erst nach der Antwort auf - sofort minimiert, traf es noch kein Fenster.
    // So macht es auch digiCamControls eigener Webcam-Weg: zeigen, kurz
    // warten, minimieren.
    await new Promise((r) => setTimeout(r, 800));
    await this.befehl('All_Minimize').catch(() => undefined);
    this.liveView = true;
  }

  async stoppeLiveView(): Promise<void> {
    await this.befehl('LiveViewWnd_Hide').catch(() => undefined);
    this.liveView = false;
  }

  async liveBild(): Promise<Buffer | null> {
    try {
      const antwort = await this.ruf('/liveview.jpg', 2000);
      if (!antwort.ok) return null;
      const puffer = Buffer.from(await antwort.arrayBuffer());
      return puffer.length > 0 ? puffer : null;
    } catch {
      return null;
    }
  }

  async ausloesen(): Promise<void> {
    await this.befehl('Capture');
  }

  async setzeZielordner(pfad: string): Promise<void> {
    const antwort = await this.frageRoh(`/?slc=set&param1=session.folder&param2=${encodeURIComponent(pfad)}`);
    if (antwort.status < 200 || antwort.status >= 300) {
      throw new Error(`Zielordner konnte nicht gesetzt werden (HTTP ${antwort.status}).`);
    }
  }

  async setzeBelichtung(werte: {
    iso?: string;
    blende?: string;
    verschlusszeit?: string;
  }): Promise<void> {
    const paare: [string, string | undefined][] = [
      ['iso', werte.iso],
      ['aperture', werte.blende],
      ['shutterspeed', werte.verschlusszeit],
    ];
    for (const [name, wert] of paare) {
      if (!wert) continue;
      await this.frageRoh(`/?slc=set&param1=${name}&param2=${encodeURIComponent(wert)}`).catch(
        () => undefined,
      );
    }
  }
}

/** Rumpf mit "Transfer-Encoding: chunked" zusammensetzen. */
function entstuecke(rumpf: string): string {
  let ergebnis = '';
  let rest = rumpf;
  for (;;) {
    const zeilenende = rest.indexOf('\r\n');
    if (zeilenende < 0) break;
    const laenge = parseInt(rest.slice(0, zeilenende), 16);
    if (!Number.isFinite(laenge) || laenge <= 0) break;
    ergebnis += rest.slice(zeilenende + 2, zeilenende + 2 + laenge);
    rest = rest.slice(zeilenende + 2 + laenge + 2);
  }
  return ergebnis;
}
