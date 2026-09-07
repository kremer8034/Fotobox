import sharp from 'sharp';
import { join } from 'node:path';
import { ladeLut, wendeLutAn, type Lut } from './lut.js';
import {
  FILTER_OHNE,
  type FilterOperation,
  type FilterPreset,
} from '../../shared/typen.js';

/**
 * Filter werden ausschliesslich auf die Fotos angewendet, nie auf Bild- und
 * Textebenen der Vorlage. Das passiert weiter unten in der Pipeline: erst das
 * Foto filtern, dann in die Vorlage einsetzen.
 */

const lutCache = new Map<string, Lut>();

async function holeLut(lutOrdner: string, datei: string): Promise<Lut> {
  const pfad = join(lutOrdner, datei);
  const vorhanden = lutCache.get(pfad);
  if (vorhanden) return vorhanden;
  const lut = await ladeLut(pfad);
  lutCache.set(pfad, lut);
  return lut;
}

/** Vignette als radialer Verlauf, der ueber das Bild gelegt wird. */
async function vignetteMaske(breite: number, hoehe: number, staerke: number): Promise<Buffer> {
  const svg = `<svg width="${breite}" height="${hoehe}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="${Math.max(0, Math.min(1, staerke))}"/>
      </radialGradient>
    </defs>
    <rect width="${breite}" height="${hoehe}" fill="url(#v)"/>
  </svg>`;
  return Buffer.from(svg);
}

export interface FilterKontext {
  lutOrdner: string;
}

/**
 * Wendet ein Filter-Preset auf ein Bild an und gibt einen JPEG-Puffer zurueck.
 * Erwartet ein bereits auf Arbeitsgroesse verkleinertes Bild.
 */
export async function wendeFilterAn(
  eingabe: Buffer,
  preset: FilterPreset | null,
  kontext: FilterKontext,
): Promise<Buffer> {
  if (!preset || preset.id === FILTER_OHNE || preset.operationen.length === 0) {
    return eingabe;
  }

  let bild = sharp(eingabe);
  let vignetteStaerke = 0;
  let lutDatei: string | null = null;

  for (const operation of preset.operationen) {
    bild = anwenden(bild, operation);
    if (operation.op === 'vignette') vignetteStaerke = operation.staerke;
    if (operation.op === 'lut') lutDatei = operation.datei;
  }

  // Die LUT braucht den Rohpuffer, deshalb laeuft sie getrennt von den
  // sharp-Operationen.
  if (lutDatei) {
    const { data, info } = await bild.raw().toBuffer({ resolveWithObject: true });
    const lut = await holeLut(kontext.lutOrdner, lutDatei);
    wendeLutAn(data, info.channels, lut);
    bild = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    });
  }

  if (vignetteStaerke > 0) {
    const metadaten = await bild.metadata();
    const breite = metadaten.width ?? 0;
    const hoehe = metadaten.height ?? 0;
    if (breite > 0 && hoehe > 0) {
      const maske = await vignetteMaske(breite, hoehe, vignetteStaerke);
      bild = sharp(await bild.jpeg({ quality: 95 }).toBuffer()).composite([
        { input: maske, blend: 'over' },
      ]);
    }
  }

  return bild.jpeg({ quality: 92 }).toBuffer();
}

function anwenden(bild: sharp.Sharp, operation: FilterOperation): sharp.Sharp {
  switch (operation.op) {
    case 'graustufen':
      return bild.grayscale();
    case 'saettigung':
      return bild.modulate({ saturation: operation.wert });
    case 'helligkeit':
      return bild.modulate({ brightness: operation.wert });
    case 'farbton':
      return bild.modulate({ hue: operation.grad });
    case 'kontrast': {
      // linear(a, b) mit a = Kontrast und b so gewaehlt, dass die Bildmitte
      // ihre Helligkeit behaelt.
      const a = operation.wert;
      return bild.linear(a, 128 * (1 - a));
    }
    case 'tonung': {
      const { r, g, b } = hexZuRgb(operation.farbe);
      const s = Math.max(0, Math.min(1, operation.staerke));
      return bild.grayscale().tint({
        r: Math.round(255 - (255 - r) * s),
        g: Math.round(255 - (255 - g) * s),
        b: Math.round(255 - (255 - b) * s),
      });
    }
    case 'farbmatrix':
      return bild.recomb([
        [operation.matrix[0], operation.matrix[1], operation.matrix[2]],
        [operation.matrix[3], operation.matrix[4], operation.matrix[5]],
        [operation.matrix[6], operation.matrix[7], operation.matrix[8]],
      ]);
    case 'vignette':
    case 'lut':
      // Beide werden ausserhalb der sharp-Kette behandelt.
      return bild;
  }
}

function hexZuRgb(hex: string): { r: number; g: number; b: number } {
  const sauber = hex.replace('#', '');
  const voll =
    sauber.length === 3
      ? sauber
          .split('')
          .map((z) => z + z)
          .join('')
      : sauber;
  return {
    r: parseInt(voll.slice(0, 2), 16) || 0,
    g: parseInt(voll.slice(2, 4), 16) || 0,
    b: parseInt(voll.slice(4, 6), 16) || 0,
  };
}

/**
 * Die eingebauten Presets. "Ohne Filter" ist immer die erste Kachel und immer
 * vorausgewaehlt, damit das natuerliche Bild die Standardwahl bleibt.
 */
export const EINGEBAUTE_FILTER: FilterPreset[] = [
  { id: FILTER_OHNE, name: 'Ohne Filter', operationen: [], eingebaut: true },
  {
    id: 'schwarzweiss',
    name: 'Schwarzweiss',
    eingebaut: true,
    operationen: [{ op: 'graustufen' }, { op: 'kontrast', wert: 1.1 }],
  },
  {
    id: 'sepia',
    name: 'Sepia',
    eingebaut: true,
    operationen: [{ op: 'tonung', farbe: '#a07850', staerke: 0.8 }],
  },
  {
    id: 'warm',
    name: 'Warm',
    eingebaut: true,
    operationen: [
      { op: 'farbmatrix', matrix: [1.08, 0.02, 0, 0.02, 1.0, 0, 0, 0.02, 0.9] },
      { op: 'saettigung', wert: 1.1 },
    ],
  },
  {
    id: 'kuehl',
    name: 'Kuehl',
    eingebaut: true,
    operationen: [
      { op: 'farbmatrix', matrix: [0.92, 0, 0.02, 0, 1.0, 0.02, 0, 0.02, 1.1] },
      { op: 'saettigung', wert: 1.05 },
    ],
  },
  {
    id: 'pop',
    name: 'Pop',
    eingebaut: true,
    operationen: [
      { op: 'saettigung', wert: 1.5 },
      { op: 'kontrast', wert: 1.2 },
    ],
  },
  {
    id: 'vintage',
    name: 'Vintage',
    eingebaut: true,
    operationen: [
      { op: 'saettigung', wert: 0.7 },
      { op: 'tonung', farbe: '#b8a184', staerke: 0.35 },
      { op: 'kontrast', wert: 0.92 },
      { op: 'vignette', staerke: 0.45 },
    ],
  },
  {
    id: 'highkey',
    name: 'High-Key',
    eingebaut: true,
    operationen: [
      { op: 'helligkeit', wert: 1.15 },
      { op: 'kontrast', wert: 0.9 },
      { op: 'saettigung', wert: 0.9 },
    ],
  },
];
