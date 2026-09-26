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
    // Der neue Drucker soll sofort gefragt werden, nicht erst in 20 Sekunden.
    this.letzteDruckerPruefung = 0;
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

  /*
   * Ein Abholer fuer alle Zuschauer.
   *
   * Vorher holte jede offene Verbindung ihre Bilder selbst: Bild abrufen, dann
   * 100 ms schlafen. Das ergab zweierlei Aerger. Erstens kam der Takt nie auf
   * zehn Bilder je Sekunde, weil die Abrufzeit obendrauf kam - bei einer
   * Kamera am USB-Kabel, die 60 bis 80 ms je Bild braucht, waren es eher sechs.
   * Zweitens fragte jeder Zuschauer die Kamera einzeln; ein zweites Fenster
   * (oder ein Strom, der beim Bildschirmwechsel noch nicht zu war) halbierte
   * so die Bildrate fuer alle.
   *
   * Jetzt holt genau eine Schleife in festem Takt und verteilt jedes Bild an
   * alle, die gerade zuschauen. Schaut niemand zu, ruht sie.
   */
  private zuschauer = new Set<(bild: Buffer) => void>();
  private abholerLaeuft = false;

  /** Meldet einen Zuschauer an; die Rueckgabe meldet ihn wieder ab. */
  schaueLiveBild(empfaenger: (bild: Buffer) => void): () => void {
    this.zuschauer.add(empfaenger);
    // Wer neu dazukommt, sieht sofort das letzte Bild statt einer leeren Flaeche.
    if (this.letztesLiveBild && Date.now() - this.letztesLiveBildZeit < 2000) {
      empfaenger(this.letztesLiveBild);
    }
    if (!this.abholerLaeuft) void this.holeLiveBilder();
    return () => {
      this.zuschauer.delete(empfaenger);
    };
  }

  private async holeLiveBilder(): Promise<void> {
    this.abholerLaeuft = true;
    try {
      while (this.zuschauer.size > 0 && !this.beendet) {
        const beginn = Date.now();
        const bild = await this.kamera.liveBild().catch(() => null);
        // Liefert die Kamera dasselbe Bild noch einmal, muss es niemand erneut
        // bekommen - das spart dem Browser das Dekodieren. Es zaehlt auch
        // nicht als "frisch": Byte fuer Byte gleich ist ein echtes Kamerabild
        // nie, das Rauschen des Sensors sorgt dafuer. Gleich heisst eingefroren.
        if (bild && !(this.letztesLiveBild && bild.equals(this.letztesLiveBild))) {
          this.letztesLiveBild = bild;
          this.letztesLiveBildZeit = Date.now();
          for (const empfaenger of this.zuschauer) {
            try {
              empfaenger(bild);
            } catch {
              // Ein kaputter Zuschauer darf die anderen nicht stoeren.
            }
          }
        }
        // Fester Takt: Die Abrufzeit zaehlt mit, statt obendrauf zu kommen.
        // Ohne Bild wird gemaechlicher gefragt, damit eine abgesteckte Kamera
        // nicht im Dauerfeuer angesprochen wird.
        const takt = bild ? LIVE_TAKT_MS : 250;
        await pause(Math.max(5, takt - (Date.now() - beginn)));
      }
    } finally {
      this.abholerLaeuft = false;
    }
    // Hat sich zwischen letzter Pruefung und Ende jemand angemeldet?
    if (this.zuschauer.size > 0 && !this.beendet) void this.holeLiveBilder();
  }

  /** Einzelbild, etwa fuer die Vorschau im Admin. Laeuft der Abholer, kommt
   *  sein letztes Bild - die Kamera wird dafuer nicht zusaetzlich gefragt. */
  async liveBild(): Promise<Buffer | null> {
    if (this.abholerLaeuft && this.letztesLiveBild && Date.now() - this.letztesLiveBildZeit < 500) {
      return this.letztesLiveBild;
    }
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
   *
   * Laeuft der Abholer, genuegt es, auf sein naechstes Bild zu warten; die
   * Kamera wird dann nicht noch zusaetzlich gefragt, gerade in dem Moment, in
   * dem sie nach dem Ausloesen ohnehin zu tun hat.
   */
  async warteAufLiveBild(zeitlimitMs = 6000): Promise<boolean> {
    const seit = Date.now();
    const bis = seit + zeitlimitMs;
    while (Date.now() < bis) {
      if (this.abholerLaeuft) {
        if (this.letztesLiveBildZeit > seit) return true;
        await pause(50);
        continue;
      }
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

        if (!this.druckerPruefungFaellig()) {
          await pause(3000);
          continue;
        }
        this.letzteDruckerPruefung = Date.now();
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

  /*
   * Den Drucker nur so oft fragen, wie es etwas bringt.
   *
   * Unter Windows ist jede Pruefung ein frisch gestartetes PowerShell - auf dem
   * N100 eine knappe Sekunde Rechenzeit. Alle drei Sekunden, den ganzen Abend
   * lang, war das die groesste Dauerlast der Box, und sie fiel ausgerechnet in
   * Countdown und Layoutberechnung.
   *
   * Wachsam (alle 3 s) ist die Pruefung jetzt nur, wenn es darauf ankommt: Es
   * wartet etwas auf den Druck, oder der Drucker hat gerade eine Stoerung, deren
   * Ende der Gast sehen soll. Sonst reichen 20 Sekunden - und waehrend ein Gast
   * fotografiert, wird ein ruhiger Drucker gar nicht gefragt.
   */
  private letzteDruckerPruefung = 0;

  private druckerPruefungFaellig(): boolean {
    const wachsam =
      this.druckerStoerung !== null || this.druckschleife.istAngehalten() || offeneAuftraege() > 0;
    if (!wachsam && this.aktiveSitzung) return false;
    const abstand = wachsam ? 3000 : 20_000;
    return Date.now() - this.letzteDruckerPruefung >= abstand;
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

/** Zehn Bilder je Sekunde: genug zum Ausrichten, und mehr liefert die 600D
 *  ueber USB ohnehin kaum. */
const LIVE_TAKT_MS = 100;

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
