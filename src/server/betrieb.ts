import { statfs } from 'node:fs/promises';
import { holeDb, jetzt } from './db/index.js';
import { leseGeraet } from './db/geraet.js';
import { holeAktivesEvent } from './fach/events.js';
import { Druckschleife, offeneAuftraege } from './fach/druckwarteschlange.js';
import { MockKamera } from './treiber/kamera-mock.js';
import { DigiCamControlKamera } from './treiber/kamera-digicamcontrol.js';
import { MockDrucker } from './treiber/drucker-mock.js';
import { istDnp, listeWindowsDrucker, WindowsDrucker, type GefundenerDrucker } from './treiber/drucker-windows.js';
import { deuteDnpStatus, findeCspStat, leseDnpVorrat, suchorte, type DnpVorrat } from './treiber/dnp-vorrat.js';
import type { KameraGrund, KameraTreiber } from './treiber/kamera.js';
import {
  cameraControlExe,
  DigiCamControlWaechter,
  programmVorhanden,
  windowsSteuerung,
  type Massnahme,
} from './treiber/digicamcontrol-waechter.js';
import type { DruckerStatus, DruckerTreiber } from './treiber/drucker.js';
import type { Betriebsstatus, DruckerVorrat, Stoerung } from '../shared/typen.js';
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
  /** Was Windows zuletzt ueber den Drucker gesagt hat - fuer die Anzeige unter Geraet. */
  letzterDruckerStatus: DruckerStatus | null = null;
  /** Warum die Kamera nicht bereit ist; null, wenn sie es ist. */
  private kameraGrund: KameraGrund | 'webserver-aus' | null = 'antwortet-nicht';
  private kameraAntwortete = false;
  private druckerStoerung: Stoerung | null = null;
  private liveViewGewuenscht = false;
  private letztesLiveBild: Buffer | null = null;
  private letztesLiveBildZeit = 0;
  private beobachtungLaeuft = false;
  private beendet = false;
  /** Nur mit echter Hardware unter Windows: haelt digiCamControl am Leben. */
  private readonly kameraProgramm: DigiCamControlWaechter | null;
  private letzteMassnahme: Massnahme = 'nichts';
  private letzteDruckMeldung = '';

  constructor(private readonly optionen: BetriebOptionen) {
    const geraet = leseGeraet();
    this.kamera = optionen.echteHardware
      ? new DigiCamControlKamera()
      : new MockKamera();
    this.drucker = optionen.echteHardware
      ? new WindowsDrucker(geraet.druckerName)
      : new MockDrucker(optionen.mockDruckOrdner);
    const exe = () => cameraControlExe(leseGeraet().digicamcontrolPfad);
    this.kameraProgramm =
      optionen.echteHardware && process.platform === 'win32'
        ? new DigiCamControlWaechter(windowsSteuerung(exe), programmVorhanden(exe))
        : null;
    this.druckschleife = new Druckschleife(
      () => this.drucker,
      (text) => protokolliere('warnung', 'druck', text),
      (status) => this.uebernimmDruckerStatus(status),
      (meldung, kopien) => {
        this.letzteDruckUebergabe = Date.now();
        this.blattSeitLesung += kopien;
        // Einmal ins Protokoll, nicht bei jedem Blatt: Welches Papier der
        // Treiber genommen hat, aendert sich nur, wenn jemand dort etwas umstellt.
        if (!meldung || meldung === this.letzteDruckMeldung) return;
        this.letzteDruckMeldung = meldung;
        protokolliere('info', 'druck', `An Windows uebergeben. ${meldung}`);
      },
      // Waehrend der Drucker nach seinem Vorrat gefragt wird, nicht drucken.
      () => this.vorratAbfrage ?? Promise.resolve(),
    );
  }

  // -------------------------------------------------------------------------
  // Papiervorrat direkt vom DNP-Drucker
  // -------------------------------------------------------------------------

  /** Zuletzt vom Drucker gelesen - samt Zeitpunkt. */
  private vorrat: (DnpVorrat & { gelesen: number }) | null = null;
  /** Blatt, die seit dem Lesen an Windows gingen - so stimmt die Zahl auch zwischen zwei Abfragen. */
  private blattSeitLesung = 0;
  private letzteDruckUebergabe = 0;
  private vorratAbfrage: Promise<void> | null = null;
  private letzterVorratVersuch = 0;
  /** Warum der Vorrat nicht gelesen werden kann; null, wenn es klappt. */
  vorratHinweis: string | null = null;
  private dnpDll: string | null | undefined = undefined;

  /** Wie lange der Drucker nach dem letzten Auftrag noch arbeitet, bevor er gefragt werden darf. */
  private static readonly RUHE_NACH_DRUCK_MS = 90_000;
  /** Ohne Druck reicht es, den Vorrat alle zehn Minuten zu lesen - etwa nach einem Rollenwechsel. */
  private static readonly VORRAT_ALLE_MS = 10 * 60_000;

  /** Kann die Box den Vorrat ueberhaupt beim Drucker erfragen? Nur echte Hardware unter Windows mit DNP. */
  vorratLesbar(): boolean {
    if (!this.optionen.echteHardware || process.platform !== 'win32') return false;
    const name = leseGeraet().druckerName;
    return Boolean(name) && istDnp(name, '');
  }

  /** Ruht der Drucker? Laut DNP kann eine Abfrage waehrend des Druckens ihn blockieren. */
  private druckerRuht(): boolean {
    return (
      !this.druckerBeschaeftigt &&
      offeneAuftraege() === 0 &&
      Date.now() - this.letzteDruckUebergabe >= Betrieb.RUHE_NACH_DRUCK_MS
    );
  }

  private vorratFaellig(): boolean {
    if (!this.vorratLesbar() || this.vorratAbfrage || this.aktiveSitzung || !this.druckerRuht()) return false;
    const seitVersuch = Date.now() - this.letzterVorratVersuch;
    if (!this.vorrat) return seitVersuch >= Betrieb.VORRAT_ALLE_MS || this.letzterVorratVersuch === 0;
    if (this.blattSeitLesung > 0) return seitVersuch >= 30_000;
    return seitVersuch >= Betrieb.VORRAT_ALLE_MS;
  }

  /**
   * Den Vorrat beim Drucker lesen. Nur, wenn er ruht - auch auf Knopfdruck.
   * @returns die Restblaetter oder null mit Grund in vorratHinweis
   */
  async leseDruckerVorrat(): Promise<number | null> {
    if (!this.vorratLesbar()) {
      this.vorratHinweis = 'Nur mit einem DNP-Drucker unter Windows.';
      return null;
    }
    if (this.vorratAbfrage) await this.vorratAbfrage;
    else if (!this.druckerRuht()) {
      this.vorratHinweis = 'Der Drucker arbeitet gerade - gefragt wird, sobald er ruht.';
      return null;
    } else {
      this.vorratAbfrage = this.frageVorrat().finally(() => {
        this.vorratAbfrage = null;
      });
      await this.vorratAbfrage;
    }
    return this.vorrat ? this.vorrat.rest : null;
  }

  private async frageVorrat(): Promise<void> {
    this.letzterVorratVersuch = Date.now();
    // Einmal gefunden, bleibt der Pfad; sonst bei jedem Versuch neu suchen
    // (hoechstens alle zehn Minuten oder auf Knopfdruck).
    if (!this.dnpDll) {
      this.dnpDll = findeCspStat();
      if (this.dnpDll) protokolliere('info', 'druck', `DNP PrinterInfo gefunden: ${this.dnpDll}`);
    }
    if (!this.dnpDll) {
      const gesucht = suchorte();
      this.vorratHinweis =
        'CspStat.dll von DNP PrinterInfo nicht gefunden' +
        (gesucht.length > 0 ? ` (gesucht in ${gesucht.join(', ')}).` : ' - auf C: gibt es keinen Ordner mit "DNP" im Namen.') +
        ' Damit liest die Fotobox den Papiervorrat direkt vom Drucker.';
      return;
    }
    const blattVorher = this.blattSeitLesung;
    try {
      const gelesen = await leseDnpVorrat(this.dnpDll);
      const vorher = this.vorrat?.rest;
      this.vorrat = { ...gelesen, gelesen: Date.now() };
      // Was waehrend der Abfrage gedruckt wurde, zaehlt weiter.
      this.blattSeitLesung = Math.max(0, this.blattSeitLesung - blattVorher);
      if (this.vorratHinweis || vorher === undefined) {
        protokolliere('info', 'druck', `Papiervorrat laut Drucker: ${gelesen.rest} Blatt.`);
      }
      else if (vorher !== undefined && gelesen.rest > vorher + 5) {
        protokolliere('info', 'druck', `Neue Rolle erkannt: ${gelesen.rest} Blatt laut Drucker.`);
      }
      this.vorratHinweis = null;
    } catch (fehler) {
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      if (text !== this.vorratHinweis) protokolliere('warnung', 'druck', `Papiervorrat nicht lesbar: ${text}`);
      this.vorratHinweis = text;
    }
  }

  /** Der Vorrat, wie ihn die Oberflaeche zeigt. Ein Tag alter Wert gilt nicht mehr. */
  druckerVorrat(): DruckerVorrat | null {
    if (!this.vorrat || Date.now() - this.vorrat.gelesen > 24 * 3600_000) return null;
    return {
      rest: Math.max(0, this.vorrat.rest - this.blattSeitLesung),
      gesamt: this.vorrat.gesamt,
      zustand: deuteDnpStatus(this.vorrat.status),
      gelesen: new Date(this.vorrat.gelesen).toISOString(),
      nachgerechnet: this.blattSeitLesung > 0,
    };
  }

  /**
   * Restblaetter laut Drucker - null, wenn er gerade nichts meldet. Einen
   * selbst gezaehlten Ersatzwert gibt es bewusst nicht mehr: Er lief neben der
   * echten Zahl her und stimmte nach dem ersten Rollenwechsel nicht mehr.
   */
  materialRest(): number | null {
    return this.druckerVorrat()?.rest ?? null;
  }

  /** Ein frisch gelesener Druckerzustand - aus der Beobachtung oder vor einem Druck. */
  private uebernimmDruckerStatus(status: DruckerStatus): void {
    this.letzterDruckerStatus = status;
    this.letzteDruckerPruefung = Date.now();
    this.druckerBeschaeftigt = (status.auftraegeBeimSystem ?? 0) > 0;
    this.druckerStoerung =
      status.zustand === 'papier-leer'
        ? 'papier-leer'
        : status.zustand === 'offline'
          ? 'drucker-offline'
          : status.zustand === 'klappe'
            ? 'drucker-klappe'
            : null;
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

  /** Die Drucker, die Windows kennt. Ohne echte Hardware der Mock-Drucker. */
  async druckerListe(): Promise<GefundenerDrucker[]> {
    if (this.optionen.echteHardware && process.platform === 'win32') return listeWindowsDrucker();
    return [{ name: 'Mock-Drucker', treiber: 'Mock', anschluss: 'Datei', offline: false, dnp: false }];
  }

  /** Treiber neu aufbauen, etwa nachdem der Druckername geaendert wurde. */
  ladeTreiberNeu(): void {
    const geraet = leseGeraet();
    if (this.optionen.echteHardware) {
      this.drucker = new WindowsDrucker(geraet.druckerName);
    }
    // Der neue Drucker soll sofort gefragt werden, nicht erst in 20 Sekunden.
    this.letzteDruckerPruefung = 0;
    // Ein Fehldruck mit dem alten Drucker soll den neuen nicht blockieren.
    this.druckschleife.gibFrei();
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

  /**
   * Liefert die Kamera gerade Bilder? Laeuft der Abholer, genuegt ein Blick auf
   * sein letztes Bild; sonst wird die Kamera einmal direkt gefragt. Ein Bild,
   * das Byte fuer Byte dem vorigen gleicht, zaehlt nicht - das ist ein
   * eingefrorenes Bild, kein Live-Bild.
   */
  async liveBildDa(): Promise<boolean> {
    if (Date.now() - this.letztesLiveBildZeit < 1500) return true;
    if (this.abholerLaeuft) return false;
    const bild = await this.kamera.liveBild().catch(() => null);
    if (!bild || (this.letztesLiveBild && bild.equals(this.letztesLiveBild))) return false;
    this.letztesLiveBild = bild;
    this.letztesLiveBildZeit = Date.now();
    return true;
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
        const vorherigerGrund = this.kameraGrund;
        this.kameraGrund = kameraStatus.verbunden ? null : (kameraStatus.grund ?? 'antwortet-nicht');

        // Frisch gestartet, oeffnet digiCamControl sein Fenster ueber dem
        // Kiosk. Sobald es antwortet, wieder minimieren.
        // Der Webserver antwortet oft schon, bevor das Hauptfenster steht -
        // deshalb nach 5 und 15 Sekunden noch einmal.
        if (kameraStatus.antwortet && !this.kameraAntwortete) {
          await this.kamera.fensterWeg?.().catch(() => undefined);
          for (const nachMs of [5000, 15_000]) {
            setTimeout(() => void this.kamera.fensterWeg?.().catch(() => undefined), nachMs).unref?.();
          }
        }
        this.kameraAntwortete = kameraStatus.antwortet;

        if (this.kameraGrund === 'befehle-gesperrt' && vorherigerGrund !== 'befehle-gesperrt') {
          protokolliere(
            'fehler',
            'kamera',
            'digiCamControl antwortet, fuehrt aber keine Befehle aus. In digiCamControl unter File > Settings > ' +
              'Webserver den Haken "Interaktion ueber Webserver erlauben" setzen.',
          );
        }

        if (this.kameraProgramm) {
          const massnahme = await this.kameraProgramm.pruefe(kameraStatus.antwortet);
          if (massnahme === 'gestartet') protokolliere('info', 'kamera', 'digiCamControl gestartet.');
          if (massnahme === 'neu-gestartet') {
            protokolliere('warnung', 'kamera', 'digiCamControl antwortete nicht mehr und wurde neu gestartet.');
          }
          // Nur einmal melden, nicht alle drei Sekunden.
          if (massnahme === 'programm-fehlt' && this.letzteMassnahme !== 'programm-fehlt') {
            protokolliere('fehler', 'kamera', 'digiCamControl ist nicht installiert oder der Pfad unter Geraet stimmt nicht.');
          }
          if (massnahme === 'webserver-aus' && this.letzteMassnahme !== 'webserver-aus') {
            protokolliere(
              'fehler',
              'kamera',
              'digiCamControl laeuft, sein Webserver antwortet aber nicht. In digiCamControl unter File > Settings > ' +
                'Webserver "Benutze Webserver" und "Interaktion ueber Webserver erlauben" anhaken, Port 5513, ' +
                'dann digiCamControl schliessen - die Fotobox startet es neu.',
            );
          }
          if (massnahme === 'webserver-aus' && !kameraStatus.antwortet) this.kameraGrund = 'webserver-aus';
          if (massnahme !== 'nichts') this.letzteMassnahme = massnahme;
          if (kameraStatus.antwortet) this.letzteMassnahme = 'nichts';
        }

        // Live-View nach Leerlauf abschalten. Die Einstellung stand in der
        // Verwaltung, wirkte aber nirgends - die 600D blieb den ganzen Abend im
        // Live-View, und der Sensor wird dabei warm (mehr Bildrauschen). Die
        // naechste Sitzung schaltet ihn wieder ein; das Bereitmachen vor dem
        // ersten Foto ueberbrueckt die Sekunde, die das dauert.
        const abschaltenNachS = holeAktivesEvent()?.einstellungen.zeiten.liveViewAbschaltung ?? 0;
        if (
          this.liveViewGewuenscht &&
          abschaltenNachS > 0 &&
          !this.aktiveSitzung &&
          this.zuschauer.size === 0 &&
          Date.now() - this.letzteBeruehrung > abschaltenNachS * 1000
        ) {
          await this.stoppeLiveView();
          protokolliere('info', 'kamera', 'Live-View nach Leerlauf abgeschaltet - schont den Sensor.');
        }

        // Speicher: guenstig zu lesen, also jede Runde.
        // Laesst sich der Wert nicht lesen, wird nicht gewarnt - sonst stuende
        // wegen eines Lesefehlers "Speicher voll" vor den Gaesten.
        const frei = await statfs(leseGeraet().datenpfad)
          .then((info) => (info.bavail * info.bsize) / 1024 ** 3)
          .catch(() => null);
        this.speicherKnapp = frei !== null && frei < SPEICHER_KNAPP_GB;

        // Verbindung war weg und ist wieder da: Live-View neu aufbauen.
        if (!warVerbunden && this.kameraOk && this.liveViewGewuenscht) {
          await this.kamera.starteLiveView().catch(() => undefined);
          protokolliere('info', 'kamera', 'Kamera ist wieder verbunden.');
        }

        if (this.vorratFaellig()) await this.leseDruckerVorrat();

        if (!this.druckerPruefungFaellig()) {
          await pause(3000);
          continue;
        }
        this.letzteDruckerPruefung = Date.now();
        const druckerStatus = await this.drucker.pruefe();
        this.druckschleife.merkeStatus(druckerStatus);
        this.uebernimmDruckerStatus(druckerStatus);
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
  /** Liegen Auftraege bei Windows, die noch nicht gedruckt sind? */
  private druckerBeschaeftigt = false;
  private speicherKnapp = false;

  private druckerPruefungFaellig(): boolean {
    const wachsam =
      this.druckerStoerung !== null ||
      this.druckerBeschaeftigt ||
      this.druckschleife.istAngehalten() ||
      offeneAuftraege() > 0;
    if (!wachsam && this.aktiveSitzung) return false;
    const abstand = wachsam ? 3000 : 20_000;
    return Date.now() - this.letzteDruckerPruefung >= abstand;
  }

  /**
   * Den Drucker jetzt fragen, wenn die letzte Antwort aelter ist als
   * `maxAlterMs`. Ruht der Drucker, wird er nur alle 20 Sekunden gefragt - so
   * lange konnte die Quittung "gleich am Drucker abholen" versprechen, obwohl
   * die Rolle leer war. Hoechstens `zeitlimitMs` Wartezeit; antwortet er nicht,
   * bleibt es beim letzten Stand.
   */
  async frischerDruckerStatus(maxAlterMs = 5000, zeitlimitMs = 2500): Promise<void> {
    if (Date.now() - this.letzteDruckerPruefung < maxAlterMs) return;
    this.letzteDruckerPruefung = Date.now();
    const status = await Promise.race([
      this.drucker.pruefe().catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), zeitlimitMs)),
    ]);
    if (!status) return;
    this.druckschleife.merkeStatus(status);
    this.uebernimmDruckerStatus(status);
  }

  /**
   * Die eine Stoerung, die dem Gast angezeigt wird. Reihenfolge nach
   * Dringlichkeit: Was den Ablauf blockiert, kommt zuerst.
   */
  aktuelleStoerung(): Stoerung | null {
    if (!this.kameraOk) return 'kamera-offline';
    if (this.druckschleife.istAngehalten()) return this.druckerStoerung ?? 'drucker-offline';
    if (this.druckerStoerung) return this.druckerStoerung;
    // Der Drucker meldet nichts, aber bei Windows bewegt sich seit Minuten
    // nichts: Dann klemmt etwas, was der Treiber nicht als Fehler meldet.
    if (this.druckschleife.stehtStill()) return 'drucker-klappe';
    // Knapper Speicher haelt nichts an - er ist nur ein Hinweis, damit
    // rechtzeitig jemand Bescheid sagt.
    if (this.speicherKnapp) return 'speicher-voll';
    return null;
  }

  async status(): Promise<Betriebsstatus> {
    const event = holeAktivesEvent();
    const geraet = leseGeraet();
    return {
      kamera: this.kameraOk ? 'bereit' : 'gestoert',
      kameraHinweis: this.kameraOk ? null : kameraHinweis(this.kameraGrund),
      drucker: this.druckerStoerung ? 'gestoert' : 'bereit',
      liveViewLaeuft: this.liveViewGewuenscht,
      stoerung: this.aktuelleStoerung(),
      warteschlangeOffen: offeneAuftraege(),
      materialRest: this.materialRest(),
      druckerVorrat: this.druckerVorrat(),
      speicherFreiGb: await freierSpeicherGb(geraet.datenpfad),
      aktivesEvent: event ? { id: event.id, name: event.name, probelauf: event.probelauf } : null,
    };
  }
}

/** Was bei einer nicht bereiten Kamera zu tun ist - fuer Startbereit-Check und Verwaltung. */
export function kameraHinweis(grund: KameraGrund | 'webserver-aus' | null): string {
  switch (grund) {
    case 'keine-kamera':
      return 'digiCamControl laeuft, sieht aber keine Kamera. USB-Kabel pruefen und die Kamera einschalten.';
    case 'befehle-gesperrt':
      return 'digiCamControl antwortet, nimmt aber keine Befehle an. Dort unter File > Settings > Webserver ' +
        '"Interaktion ueber Webserver erlauben" anhaken.';
    case 'webserver-aus':
      return 'digiCamControl laeuft, aber sein Webserver ist aus. Dort unter File > Settings > Webserver ' +
        '"Benutze Webserver" und "Interaktion ueber Webserver erlauben" anhaken, Port 5513, dann digiCamControl schliessen.';
    default:
      return 'digiCamControl antwortet nicht. Laeuft das Programm? Webserver auf Port 5513 eingeschaltet?';
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

/** Unter dieser Grenze meldet die Box "Speicher wird eng" - dieselbe Schwelle,
 *  ab der die Statusliste rot zeigt. */
const SPEICHER_KNAPP_GB = 2;

/** Zehn Bilder je Sekunde: genug zum Ausrichten, und mehr liefert die 600D
 *  ueber USB ohnehin kaum. */
const LIVE_TAKT_MS = 100;

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
