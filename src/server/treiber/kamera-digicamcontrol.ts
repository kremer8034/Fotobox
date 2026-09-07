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
 * Die aufgenommene Datei holen wir bewusst NICHT ueber session.json ab, sondern
 * setzen digiCamControls Zielordner direkt auf 01_originale des aktiven Events
 * und ueberwachen diesen Ordner. Die Datei entsteht dort, wo sie ohnehin
 * hingehoert - kein Kopieren, kein Raetselraten um Dateinamen.
 */
export class DigiCamControlKamera implements KameraTreiber {
  readonly name = 'digiCamControl';
  private liveView = false;

  constructor(private readonly basis = 'http://localhost:5513') {}

  private async ruf(pfad: string, zeitlimitMs = 4000): Promise<Response> {
    const abbruch = AbortSignal.timeout(zeitlimitMs);
    return fetch(`${this.basis}${pfad}`, { signal: abbruch });
  }

  private async befehl(cmd: string): Promise<void> {
    const antwort = await this.ruf(`/?CMD=${encodeURIComponent(cmd)}`);
    if (!antwort.ok) throw new Error(`digiCamControl lehnte ${cmd} ab (HTTP ${antwort.status}).`);
  }

  async pruefe(): Promise<KameraStatus> {
    try {
      const antwort = await this.ruf('/?CMD=Get_Status', 2500);
      if (!antwort.ok) {
        return { verbunden: false, liveViewLaeuft: false, meldung: `HTTP ${antwort.status}` };
      }
      return { verbunden: true, liveViewLaeuft: this.liveView };
    } catch (fehler) {
      return {
        verbunden: false,
        liveViewLaeuft: false,
        meldung: fehler instanceof Error ? fehler.message : String(fehler),
      };
    }
  }

  async starteLiveView(): Promise<void> {
    await this.befehl('LiveViewWnd_Show');
    // Das Live-View-Fenster von digiCamControl wuerde sonst ueber dem
    // Vollbild-Browser landen. Genau solche Kleinigkeiten kosten sonst einen
    // Abend auf der ersten Veranstaltung.
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
    const antwort = await this.ruf(`/?SLC=set&param1=session.folder&param2=${encodeURIComponent(pfad)}`);
    if (!antwort.ok) throw new Error(`Zielordner konnte nicht gesetzt werden (HTTP ${antwort.status}).`);
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
      await this.ruf(`/?SLC=set&param1=${name}&param2=${encodeURIComponent(wert)}`).catch(
        () => undefined,
      );
    }
  }
}
