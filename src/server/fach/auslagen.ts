import { writeFile } from 'node:fs/promises';
import { holeDb } from '../db/index.js';
import { eventpfade } from './pfade.js';
import type { Veranstaltung } from '../../shared/typen.js';

/**
 * Auslagenersatz und Zaehlung.
 *
 * Die Box wird privat und nicht kommerziell verliehen; ersetzt werden nur die
 * Materialkosten. Deshalb genau ein Feld: Auslagenersatz je Druck, vorbelegt
 * mit 0,20 Euro. Keine Pauschalen, keine Freikontingente, keine Rechnungslogik.
 *
 * Fehldrucke zaehlen nicht: Nur ein Auftrag mit Status "gedruckt" und Kennzeichen
 * "berechnen" geht in die Summe. Probelauf-Sitzungen sowie Layout- und
 * Kalibrier-Testdrucke bleiben komplett aussen vor.
 */

export interface Auslagenuebersicht {
  eventId: string;
  eventName: string;
  datum: string;
  sitzungen: number;
  fotos: number;
  layouts: number;
  druckeGesamt: number;
  druckeNachQuelle: Record<string, number>;
  druckeNichtBerechnet: number;
  druckeFehlgeschlagen: number;
  emails: number;
  ersatzJeDruck: number;
  betrag: number;
  materialStart: number;
  materialVerbraucht: number;
  materialRest: number;
}

export function berechneAuslagen(event: Veranstaltung): Auslagenuebersicht {
  const db = holeDb();

  const eineZahl = (sql: string, ...werte: unknown[]): number =>
    (db.prepare(sql).get(...werte) as { n: number }).n;

  const sitzungen = eineZahl(
    'SELECT COUNT(*) AS n FROM sitzungen WHERE event_id = ? AND ist_test = 0',
    event.id,
  );
  const fotos = eineZahl(
    `SELECT COUNT(*) AS n FROM fotos f JOIN sitzungen s ON s.id = f.sitzung_id
      WHERE s.event_id = ? AND s.ist_test = 0`,
    event.id,
  );
  const layouts = eineZahl(
    `SELECT COUNT(*) AS n FROM ausgaben a JOIN sitzungen s ON s.id = a.sitzung_id
      WHERE s.event_id = ? AND s.ist_test = 0`,
    event.id,
  );

  const berechnet = eineZahl(
    `SELECT COALESCE(SUM(kopien), 0) AS n FROM druckauftraege
      WHERE event_id = ? AND status = 'gedruckt' AND berechnen = 1 AND quelle <> 'testdruck'`,
    event.id,
  );
  const nichtBerechnet = eineZahl(
    `SELECT COALESCE(SUM(kopien), 0) AS n FROM druckauftraege
      WHERE event_id = ? AND status = 'gedruckt' AND (berechnen = 0 OR quelle = 'testdruck')`,
    event.id,
  );
  const fehlgeschlagen = eineZahl(
    `SELECT COALESCE(SUM(kopien), 0) AS n FROM druckauftraege
      WHERE event_id = ? AND status = 'fehlgeschlagen'`,
    event.id,
  );

  const quellen = db
    .prepare(
      `SELECT quelle, COALESCE(SUM(kopien), 0) AS n FROM druckauftraege
        WHERE event_id = ? AND status = 'gedruckt' AND berechnen = 1 AND quelle <> 'testdruck'
        GROUP BY quelle`,
    )
    .all(event.id) as { quelle: string; n: number }[];

  const emails = eineZahl(
    "SELECT COUNT(*) AS n FROM versand WHERE event_id = ? AND kanal = 'email'",
    event.id,
  );

  const betrag = Math.round(berechnet * event.einstellungen.ersatzJeDruck * 100) / 100;

  return {
    eventId: event.id,
    eventName: event.name,
    datum: event.datum,
    sitzungen,
    fotos,
    layouts,
    druckeGesamt: berechnet,
    druckeNachQuelle: Object.fromEntries(quellen.map((q) => [q.quelle, q.n])),
    druckeNichtBerechnet: nichtBerechnet,
    druckeFehlgeschlagen: fehlgeschlagen,
    emails,
    ersatzJeDruck: event.einstellungen.ersatzJeDruck,
    betrag,
    materialStart: event.einstellungen.materialStart,
    materialVerbraucht: event.materialVerbraucht,
    materialRest: Math.max(0, event.einstellungen.materialStart - event.materialVerbraucht),
  };
}

export function alsCsv(u: Auslagenuebersicht): string {
  const zahl = (n: number) => n.toFixed(2).replace('.', ',');
  const zeilen: [string, string][] = [
    ['Veranstaltung', u.eventName],
    ['Datum', u.datum],
    ['Sitzungen', String(u.sitzungen)],
    ['Fotos', String(u.fotos)],
    ['Fertige Layouts', String(u.layouts)],
    ['Drucke berechnet', String(u.druckeGesamt)],
    ['davon Kiosk', String(u.druckeNachQuelle.kiosk ?? 0)],
    ['davon Galerie-Nachdruck', String(u.druckeNachQuelle.galerie ?? 0)],
    ['davon Servicemenue', String(u.druckeNachQuelle.servicemenue ?? 0)],
    ['Drucke nicht berechnet', String(u.druckeNichtBerechnet)],
    ['Fehlgeschlagene Drucke', String(u.druckeFehlgeschlagen)],
    ['E-Mails', String(u.emails)],
    ['Auslagenersatz je Druck (EUR)', zahl(u.ersatzJeDruck)],
    ['Betrag (EUR)', zahl(u.betrag)],
    ['Material Start (Blatt)', String(u.materialStart)],
    ['Material verbraucht (Blatt)', String(u.materialVerbraucht)],
    ['Material Rest (Blatt)', String(u.materialRest)],
  ];
  // Semikolon als Trenner, damit Excel im deutschen Gebietsschema die Datei
  // ohne Importdialog oeffnet.
  return zeilen.map(([a, b]) => `${a};${b}`).join('\r\n') + '\r\n';
}

export async function schreibeAuslagenCsv(event: Veranstaltung): Promise<string> {
  const uebersicht = berechneAuslagen(event);
  const pfad = eventpfade(event.ordner).auslagenCsv;
  await writeFile(pfad, alsCsv(uebersicht), 'utf8');
  return pfad;
}
