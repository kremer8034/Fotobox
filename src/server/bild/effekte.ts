import type { FilterOperation } from '../../shared/typen.js';

/**
 * Effekte, die sharp nicht kennt und die deshalb Pixel fuer Pixel auf dem
 * Rohpuffer rechnen: Farbstufen, Verlaufskarten, Zweifarb-Toenung, Filmkorn,
 * RGB-Versatz und Solarisation. Daraus entstehen die "krassen" Filter -
 * Pop-Art, Waermebild, Neon, Glitch -, die mit Saettigung, Kontrast und
 * Farbmatrix allein nicht gehen.
 *
 * Alles laeuft auf dem schon verkleinerten Arbeitsbild (lange Kante etwa
 * 2000 Pixel), wo jeder Effekt nur einige Dutzend Millisekunden braucht.
 * Ergebnis ist immer ein Bild mit drei Kanaelen.
 */

export type RohOperation = Extract<
  FilterOperation,
  { op: 'posterisieren' | 'verlaufskarte' | 'teiltonung' | 'koernung' | 'kanalversatz' | 'solarisation' }
>;

const ROH_OPS = new Set(['posterisieren', 'verlaufskarte', 'teiltonung', 'koernung', 'kanalversatz', 'solarisation']);

export function istRohOperation(o: FilterOperation): o is RohOperation {
  return ROH_OPS.has(o.op);
}

export interface Roh {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Wendet einen Effekt an und gibt das Ergebnis mit drei Kanaelen zurueck. */
export function wendeRohAn(eingabe: Roh, op: RohOperation): Roh {
  const roh = alsRgb(eingabe);
  switch (op.op) {
    case 'posterisieren':
      return posterisieren(roh, op.stufen);
    case 'verlaufskarte':
      return verlaufskarte(roh, op.farben, op.stufen);
    case 'teiltonung':
      return teiltonung(roh, op.schatten, op.lichter, op.staerke);
    case 'koernung':
      return koernung(roh, op.staerke);
    case 'kanalversatz':
      return kanalversatz(roh, op.staerke);
    case 'solarisation':
      return solarisation(roh, op.schwelle);
  }
}

/** Graustufen (ein Kanal) oder mit Alphakanal auf drei Farbkanaele bringen. */
function alsRgb(roh: Roh): Roh {
  if (roh.channels === 3) return roh;
  const pixel = roh.width * roh.height;
  const data = Buffer.alloc(pixel * 3);
  for (let i = 0; i < pixel; i++) {
    const quelle = i * roh.channels;
    const grau = roh.channels < 3;
    data[i * 3] = roh.data[quelle]!;
    data[i * 3 + 1] = grau ? roh.data[quelle]! : roh.data[quelle + 1]!;
    data[i * 3 + 2] = grau ? roh.data[quelle]! : roh.data[quelle + 2]!;
  }
  return { data, width: roh.width, height: roh.height, channels: 3 };
}

/** Helligkeit eines Pixels 0..255 (Rec. 709). */
function luma(d: Buffer, i: number): number {
  return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
}

export function hexZuRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}

/** Wenige harte Farbstufen je Kanal - der Pop-Art- und Comic-Look. */
function posterisieren(roh: Roh, stufen: number): Roh {
  const n = Math.max(2, Math.min(16, Math.round(stufen)));
  const tabelle = new Uint8Array(256);
  for (let v = 0; v < 256; v++) tabelle[v] = Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1)));
  const data = Buffer.alloc(roh.data.length);
  for (let i = 0; i < data.length; i++) data[i] = tabelle[roh.data[i]!]!;
  return { ...roh, data };
}

/**
 * Helligkeit auf einen Farbverlauf abbilden: dunkel = erste Farbe, hell =
 * letzte. Zwei Farben ergeben einen Duoton, viele ein Waermebild. Mit
 * "stufen" wird die Helligkeit vorher in harte Stufen geteilt (Warhol-Look).
 */
function verlaufskarte(roh: Roh, farben: string[], stufen?: number): Roh {
  const punkte = farben.map(hexZuRgb);
  const tabelle = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    let t = v / 255;
    if (stufen && stufen >= 2) t = Math.round(t * (stufen - 1)) / (stufen - 1);
    const lage = t * (punkte.length - 1);
    const a = Math.min(punkte.length - 2, Math.floor(lage));
    const f = lage - a;
    for (let k = 0; k < 3; k++) {
      tabelle[v * 3 + k] = Math.round(punkte[a]![k]! * (1 - f) + punkte[a + 1]![k]! * f);
    }
  }
  const data = Buffer.alloc(roh.data.length);
  for (let i = 0; i < data.length; i += 3) {
    const v = Math.round(luma(roh.data, i));
    data[i] = tabelle[v * 3]!;
    data[i + 1] = tabelle[v * 3 + 1]!;
    data[i + 2] = tabelle[v * 3 + 2]!;
  }
  return { ...roh, data };
}

/** Ueberblenden wie "Ineinanderkopieren": Zeichnung bleibt, Farbe kommt dazu. */
function ueberlagern(a: number, b: number): number {
  return a < 128 ? (2 * a * b) / 255 : 255 - (2 * (255 - a) * (255 - b)) / 255;
}

/**
 * Schatten in einer Farbe, Lichter in einer anderen - etwa Petrol und Pink
 * fuer den Neon-Look oder Lila und Orange fuer die 70er.
 */
function teiltonung(roh: Roh, schatten: string, lichter: string, staerke: number): Roh {
  const s = hexZuRgb(schatten);
  const l = hexZuRgb(lichter);
  const k = Math.max(0, Math.min(1, staerke));
  const data = Buffer.alloc(roh.data.length);
  for (let i = 0; i < data.length; i += 3) {
    const t = luma(roh.data, i) / 255;
    for (let c = 0; c < 3; c++) {
      const ton = s[c]! * (1 - t) + l[c]! * t;
      const v = roh.data[i + c]!;
      data[i + c] = Math.round(v * (1 - k) + ueberlagern(v, ton) * k);
    }
  }
  return { ...roh, data };
}

/**
 * Filmkorn: gleichmaessiges Rauschen, in allen Kanaelen gleich (sonst bunt).
 * Fester Startwert, damit Vorschau und Ausdruck dasselbe Korn zeigen.
 */
function koernung(roh: Roh, staerke: number): Roh {
  const amplitude = Math.max(0, Math.min(1, staerke)) * 70;
  let zustand = 0x9e3779b9 ^ (roh.width * 31 + roh.height);
  const zufall = () => {
    zustand ^= zustand << 13;
    zustand ^= zustand >>> 17;
    zustand ^= zustand << 5;
    return ((zustand >>> 0) / 0xffffffff) - 0.5;
  };
  const data = Buffer.alloc(roh.data.length);
  for (let i = 0; i < data.length; i += 3) {
    const n = zufall() * amplitude;
    for (let c = 0; c < 3; c++) data[i + c] = klemme(roh.data[i + c]! + n);
  }
  return { ...roh, data };
}

/** Rot nach links, Blau nach rechts verschoben - der Glitch-/3D-Brillen-Look. */
function kanalversatz(roh: Roh, staerke: number): Roh {
  const px = Math.max(1, Math.round(Math.max(0, Math.min(0.05, staerke)) * roh.width));
  const { width, height } = roh;
  const data = Buffer.alloc(roh.data.length);
  for (let y = 0; y < height; y++) {
    const zeile = y * width;
    for (let x = 0; x < width; x++) {
      const ziel = (zeile + x) * 3;
      const rot = (zeile + Math.min(width - 1, x + px)) * 3;
      const blau = (zeile + Math.max(0, x - px)) * 3;
      data[ziel] = roh.data[rot]!;
      data[ziel + 1] = roh.data[ziel + 1]!;
      data[ziel + 2] = roh.data[blau + 2]!;
    }
  }
  return { ...roh, data };
}

/** Alles ueber der Schwelle wird umgekehrt - psychedelisch, wie eine ueberbelichtete Dunkelkammer. */
function solarisation(roh: Roh, schwelle: number): Roh {
  const grenze = Math.max(0, Math.min(1, schwelle)) * 255;
  const data = Buffer.alloc(roh.data.length);
  for (let i = 0; i < data.length; i++) {
    const v = roh.data[i]!;
    data[i] = v > grenze ? 255 - v : v;
  }
  return { ...roh, data };
}

function klemme(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
