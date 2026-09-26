import { randomUUID } from 'node:crypto';
import { z } from 'zod';
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

/*
 * Was eine Vorlage enthalten darf.
 *
 * Vorher nahm der Server beim Speichern jede beliebige Ebenenliste an. Eine
 * Ebene ohne Breite, mit "NaN" als Position oder mit einem Dateinamen wie
 * "../../fotobox.db" landete so in der Datenbank - und fiel erst auf, wenn
 * ein Gast nach der Filterwahl auf "Dein Bild wird zusammengesetzt" wartete.
 * Jetzt wird beim Speichern geprueft, und der Editor bekommt eine klare
 * Meldung.
 */
const zahl = (min: number, max: number) => z.number().finite().min(min).max(max);
const farbe = z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/, 'Farbe als #RRGGBB');

const basis = {
  id: z.string().min(1).max(64),
  name: z.string().max(100).optional(),
  // Etwas Spielraum ueber die Seite hinaus: Ein Hintergrund darf fuer den
  // randlosen Druck ueberstehen. Weiter als eine halbe Seite nicht.
  x: zahl(-1, 2),
  y: zahl(-1, 2),
  w: zahl(0.005, 3),
  h: zahl(0.005, 3),
  rotation: zahl(-360, 360).optional(),
  sichtbar: z.boolean().optional(),
  gesperrt: z.boolean().optional(),
};

const EBENE = z.discriminatedUnion('typ', [
  z.object({
    ...basis,
    typ: z.literal('bild'),
    // Nur ein Dateiname aus dem Vorlagenordner, nie ein Pfad.
    datei: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/, 'Ungueltiger Dateiname').refine((d) => !d.startsWith('.')),
    deckkraft: zahl(0, 1).optional(),
  }),
  z.object({
    ...basis,
    typ: z.literal('foto'),
    index: z.number().int().min(1).max(99),
    einpassung: z.enum(['cover', 'contain']).optional(),
    radius: zahl(0, 0.5).optional(),
  }),
  z.object({
    ...basis,
    typ: z.literal('text'),
    text: z.string().max(500),
    groesse: zahl(0.005, 1),
    farbe,
    ausrichtung: z.enum(['links', 'mitte', 'rechts']).optional(),
    schrift: z.string().max(100).optional(),
    schriftDatei: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/).optional(),
  }),
]);

export const VORLAGE_EINGABE = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1, 'Die Vorlage braucht einen Namen.').max(100),
  preset: z.enum(['10x15-quer', '10x15-hoch']),
  hintergrundFarbe: farbe.optional(),
  ebenen: z.array(EBENE).max(60, 'Hoechstens 60 Ebenen.'),
});

/** Verstaendliche Meldung aus einem Pruefergebnis, etwa "Ebene 3 (text): farbe - Farbe als #RRGGBB". */
export function beschreibePruefung(fehler: z.ZodError, ebenen: unknown): string {
  const erstes = fehler.issues[0];
  if (!erstes) return 'Die Vorlage ist ungueltig.';
  const [bereich, nummer, feld] = erstes.path;
  if (bereich === 'ebenen' && typeof nummer === 'number') {
    const typ = Array.isArray(ebenen) ? (ebenen[nummer] as { typ?: string } | undefined)?.typ : undefined;
    return `Ebene ${nummer + 1}${typ ? ` (${typ})` : ''}: ${feld ? `${String(feld)} - ` : ''}${erstes.message}`;
  }
  return erstes.message;
}

/** In welchen Veranstaltungen ist diese Vorlage freigegeben? */
export function vorlageInVeranstaltungen(id: string): { id: string; name: string; status: string }[] {
  const zeilen = holeDb().prepare('SELECT id, name, status, einstellungen FROM events').all() as {
    id: string;
    name: string;
    status: string;
    einstellungen: string;
  }[];
  return zeilen
    .filter((z) => {
      try {
        return (JSON.parse(z.einstellungen) as { vorlagen?: string[] }).vorlagen?.includes(id) ?? false;
      } catch {
        return false;
      }
    })
    .map(({ id: eventId, name, status }) => ({ id: eventId, name, status }));
}

export function loescheVorlage(id: string): void {
  const db = holeDb();
  db.transaction(() => {
    db.prepare('DELETE FROM vorlagen WHERE id = ?').run(id);
    // Aus den Veranstaltungen austragen, statt einen toten Verweis zu lassen.
    for (const event of vorlageInVeranstaltungen(id)) {
      const zeile = db.prepare('SELECT einstellungen FROM events WHERE id = ?').get(event.id) as { einstellungen: string };
      const einstellungen = JSON.parse(zeile.einstellungen) as { vorlagen: string[] };
      einstellungen.vorlagen = einstellungen.vorlagen.filter((v) => v !== id);
      db.prepare('UPDATE events SET einstellungen = ? WHERE id = ?').run(JSON.stringify(einstellungen), event.id);
    }
  })();
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
