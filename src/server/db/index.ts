import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

let db: DB | null = null;

/**
 * Oeffnet die Datenbank und legt das Schema an, falls noetig.
 * WAL-Modus, damit ein Stromausfall mitten im Schreiben die Datei nicht zerlegt.
 */
export function oeffneDb(pfad: string): DB {
  mkdirSync(dirname(pfad), { recursive: true });
  const verbindung = new Database(pfad);
  verbindung.pragma('journal_mode = WAL');
  verbindung.pragma('foreign_keys = ON');
  // Beim gebauten Server liegt das Schema neben der JS-Datei, im Entwicklungs-
  // modus neben der TS-Datei - in beiden Faellen also im selben Verzeichnis.
  // Im Build landet es dort nur durch skripte/anlagen-kopieren.mjs, weil
  // TypeScript ausschliesslich .ts-Dateien uebersetzt.
  const schemaPfad = join(hier, 'schema.sql');
  let schema: string;
  try {
    schema = readFileSync(schemaPfad, 'utf8');
  } catch {
    verbindung.close();
    throw new Error(
      `Das Datenbankschema fehlt (${schemaPfad}). ` +
        'Bitte "npm run build" ausfuehren - der Build kopiert es in den Ausgabeordner.',
    );
  }
  verbindung.exec(schema);
  ergaenzeSpalten(verbindung);
  db = verbindung;
  return verbindung;
}

/**
 * Spalten, die nach der ersten Auslieferung dazukamen. "CREATE TABLE IF NOT
 * EXISTS" legt sie in einer vorhandenen Datenbank nicht an - hier werden sie
 * nachgetragen, ohne etwas Bestehendes anzufassen.
 */
function ergaenzeSpalten(verbindung: DB): void {
  const nachtraege: { tabelle: string; spalte: string; definition: string }[] = [
    { tabelle: 'ausgaben', spalte: 'verborgen', definition: 'INTEGER NOT NULL DEFAULT 0' },
  ];
  for (const { tabelle, spalte, definition } of nachtraege) {
    const vorhanden = (verbindung.prepare(`PRAGMA table_info(${tabelle})`).all() as { name: string }[]).some(
      (s) => s.name === spalte,
    );
    if (!vorhanden) verbindung.exec(`ALTER TABLE ${tabelle} ADD COLUMN ${spalte} ${definition}`);
  }
}

export function holeDb(): DB {
  if (!db) throw new Error('Datenbank ist noch nicht geoeffnet.');
  return db;
}

export function schliesseDb(): void {
  db?.close();
  db = null;
}

/** Zeitstempel im ISO-Format, wie er ueberall in der Datenbank steht. */
export function jetzt(): string {
  return new Date().toISOString();
}
