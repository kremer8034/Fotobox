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
  const schema = readFileSync(join(hier, 'schema.sql'), 'utf8');
  verbindung.exec(schema);
  db = verbindung;
  return verbindung;
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
