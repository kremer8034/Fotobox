import { z } from 'zod';
import { holeDb } from '../db/index.js';
import { EINGEBAUTE_FILTER } from '../bild/filter.js';
import type { FilterOperation, FilterPreset } from '../../shared/typen.js';

interface FilterZeile {
  id: string;
  name: string;
  operationen: string;
  eingebaut: number;
  position: number;
}

function zuFilter(zeile: FilterZeile): FilterPreset {
  return {
    id: zeile.id,
    name: zeile.name,
    operationen: JSON.parse(zeile.operationen) as FilterOperation[],
    eingebaut: zeile.eingebaut === 1,
  };
}

export function listeFilter(): FilterPreset[] {
  const zeilen = holeDb()
    .prepare('SELECT * FROM filter ORDER BY position, name')
    .all() as FilterZeile[];
  return zeilen.map(zuFilter);
}

export function holeFilter(id: string): FilterPreset | null {
  const zeile = holeDb().prepare('SELECT * FROM filter WHERE id = ?').get(id) as
    | FilterZeile
    | undefined;
  return zeile ? zuFilter(zeile) : null;
}

export function speichereFilter(preset: FilterPreset, position = 100): FilterPreset {
  holeDb()
    .prepare(
      `INSERT INTO filter (id, name, operationen, eingebaut, position)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, operationen = excluded.operationen, position = excluded.position`,
    )
    .run(
      preset.id,
      preset.name,
      JSON.stringify(preset.operationen),
      preset.eingebaut ? 1 : 0,
      position,
    );
  return holeFilter(preset.id)!;
}

/**
 * Eingebaute Presets lassen sich nicht loeschen. Ein geloeschter Filter wird
 * auch aus allen Veranstaltungen ausgetragen - ein toter Verweis zeigte sonst
 * im Kiosk eine Kachel, hinter der nichts steht.
 */
export function loescheFilter(id: string): boolean {
  const db = holeDb();
  let geloescht = false;
  db.transaction(() => {
    geloescht = db.prepare('DELETE FROM filter WHERE id = ? AND eingebaut = 0').run(id).changes > 0;
    if (!geloescht) return;
    const events = db.prepare('SELECT id, einstellungen FROM events').all() as { id: string; einstellungen: string }[];
    for (const event of events) {
      const einstellungen = JSON.parse(event.einstellungen) as { filter?: string[] };
      if (!einstellungen.filter?.includes(id)) continue;
      einstellungen.filter = einstellungen.filter.filter((f) => f !== id);
      db.prepare('UPDATE events SET einstellungen = ? WHERE id = ?').run(JSON.stringify(einstellungen), event.id);
    }
  })();
  return geloescht;
}

/*
 * Was ein Filter enthalten darf. Vorher speicherte der Server jede Liste von
 * Operationen - eine Saettigung "NaN" oder eine LUT "../../fotobox.db" fiel
 * erst auf, wenn ein Gast den Filter antippte und das Zusammensetzen
 * scheiterte.
 */
const wert = (min: number, max: number) => z.number().finite().min(min).max(max);
export const FILTER_OPERATION = z.discriminatedUnion('op', [
  z.object({ op: z.literal('graustufen') }),
  z.object({ op: z.literal('saettigung'), wert: wert(0, 3) }),
  z.object({ op: z.literal('helligkeit'), wert: wert(0.2, 3) }),
  z.object({ op: z.literal('kontrast'), wert: wert(0.2, 3) }),
  z.object({ op: z.literal('farbton'), grad: wert(-360, 360) }),
  z.object({ op: z.literal('tonung'), farbe: z.string().regex(/^#[0-9a-fA-F]{6}$/), staerke: wert(0, 1) }),
  z.object({ op: z.literal('farbmatrix'), matrix: z.array(wert(-3, 3)).length(9) }),
  z.object({ op: z.literal('vignette'), staerke: wert(0, 1) }),
  z.object({ op: z.literal('lut'), datei: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.cube$/) }),
]);

export const FILTER_EINGABE = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1, 'Der Filter braucht einen Namen.').max(40, 'Name: höchstens 40 Zeichen.'),
  operationen: z.array(FILTER_OPERATION).min(1, 'Ein Filter braucht mindestens eine Operation.').max(12),
});

export function legeEingebauteFilterAn(): void {
  EINGEBAUTE_FILTER.forEach((preset, index) => speichereFilter(preset, index));
}
