import { randomUUID } from 'node:crypto';
import { holeDb, jetzt } from '../db/index.js';
import {
  CANVAS_PRESETS,
  anzahlFotos,
  type CanvasPreset,
  type Ebene,
  type Vorlage,
} from '../../shared/typen.js';

interface VorlagenZeile {
  id: string;
  name: string;
  canvas: string;
  definition: string;
  vorschau: string | null;
  erstellt: string;
  geaendert: string;
}

function zuVorlage(zeile: VorlagenZeile): Vorlage {
  const definition = JSON.parse(zeile.definition) as { ebenen: Ebene[]; hintergrundFarbe?: string };
  return {
    id: zeile.id,
    name: zeile.name,
    canvas: CANVAS_PRESETS[zeile.canvas as CanvasPreset] ?? CANVAS_PRESETS['10x15-quer'],
    ebenen: definition.ebenen ?? [],
    hintergrundFarbe: definition.hintergrundFarbe,
    erstellt: zeile.erstellt,
    geaendert: zeile.geaendert,
  };
}

export function listeVorlagen(): Vorlage[] {
  const zeilen = holeDb().prepare('SELECT * FROM vorlagen ORDER BY name').all() as VorlagenZeile[];
  return zeilen.map(zuVorlage);
}

export function holeVorlage(id: string): Vorlage | null {
  const zeile = holeDb().prepare('SELECT * FROM vorlagen WHERE id = ?').get(id) as
    | VorlagenZeile
    | undefined;
  return zeile ? zuVorlage(zeile) : null;
}

export function speichereVorlage(vorlage: Omit<Vorlage, 'erstellt' | 'geaendert'>): Vorlage {
  const db = holeDb();
  const zeit = jetzt();
  const definition = JSON.stringify({
    ebenen: vorlage.ebenen,
    hintergrundFarbe: vorlage.hintergrundFarbe,
  });
  db.prepare(
    `INSERT INTO vorlagen (id, name, canvas, definition, vorschau, erstellt, geaendert)
     VALUES (?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, canvas = excluded.canvas,
       definition = excluded.definition, geaendert = excluded.geaendert`,
  ).run(vorlage.id, vorlage.name, vorlage.canvas.preset, definition, zeit, zeit);
  return holeVorlage(vorlage.id)!;
}

export function loescheVorlage(id: string): void {
  holeDb().prepare('DELETE FROM vorlagen WHERE id = ?').run(id);
}

/**
 * Mitgelieferte Standardvorlagen, damit man nicht vor einer leeren Flaeche
 * startet: ein, zwei, drei und vier Fotos je Format.
 */
export function standardvorlagen(): Vorlage[] {
  const bauen = (
    id: string,
    name: string,
    preset: CanvasPreset,
    kacheln: { x: number; y: number; w: number; h: number }[],
  ): Vorlage => ({
    id,
    name,
    canvas: CANVAS_PRESETS[preset],
    hintergrundFarbe: '#ffffff',
    ebenen: [
      ...kacheln.map(
        (k, i): Ebene => ({
          id: `foto-${i + 1}`,
          typ: 'foto',
          index: i + 1,
          x: k.x,
          y: k.y,
          w: k.w,
          h: k.h,
          einpassung: 'cover',
        }),
      ),
      {
        id: 'titel',
        typ: 'text',
        text: '{veranstaltung}',
        x: 0.05,
        y: 0.87,
        w: 0.9,
        h: 0.1,
        groesse: 0.06,
        farbe: '#333333',
        ausrichtung: 'mitte',
      },
    ],
  });

  const rand = 0.04;
  const luecke = 0.02;

  return [
    bauen('standard-1-quer', '1 Foto (quer)', '10x15-quer', [
      { x: rand, y: rand, w: 1 - 2 * rand, h: 0.8 },
    ]),
    bauen('standard-2-quer', '2 Fotos (quer)', '10x15-quer', [
      { x: rand, y: rand, w: (1 - 2 * rand - luecke) / 2, h: 0.8 },
      { x: rand + (1 - 2 * rand - luecke) / 2 + luecke, y: rand, w: (1 - 2 * rand - luecke) / 2, h: 0.8 },
    ]),
    bauen('standard-3-quer', '3 Fotos (quer)', '10x15-quer', [
      { x: rand, y: rand, w: 0.55, h: 0.8 },
      { x: rand + 0.55 + luecke, y: rand, w: 1 - 2 * rand - 0.55 - luecke, h: (0.8 - luecke) / 2 },
      {
        x: rand + 0.55 + luecke,
        y: rand + (0.8 - luecke) / 2 + luecke,
        w: 1 - 2 * rand - 0.55 - luecke,
        h: (0.8 - luecke) / 2,
      },
    ]),
    bauen('standard-4-quer', '4 Fotos (quer)', '10x15-quer', [
      { x: rand, y: rand, w: (1 - 2 * rand - luecke) / 2, h: (0.8 - luecke) / 2 },
      {
        x: rand + (1 - 2 * rand - luecke) / 2 + luecke,
        y: rand,
        w: (1 - 2 * rand - luecke) / 2,
        h: (0.8 - luecke) / 2,
      },
      {
        x: rand,
        y: rand + (0.8 - luecke) / 2 + luecke,
        w: (1 - 2 * rand - luecke) / 2,
        h: (0.8 - luecke) / 2,
      },
      {
        x: rand + (1 - 2 * rand - luecke) / 2 + luecke,
        y: rand + (0.8 - luecke) / 2 + luecke,
        w: (1 - 2 * rand - luecke) / 2,
        h: (0.8 - luecke) / 2,
      },
    ]),
    bauen('standard-3-hoch', '3 Fotos (hoch)', '10x15-hoch', [
      { x: rand, y: rand, w: 1 - 2 * rand, h: 0.26 },
      { x: rand, y: rand + 0.28, w: 1 - 2 * rand, h: 0.26 },
      { x: rand, y: rand + 0.56, w: 1 - 2 * rand, h: 0.26 },
    ]),
  ];
}

export function legeStandardvorlagenAn(): void {
  const db = holeDb();
  const vorhanden = db.prepare('SELECT COUNT(*) AS n FROM vorlagen').get() as { n: number };
  if (vorhanden.n > 0) return;
  for (const vorlage of standardvorlagen()) speichereVorlage(vorlage);
}

export { anzahlFotos, randomUUID as neueVorlagenId };
