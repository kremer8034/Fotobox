import sharp, { type Sharp } from 'sharp';
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

/**
 * Vignette als radialer Verlauf, der ueber das Bild gelegt wird.
 *
 * Fertig gerendert aufgehoben: Alle Fotos eines Abends haben dieselbe Groesse,
 * und das SVG jedes Mal neu zu zeichnen, kostete auf 2000 Pixeln mehr als die
 * ganze uebrige Filterkette.
 */
const vignetten = new Map<string, Promise<Buffer>>();

function vignetteMaske(breite: number, hoehe: number, staerke: number): Promise<Buffer> {
  const deckung = Math.max(0, Math.min(1, staerke));
  const schluessel = `${breite}x${hoehe}@${deckung}`;
  const vorhanden = vignetten.get(schluessel);
  if (vorhanden) return vorhanden;

  const svg = `<svg width="${breite}" height="${hoehe}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="v" cx="50%" cy="50%" r="75%">
        <stop offset="55%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="${deckung}"/>
      </radialGradient>
    </defs>
    <rect width="${breite}" height="${hoehe}" fill="url(#v)"/>
  </svg>`;
  const maske = sharp(Buffer.from(svg)).png({ compressionLevel: 0 }).toBuffer();
  // Wenige Groessen gleichzeitig: Arbeitsbild quer und hoch, dazu die Vorschau.
  if (vignetten.size >= 8) vignetten.delete(vignetten.keys().next().value!);
  vignetten.set(schluessel, maske);
  maske.catch(() => vignetten.delete(schluessel));
  return maske;
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
  let affin = EINHEIT;
  let einfarbig = false;

  // Eine Toenung ersetzt die Farben ohnehin durch ihren Ton. Ein Graustufen-
  // Schritt davor macht das Bild in sharp einkanalig - und dann geht die
  // Toenung verloren: "Sepia" kam als reines Schwarzweiss heraus.
  const hatToenung = preset.operationen.some((o) => o.op === 'tonung');

  for (const operation of preset.operationen) {
    if (operation.op === 'graustufen' && hatToenung) {
      einfarbig = true;
      continue;
    }
    const schritt = alsAffin(operation);
    if (schritt) {
      affin = verkette(affin, schritt);
      continue;
    }
    bild = anwenden(bild, operation);
    if (operation.op === 'graustufen' || operation.op === 'tonung') einfarbig = true;
    if (operation.op === 'vignette') vignetteStaerke = operation.staerke;
    if (operation.op === 'lut') lutDatei = operation.datei;
  }
  bild = wendeAffinAn(bild, affin, einfarbig);

  if (!lutDatei && vignetteStaerke <= 0) return bild.jpeg({ quality: 92 }).toBuffer();

  // LUT und Vignette brauchen das fertig gefilterte Bild: sharp fuehrt seine
  // Schritte in fester Reihenfolge aus, und das Ueberlagern kaeme dort vor
  // Kontrast und Tonung. Zwischendurch geht es als Rohpuffer weiter, nicht als
  // JPEG - das spart auf dem N100 ein Kodieren und Dekodieren je Foto.
  const { data, info } = await bild.raw().toBuffer({ resolveWithObject: true });
  if (lutDatei) {
    const lut = await holeLut(kontext.lutOrdner, lutDatei);
    wendeLutAn(data, info.channels, lut);
  }
  let ergebnis = sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
  if (vignetteStaerke > 0) {
    ergebnis = ergebnis.composite([
      { input: await vignetteMaske(info.width, info.height, vignetteStaerke), blend: 'over' },
    ]);
  }
  return ergebnis.jpeg({ quality: 92 }).toBuffer();
}

/*
 * Saettigung, Helligkeit, Kontrast und Farbmatrix sind alle "linear": Jeder
 * neue Farbwert ist eine gewichtete Summe der alten plus ein fester Betrag.
 * Solche Schritte lassen sich vorab zu einem einzigen zusammenrechnen.
 *
 * Das ist der Grund fuer die folgenden Zeilen, und er ist messbar: sharps
 * modulate() rechnet das ganze Bild fuer die Saettigung in einen anderen
 * Farbraum und zurueck. Auf 2000 Pixeln kostete das je Foto rund 300 ms -
 * "Warm", "Kuehl", "Pop" und "High-Key" brauchten dadurch das Dreifache von
 * "Schwarzweiss". Als Matrix ist es eine Multiplikation je Pixel.
 *
 * Nebenbei stimmt so die Reihenfolge: sharp wendet seine Schritte in fester
 * Folge an, nicht in der des Presets, und ein zweiter recomb() ersetzte den
 * ersten, statt ihn zu ergaenzen.
 */

/** Neuer Wert = m * alter Wert + b; m zeilenweise 3 x 3. */
interface Affin {
  m: number[];
  b: number[];
}

const EINHEIT: Affin = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], b: [0, 0, 0] };

/** Helligkeitsgewichte (Rec. 709): Grau bleibt beim Entsaettigen gleich hell. */
const LUMA = [0.2126, 0.7152, 0.0722];

function alsAffin(operation: FilterOperation): Affin | null {
  switch (operation.op) {
    case 'saettigung': {
      const s = operation.wert;
      const m: number[] = [];
      for (let zeile = 0; zeile < 3; zeile++) {
        for (let spalte = 0; spalte < 3; spalte++) {
          m.push((1 - s) * LUMA[spalte]! + (zeile === spalte ? s : 0));
        }
      }
      return { m, b: [0, 0, 0] };
    }
    case 'helligkeit': {
      const w = operation.wert;
      return { m: [w, 0, 0, 0, w, 0, 0, 0, w], b: [0, 0, 0] };
    }
    case 'kontrast': {
      // Faktor a und Verschiebung so, dass die Bildmitte ihre Helligkeit behaelt.
      const a = operation.wert;
      const b = 128 * (1 - a);
      return { m: [a, 0, 0, 0, a, 0, 0, 0, a], b: [b, b, b] };
    }
    case 'farbmatrix':
      return { m: [...operation.matrix], b: [0, 0, 0] };
    default:
      return null;
  }
}

/** Erst `erst`, dann `dann`. */
function verkette(erst: Affin, dann: Affin): Affin {
  const m: number[] = [];
  const b: number[] = [];
  for (let zeile = 0; zeile < 3; zeile++) {
    for (let spalte = 0; spalte < 3; spalte++) {
      let summe = 0;
      for (let k = 0; k < 3; k++) summe += dann.m[zeile * 3 + k]! * erst.m[k * 3 + spalte]!;
      m.push(summe);
    }
    let verschiebung = dann.b[zeile]!;
    for (let k = 0; k < 3; k++) verschiebung += dann.m[zeile * 3 + k]! * erst.b[k]!;
    b.push(verschiebung);
  }
  return { m, b };
}

function wendeAffinAn(bild: Sharp, affin: Affin, einfarbig: boolean): Sharp {
  const { m, b } = affin;
  const nahe = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  const istEinheit = m.every((w, i) => nahe(w, EINHEIT.m[i]!)) && b.every((w) => nahe(w, 0));
  if (istEinheit) return bild;

  if (einfarbig) {
    // Nach Graustufen hat das Bild nur noch einen Kanal; eine Farbmatrix passt
    // darauf nicht. Auf Grau wirkt jede Zeile nur noch mit ihrer Summe.
    const faktor = (m[0]! + m[1]! + m[2]! + m[3]! + m[4]! + m[5]! + m[6]! + m[7]! + m[8]!) / 3;
    return bild.linear(faktor, (b[0]! + b[1]! + b[2]!) / 3);
  }

  const diagonal = [1, 2, 3, 5, 6, 7].every((i) => nahe(m[i]!, 0));
  if (diagonal) return bild.linear([m[0]!, m[4]!, m[8]!], b);

  bild = bild.recomb([
    [m[0]!, m[1]!, m[2]!],
    [m[3]!, m[4]!, m[5]!],
    [m[6]!, m[7]!, m[8]!],
  ]);
  return b.every((w) => nahe(w, 0)) ? bild : bild.linear([1, 1, 1], b);
}

function anwenden(bild: Sharp, operation: FilterOperation): Sharp {
  switch (operation.op) {
    case 'graustufen':
      return bild.grayscale();
    case 'farbton':
      return bild.modulate({ hue: operation.grad });
    case 'tonung': {
      const { r, g, b } = hexZuRgb(operation.farbe);
      const s = Math.max(0, Math.min(1, operation.staerke));
      // tint() behaelt die Helligkeit und setzt den Farbton - das Ergebnis ist
      // von selbst einfarbig getoent. Kein grayscale() davor, siehe oben.
      return bild.tint({
        r: Math.round(255 - (255 - r) * s),
        g: Math.round(255 - (255 - g) * s),
        b: Math.round(255 - (255 - b) * s),
      });
    }
    case 'saettigung':
    case 'helligkeit':
    case 'kontrast':
    case 'farbmatrix':
      // Laufen zusammengefasst ueber wendeAffinAn().
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
