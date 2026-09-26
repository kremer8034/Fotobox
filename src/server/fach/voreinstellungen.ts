import { randomUUID } from 'node:crypto';
import { holeDb, jetzt } from '../db/index.js';
import { listeFilter } from './filter.js';
import { holeVorlage } from './vorlagen.js';
import { EINSTELLUNGEN_VORGABE, FILTER_OHNE, type EventEinstellungen } from '../../shared/typen.js';

/**
 * Voreinstellungen: die Einstellungen einer Veranstaltung unter einem Namen
 * aufheben und fuer die naechste wiederverwenden.
 *
 * Verleih-Veranstaltungen aehneln sich stark - eine Kinderparty will wenige
 * Kopien und ein Druck-Limit, eine Hochzeit E-Mail und die Galerie. Statt vor
 * jeder Buchung dieselben zwanzig Felder neu zu setzen, waehlt man beim
 * Anlegen die passende Voreinstellung.
 */

export interface Voreinstellung {
  id: string;
  name: string;
  einstellungen: EventEinstellungen;
  erstellt: string;
  geaendert: string;
}

interface Zeile {
  id: string;
  name: string;
  einstellungen: string;
  erstellt: string;
  geaendert: string;
}

function zuVoreinstellung(zeile: Zeile): Voreinstellung {
  return {
    id: zeile.id,
    name: zeile.name,
    einstellungen: { ...EINSTELLUNGEN_VORGABE, ...(JSON.parse(zeile.einstellungen) as Partial<EventEinstellungen>) },
    erstellt: zeile.erstellt,
    geaendert: zeile.geaendert,
  };
}

export function listeVoreinstellungen(): Voreinstellung[] {
  return (holeDb().prepare('SELECT * FROM voreinstellungen ORDER BY name COLLATE NOCASE').all() as Zeile[]).map(
    zuVoreinstellung,
  );
}

export function holeVoreinstellung(id: string): Voreinstellung | null {
  const zeile = holeDb().prepare('SELECT * FROM voreinstellungen WHERE id = ?').get(id) as Zeile | undefined;
  return zeile ? zuVoreinstellung(zeile) : null;
}

/** Speichert unter dem Namen - ein vorhandener gleichen Namens wird ueberschrieben. */
export function speichereVoreinstellung(name: string, einstellungen: EventEinstellungen): Voreinstellung {
  const zeit = jetzt();
  holeDb()
    .prepare(
      `INSERT INTO voreinstellungen (id, name, einstellungen, erstellt, geaendert) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET einstellungen = excluded.einstellungen, geaendert = excluded.geaendert`,
    )
    .run(randomUUID(), name, JSON.stringify(einstellungen), zeit, zeit);
  const zeile = holeDb().prepare('SELECT * FROM voreinstellungen WHERE name = ?').get(name) as Zeile;
  return zuVoreinstellung(zeile);
}

export function loescheVoreinstellung(id: string): boolean {
  return holeDb().prepare('DELETE FROM voreinstellungen WHERE id = ?').run(id).changes > 0;
}

/**
 * Einstellungen fuer eine neue Veranstaltung uebernehmen. Vorlagen und
 * Filter, die es inzwischen nicht mehr gibt, fallen heraus - sonst stuende
 * die neue Veranstaltung mit toten Verweisen da, und der Startbereit-Check
 * meldete eine Vorlage, die man nirgends mehr findet.
 */
export function uebernehmbar(einstellungen: EventEinstellungen): EventEinstellungen {
  const filterIds = new Set(listeFilter().map((f) => f.id));
  const filter = einstellungen.filter.filter((id) => filterIds.has(id));
  return {
    ...einstellungen,
    vorlagen: einstellungen.vorlagen.filter((id) => holeVorlage(id) !== null),
    filter: filter.includes(FILTER_OHNE) ? filter : [FILTER_OHNE, ...filter],
  };
}
