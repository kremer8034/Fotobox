import { statfs } from 'node:fs/promises';
import { holeDb, jetzt } from './db/index.js';
import { leseGeraet } from './db/geraet.js';
import { holeAktivesEvent } from './fach/events.js';
import { Druckschleife, offeneAuftraege } from './fach/druckwarteschlange.js';
import { MockKamera } from './treiber/kamera-mock.js';
import { DigiCamControlKamera } from './treiber/kamera-digicamcontrol.js';
import { MockDrucker } from './treiber/drucker-mock.js';
import { WindowsDrucker } from './treiber/drucker-windows.js';
import type { KameraTreiber } from './treiber/kamera.js';
import type { DruckerTreiber } from './treiber/drucker.js';
import type { Betriebsstatus, Stoerung } from '../shared/typen.js';
import type { SitzungZustand } from './fach/sitzungen.js';

/**
 * Der Betriebskern haelt alles, was zur Laufzeit lebt: die Treiber, den
 * Live-View, die laufende Sitzung und den Zustand, den die Oberflaeche anzeigt.
 *
 * Weil die Box meist ohne Betreuer beim Kunden steht, ist Robustheit hier kein
 * Extra: Geht die Kamera verloren, wird in einer Schleife neu verbunden; faellt
 * der Drucker aus, bleiben die Auftraege stehen. Gaeste sehen dabei niemals
 * einen technischen Fehlertext, sondern einen Hinweis in Alltagssprache.
 */

export interface BetriebOptionen {
  echteHardware: boolean;
  mockDruckOrdner: string;
}

export class Betrieb {
  kamera: KameraTreiber;
  drucker: DruckerTreiber;
  druckschleife: Druckschleife;

  /** Genau eine Sitzung zur Zeit - der Kiosk ist von Natur aus einspurig. */
  aktiveSitzung: SitzungZustand | null = null;
  letzteBeruehrung = Date.now();

  private kameraOk = false;
  private druckerStoerung: Stoerung | null = null;
  private liveViewGewuenscht = false;
  private letztesLiveBild: Buffer | null = null;
  private letztesLiveBildZeit = 0;
  private beobachtungLaeuft = false;
  private beendet = false;

  constructor(private readonly optionen: BetriebOptionen) {
    const geraet = leseGeraet();
    this.kamera = optionen.echteHardware
      ? new DigiCamControlKamera()
      : new MockKamera();
    this.drucker = optionen.echteHardware
      ? new WindowsDrucker(geraet.druckerName, geraet.sumatraPfad)
      : new MockDrucker(optionen.mockDruckOrdner);
    this.druckschleife = new Druckschleife(
      () => this.drucker,
      (text) => protokolliere('warnung', 'druck', text),
    );
  }

  starte(): void {
    this.druckschleife.starte();
    if (!this.beobachtungLaeuft) {
      this.beobachtungLaeuft = true;
      void this.beobachte();
    }
  }

  async beende(): Promise<void> {
    this.beendet = true;
    this.druckschleife.stoppe();
    await this.kamera.stoppeLiveView().catch(() => undefined);
  }

  /** Treiber neu aufbauen, etwa nachdem der Druckername geaendert wurde. */
  ladeTreiberNeu(): void {
    const geraet = leseGeraet();
    if (this.optionen.echteHardware) {
      this.drucker = new WindowsDrucker(geraet.druckerName, geraet.sumatraPfad);
    }
  }

  // -------------------------------------------------------------------------
  // Live-View
  // -------------------------------------------------------------------------

  /**
   * Der Live-View laeuft durchgehend statt pro Foto neu zu starten: Das
   * Referenzprojekt warnt ausdruecklich vor der Startverzoegerung, die man
   * sonst erst auf dem Event bemerkt.
   */
  async starteLiveView(): Promise<void> {
    this.liveViewGewuenscht = true;
    await this.kamera.starteLiveView().catch(() => undefined);
  }

  async stoppeLiveView(): Promise<void> {
    this.liveViewGewuenscht = false;
    await this.kamera.stoppeLiveView().catch(() => undefined);
  }

  liveViewLaeuft(): boolean {
    return this.liveViewGewuenscht;
  }

  /** Einzelbild fuer das MJPEG-Relais. Die JPEG-Daten gehen unveraendert
   *  weiter - kein Neucodieren, keine Skalierung im Server. */
  async liveBild(): Promise<Buffer | null> {
    const bild = await this.kamera.liveBild();
    if (bild) {
      this.letztesLiveBild = bild;
      this.letztesLiveBildZeit = Date.now();
      return bild;
    }
    // Kurze Aussetzer ueberbruecken, statt den Strom abreissen zu lassen.
    if (this.letztesLiveBild && Date.now() - this.letztesLiveBildZeit < 2000) {
      return this.letztesLiveBild;
    }
    return null;
  }

  /**
   * Wartet, bis die Kamera wieder ein Live-Bild liefert. Der Countdown fuer das
   * naechste Foto startet erst danach - sonst zaehlt die Box vor einem
   * eingefrorenen Bild herunter.
   */
  async warteAufLiveBild(zeitlimitMs = 6000): Promise<boolean> {
    const bis = Date.now() + zeitlimitMs;
    while (Date.now() < bis) {
      const bild = await this.kamera.liveBild();
      if (bild) {
        this.letztesLiveBild = bild;
        this.letztesLiveBildZeit = Date.now();
        return true;
      }
      await pause(200);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Zustand und Selbstheilung
  // -------------------------------------------------------------------------

  private async beobachte(): Promise<void> {
    while (!this.beendet) {
      try {
        const kameraStatus = await this.kamera.pruefe();
        const warVerbunden = this.kameraOk;
        this.kameraOk = kameraStatus.verbunden;

        // Verbindung war weg und ist wieder da: Live-View neu aufbauen.
        if (!warVerbunden && this.kameraOk && this.liveViewGewuenscht) {
          await this.kamera.starteLiveView().catch(() => undefined);
          protokolliere('info', 'kamera', 'Kamera ist wieder verbunden.');
        }

        const druckerStatus = await this.drucker.pruefe();
        this.druckerStoerung =
          druckerStatus.zustand === 'papier-leer'
            ? 'papier-leer'
            : druckerStatus.zustand === 'offline'
              ? 'drucker-offline'
              : druckerStatus.zustand === 'klappe'
                ? 'drucker-klappe'
                : null;
      } catch {
        // Der Beobachter darf nie sterben.
      }
      await pause(3000);
    }
  }

  /**
   * Die eine Stoerung, die dem Gast angezeigt wird. Reihenfolge nach
   * Dringlichkeit: Was den Ablauf blockiert, kommt zuerst.
   */
  aktuelleStoerung(): Stoerung | null {
    if (!this.kameraOk) return 'kamera-offline';
    if (this.druckschleife.istAngehalten()) return this.druckerStoerung ?? 'drucker-offline';
    return this.druckerStoerung;
  }

  async status(): Promise<Betriebsstatus> {
    const event = holeAktivesEvent();
    const geraet = leseGeraet();
    return {
      kamera: this.kameraOk ? 'bereit' : 'gestoert',
      drucker: this.druckerStoerung ? 'gestoert' : 'bereit',
      liveViewLaeuft: this.liveViewGewuenscht,
      stoerung: this.aktuelleStoerung(),
      warteschlangeOffen: offeneAuftraege(),
      materialRest: event
        ? Math.max(0, event.einstellungen.materialStart - event.materialVerbraucht)
        : 0,
      speicherFreiGb: await freierSpeicherGb(geraet.datenpfad),
      aktivesEvent: event ? { id: event.id, name: event.name, probelauf: event.probelauf } : null,
    };
  }
}

export async function freierSpeicherGb(pfad: string): Promise<number> {
  try {
    const info = await statfs(pfad);
    return Math.round(((info.bavail * info.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return 0;
  }
}

export function protokolliere(
  ebene: 'info' | 'warnung' | 'fehler',
  bereich: string,
  text: string,
): void {
  try {
    holeDb()
      .prepare('INSERT INTO protokoll (zeit, ebene, bereich, text) VALUES (?, ?, ?, ?)')
      .run(jetzt(), ebene, bereich, text);
  } catch {
    // Ohne Datenbank wird nur auf die Konsole geschrieben.
  }
  const zeile = `[${ebene}] ${bereich}: ${text}`;
  if (ebene === 'fehler') console.error(zeile);
  else console.log(zeile);
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
