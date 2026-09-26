import { randomUUID } from 'node:crypto';
import { holeDb, jetzt } from '../db/index.js';
import { verbucheMaterial } from './events.js';
import type { DruckQuelle, Druckauftrag, DruckStatus } from '../../shared/typen.js';
import { druckerBlockiert, type DruckerStatus, type DruckerTreiber } from '../treiber/drucker.js';

/**
 * Druckwarteschlange.
 *
 * Bei 12,4 Sekunden je Blatt ist der Druck der Flaschenhals, nicht der Rechner.
 * Deshalb ist die Warteschlange kein Komfort, sondern Notwendigkeit: Der Gast
 * bekommt sofort "Dein Bild wird gedruckt" und macht Platz, der naechste kann
 * schon fotografieren.
 *
 * Faellt der Drucker aus, bleiben die Auftraege stehen, statt still verloren zu
 * gehen. Nach dem Papierwechsel laeuft die Schlange weiter.
 *
 * Wichtig dabei: Vor jedem Auftrag wird der Drucker gefragt. SumatraPDF meldet
 * "fertig", sobald der Auftrag in der Windows-Warteschlange liegt - auch bei
 * leerem Papier. Vorher wanderte deshalb bei einer leeren Rolle alles sofort
 * zu Windows, galt als gedruckt und war fuer unsere Schlange verloren: kein
 * Warten, kein Fortsetzen, falsche Zaehlung. Jetzt bleibt ein Auftrag bei uns,
 * bis der Drucker bereit ist, und Windows bekommt nie mehr als zwei auf einmal.
 */

/** So viele Auftraege duerfen gleichzeitig bei Windows liegen. */
const HOECHSTENS_BEIM_SYSTEM = 2;
/** Bewegt sich bei Windows so lange nichts, klemmt etwas. Ein Blatt dauert
 *  12,4 s; drei Kopien und ein kalter Drucker bleiben weit darunter. */
const STILLSTAND_MS = 180_000;

interface AuftragZeile {
  id: string;
  event_id: string;
  ausgabe_id: string | null;
  kopien: number;
  quelle: string;
  status: string;
  berechnen: number;
  angefordert: string;
  gedruckt: string | null;
  fehlertext: string | null;
  pfad_pdf: string;
}

function zuAuftrag(zeile: AuftragZeile): Druckauftrag & { pfadPdf: string } {
  return {
    id: zeile.id,
    eventId: zeile.event_id,
    ausgabeId: zeile.ausgabe_id,
    kopien: zeile.kopien,
    quelle: zeile.quelle as DruckQuelle,
    status: zeile.status as DruckStatus,
    berechnen: zeile.berechnen === 1,
    angefordert: zeile.angefordert,
    gedruckt: zeile.gedruckt,
    fehlertext: zeile.fehlertext,
    pfadPdf: zeile.pfad_pdf,
  };
}

export function reiheEin(eingabe: {
  eventId: string;
  ausgabeId: string | null;
  pfadPdf: string;
  kopien: number;
  quelle: DruckQuelle;
  berechnen: boolean;
}): string {
  const id = randomUUID();
  holeDb()
    .prepare(
      `INSERT INTO druckauftraege
        (id, event_id, ausgabe_id, kopien, quelle, status, berechnen, angefordert, pfad_pdf)
       VALUES (?, ?, ?, ?, ?, 'wartend', ?, ?, ?)`,
    )
    .run(
      id,
      eingabe.eventId,
      eingabe.ausgabeId,
      eingabe.kopien,
      eingabe.quelle,
      eingabe.berechnen ? 1 : 0,
      jetzt(),
      eingabe.pfadPdf,
    );
  return id;
}

/**
 * Nach einem Neustart: Auftraege, die beim Absturz gerade liefen, wieder
 * anstellen. Vorher blieben sie fuer immer auf "laeuft" stehen - gedruckt
 * wurden sie nie, und die Statusseite meldete den ganzen Abend "1 Foto wird
 * gerade gedruckt".
 *
 * Lieber einmal zu viel drucken als ein Bild verlieren: Ob der Auftrag vor dem
 * Absturz noch beim Drucker ankam, laesst sich nicht sicher sagen. Ein
 * doppeltes Blatt kostet 20 Cent, ein fehlendes Bild einen enttaeuschten Gast.
 */
export function stelleUnterbrocheneWiederAn(): number {
  return holeDb()
    .prepare("UPDATE druckauftraege SET status = 'wartend' WHERE status = 'laeuft'")
    .run().changes;
}

/**
 * Wie viele Blatt eines Fotos Gaeste schon angestossen haben - am Ergebnis und
 * ueber die Galerie zusammen. Nachdrucke des Betreuers zaehlen nicht mit.
 * Auch fehlgeschlagene Auftraege zaehlen: Sie werden nach dem Papierwechsel
 * nachgeholt.
 */
export function gastKopienVon(ausgabeId: string): number {
  const zeile = holeDb()
    .prepare(
      "SELECT COALESCE(SUM(kopien), 0) AS n FROM druckauftraege WHERE ausgabe_id = ? AND quelle IN ('kiosk', 'galerie')",
    )
    .get(ausgabeId) as { n: number };
  return zeile.n;
}

/**
 * Eine Veranstaltung geht los: Was von frueheren Feiern noch auf den Druck
 * wartet, wird zurueckgestellt statt gedruckt.
 *
 * Endete eine Feier mit leerer Rolle, standen ihre letzten Auftraege weiter
 * auf "wartend" - und kamen mit der neuen Rolle als Erstes heraus, auf der
 * naechsten Veranstaltung, vor fremden Gaesten, abgerechnet bei der alten.
 * Jetzt gelten sie als nicht gedruckt; nachdrucken laesst sich jedes Bild
 * weiterhin aus der Verwaltung.
 *
 * @returns wie viele Auftraege zurueckgestellt wurden
 */
export function stelleFremdeZurueck(eventId: string): number {
  return holeDb()
    .prepare(
      `UPDATE druckauftraege
          SET status = 'fehlgeschlagen', fehlertext = 'Nicht gedruckt: Eine andere Veranstaltung wurde gestartet.'
        WHERE status = 'wartend' AND event_id <> ?`,
    )
    .run(eventId).changes;
}

export function offeneAuftraege(): number {
  const zeile = holeDb()
    .prepare("SELECT COUNT(*) AS n FROM druckauftraege WHERE status IN ('wartend','laeuft')")
    .get() as { n: number };
  return zeile.n;
}

export function listeAuftraege(eventId: string): (Druckauftrag & { pfadPdf: string })[] {
  const zeilen = holeDb()
    .prepare('SELECT * FROM druckauftraege WHERE event_id = ? ORDER BY angefordert DESC')
    .all(eventId) as AuftragZeile[];
  return zeilen.map(zuAuftrag);
}

/** Fehldruck nachtraeglich von der Abrechnung ausnehmen. */
export function setzeBerechnen(id: string, berechnen: boolean): void {
  holeDb().prepare('UPDATE druckauftraege SET berechnen = ? WHERE id = ?').run(berechnen ? 1 : 0, id);
}

/**
 * Arbeitet die Warteschlange ab. Laeuft als Schleife im Hintergrund und macht
 * nach einem Fehlschlag eine Pause, statt den Drucker in Grund und Boden zu
 * rennen.
 */
export class Druckschleife {
  private laeuft = false;
  private gestoppt = false;
  /** Nach einem Fehlschlag wartet die Schleife, bis der Betreuer fortsetzt. */
  private angehalten = false;
  letzterFehler: string | null = null;

  /** Seit wann die Zahl der Auftraege bei Windows unveraendert ueber null steht. */
  private stillstandSeit: number | null = null;
  private letzteAnzahlBeimSystem = 0;

  constructor(
    private readonly drucker: () => DruckerTreiber,
    private readonly protokoll: (text: string) => void,
    /** Jeder hier gelesene Druckerzustand geht auch an die Anzeige. */
    private readonly beiStatus: (status: DruckerStatus) => void = () => undefined,
  ) {}

  /** Klemmt ein Auftrag bei Windows schon so lange, dass jemand nachsehen muss? */
  stehtStill(): boolean {
    return this.stillstandSeit !== null && Date.now() - this.stillstandSeit >= STILLSTAND_MS;
  }

  /** Beobachtet, ob sich bei Windows etwas bewegt. */
  merkeStatus(status: DruckerStatus): void {
    const anzahl = status.auftraegeBeimSystem ?? 0;
    if (anzahl === 0 || anzahl !== this.letzteAnzahlBeimSystem) this.stillstandSeit = null;
    if (anzahl > 0 && this.stillstandSeit === null) this.stillstandSeit = Date.now();
    this.letzteAnzahlBeimSystem = anzahl;
  }

  starte(): void {
    if (this.laeuft) return;
    this.laeuft = true;
    void this.schleife();
  }

  stoppe(): void {
    this.gestoppt = true;
  }

  /**
   * "Papier gewechselt" im Servicemenue.
   *
   * Holt nur die Fehldrucke der laufenden Veranstaltung nach. Vorher kamen
   * alle fehlgeschlagenen Auftraege der Datenbank zurueck - auch die einer
   * Feier von vor Wochen, und deren Fotos fremder Leute kamen dann auf der
   * naechsten Hochzeit aus dem Drucker. Laeuft keine Veranstaltung (der
   * Besitzer zu Hause), wird alles nachgeholt.
   *
   * @returns wie viele Auftraege dieser Veranstaltung jetzt auf den Druck warten
   */
  fortsetzen(eventId: string | null = null): number {
    this.angehalten = false;
    this.letzterFehler = null;
    const db = holeDb();
    if (eventId) {
      db.prepare("UPDATE druckauftraege SET status = 'wartend' WHERE status = 'fehlgeschlagen' AND event_id = ?").run(
        eventId,
      );
      return (
        db
          .prepare("SELECT COUNT(*) AS n FROM druckauftraege WHERE status IN ('wartend','laeuft') AND event_id = ?")
          .get(eventId) as { n: number }
      ).n;
    }
    db.prepare("UPDATE druckauftraege SET status = 'wartend' WHERE status = 'fehlgeschlagen'").run();
    return offeneAuftraege();
  }

  istAngehalten(): boolean {
    return this.angehalten;
  }

  private async schleife(): Promise<void> {
    while (!this.gestoppt) {
      if (this.angehalten) {
        await pause(2000);
        continue;
      }
      const naechster = holeDb()
        .prepare("SELECT * FROM druckauftraege WHERE status = 'wartend' ORDER BY angefordert LIMIT 1")
        .get() as AuftragZeile | undefined;

      if (!naechster) {
        await pause(1000);
        continue;
      }

      // Erst fragen, dann schicken. Ist der Drucker blockiert oder liegt bei
      // Windows schon genug, bleibt der Auftrag bei uns und wartet - und geht
      // von selbst los, sobald wieder Papier drin ist.
      const status = await this.drucker()
        .pruefe()
        .catch((): DruckerStatus => ({ zustand: 'unbekannt' }));
      this.merkeStatus(status);
      this.beiStatus(status);
      if (druckerBlockiert(status.zustand) || (status.auftraegeBeimSystem ?? 0) >= HOECHSTENS_BEIM_SYSTEM) {
        await pause(3000);
        continue;
      }

      const auftrag = zuAuftrag(naechster);
      holeDb().prepare("UPDATE druckauftraege SET status = 'laeuft' WHERE id = ?").run(auftrag.id);

      try {
        await this.drucker().drucke(auftrag.pfadPdf, auftrag.kopien);
        holeDb()
          .prepare("UPDATE druckauftraege SET status = 'gedruckt', gedruckt = ?, fehlertext = NULL WHERE id = ?")
          .run(jetzt(), auftrag.id);
        // Ein Blatt je Kopie. Testdrucke zaehlen nicht in den Auslagenersatz,
        // verbrauchen aber sehr wohl Papier.
        verbucheMaterial(auftrag.eventId, auftrag.kopien);
        this.letzterFehler = null;
      } catch (fehler) {
        const text = fehler instanceof Error ? fehler.message : String(fehler);
        holeDb()
          .prepare("UPDATE druckauftraege SET status = 'fehlgeschlagen', fehlertext = ? WHERE id = ?")
          .run(text, auftrag.id);
        this.letzterFehler = text;
        this.angehalten = true;
        this.protokoll(`Druck fehlgeschlagen: ${text}`);
      }
    }
    this.laeuft = false;
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
