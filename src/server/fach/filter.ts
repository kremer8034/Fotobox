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

/** Eingebaute Presets lassen sich nicht loeschen. */
export function loescheFilter(id: string): void {
  holeDb().prepare('DELETE FROM filter WHERE id = ? AND eingebaut = 0').run(id);
}

export function legeEingebauteFilterAn(): void {
  EINGEBAUTE_FILTER.forEach((preset, index) => speichereFilter(preset, index));
}
