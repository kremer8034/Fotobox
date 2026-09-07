import { randomUUID } from 'node:crypto';
import { holeDb, jetzt } from '../db/index.js';
import { verbucheMaterial } from './events.js';
import type { DruckQuelle, Druckauftrag, DruckStatus } from '../../shared/typen.js';
import type { DruckerTreiber } from '../treiber/drucker.js';

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
 */

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

  constructor(
    private readonly drucker: () => DruckerTreiber,
    private readonly protokoll: (text: string) => void,
  ) {}

  starte(): void {
    if (this.laeuft) return;
    this.laeuft = true;
    void this.schleife();
  }

  stoppe(): void {
    this.gestoppt = true;
  }

  /** "Papier gewechselt" im Servicemenue. */
  fortsetzen(): void {
    this.angehalten = false;
    this.letzterFehler = null;
    holeDb()
      .prepare("UPDATE druckauftraege SET status = 'wartend' WHERE status = 'fehlgeschlagen'")
      .run();
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
