import { readFile } from 'node:fs/promises';

/**
 * 3D-LUTs im .cube-Format.
 *
 * sharp kann das nicht: Tonwertkurven, Saettigung, Farbmatrizen und Vignette
 * erledigt es direkt, aber eine dreidimensionale Farbtabelle kennt es nicht.
 * Deshalb diese kleine Routine auf dem Rohpixelpuffer.
 *
 * Entscheidend ist die Reihenfolge in der Pipeline: Der Filter wird angewendet,
 * NACHDEM das Foto auf Arbeitsgroesse verkleinert wurde, nie auf dem vollen
 * 18-Megapixel-Bild. Damit rechnet die LUT ueber wenige hunderttausend Pixel
 * statt ueber achtzehn Millionen.
 */

export interface Lut {
  groesse: number;
  /** groesse^3 Eintraege a 3 Kanaele, Reihenfolge Rot schnellstlaufend. */
  daten: Float32Array;
}

export function parseCube(inhalt: string): Lut {
  let groesse = 0;
  const werte: number[] = [];
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];

  for (const rohzeile of inhalt.split(/\r?\n/)) {
    const zeile = rohzeile.trim();
    if (zeile === '' || zeile.startsWith('#')) continue;

    if (zeile.startsWith('LUT_3D_SIZE')) {
      groesse = Number(zeile.split(/\s+/)[1]);
      continue;
    }
    if (zeile.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D-LUTs werden nicht unterstuetzt, nur LUT_3D_SIZE.');
    }
    if (zeile.startsWith('DOMAIN_MIN')) {
      domainMin = zeile.split(/\s+/).slice(1, 4).map(Number);
      continue;
    }
    if (zeile.startsWith('DOMAIN_MAX')) {
      domainMax = zeile.split(/\s+/).slice(1, 4).map(Number);
      continue;
    }
    if (zeile.startsWith('TITLE') || zeile.startsWith('LUT_3D_INPUT_RANGE')) continue;

    const teile = zeile.split(/\s+/);
    if (teile.length >= 3) {
      const r = Number(teile[0]);
      const g = Number(teile[1]);
      const b = Number(teile[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) werte.push(r, g, b);
    }
  }

  if (groesse <= 1) throw new Error('LUT_3D_SIZE fehlt oder ist unbrauchbar.');
  const erwartet = groesse * groesse * groesse * 3;
  if (werte.length !== erwartet) {
    throw new Error(`LUT hat ${werte.length / 3} Eintraege, erwartet waren ${erwartet / 3}.`);
  }

  // Auf 0..1 normalisieren, falls die Datei einen anderen Wertebereich nutzt.
  const daten = new Float32Array(erwartet);
  for (let i = 0; i < erwartet; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const min = domainMin[k] ?? 0;
      const max = domainMax[k] ?? 1;
      const spanne = max - min || 1;
      daten[i + k] = ((werte[i + k] as number) - min) / spanne;
    }
  }
  return { groesse, daten };
}

export async function ladeLut(pfad: string): Promise<Lut> {
  return parseCube(await readFile(pfad, 'utf8'));
}

/** Ein einzelner Gitterpunkt der LUT. */
function gitter(lut: Lut, r: number, g: number, b: number, kanal: number): number {
  const n = lut.groesse;
  const index = ((b * n + g) * n + r) * 3 + kanal;
  return lut.daten[index] ?? 0;
}

/**
 * Wendet die LUT mit trilinearer Interpolation auf einen RGB-Rohpuffer an.
 * Der Puffer wird an Ort und Stelle veraendert.
 */
export function wendeLutAn(puffer: Buffer, kanaele: number, lut: Lut): Buffer {
  const n = lut.groesse;
  const letzte = n - 1;

  for (let p = 0; p < puffer.length; p += kanaele) {
    const rf = ((puffer[p] as number) / 255) * letzte;
    const gf = ((puffer[p + 1] as number) / 255) * letzte;
    const bf = ((puffer[p + 2] as number) / 255) * letzte;

    const r0 = Math.floor(rf);
    const g0 = Math.floor(gf);
    const b0 = Math.floor(bf);
    const r1 = Math.min(r0 + 1, letzte);
    const g1 = Math.min(g0 + 1, letzte);
    const b1 = Math.min(b0 + 1, letzte);

    const dr = rf - r0;
    const dg = gf - g0;
    const db = bf - b0;

    for (let k = 0; k < 3; k += 1) {
      const c000 = gitter(lut, r0, g0, b0, k);
      const c100 = gitter(lut, r1, g0, b0, k);
      const c010 = gitter(lut, r0, g1, b0, k);
      const c110 = gitter(lut, r1, g1, b0, k);
      const c001 = gitter(lut, r0, g0, b1, k);
      const c101 = gitter(lut, r1, g0, b1, k);
      const c011 = gitter(lut, r0, g1, b1, k);
      const c111 = gitter(lut, r1, g1, b1, k);

      const c00 = c000 + (c100 - c000) * dr;
      const c10 = c010 + (c110 - c010) * dr;
      const c01 = c001 + (c101 - c001) * dr;
      const c11 = c011 + (c111 - c011) * dr;

      const c0 = c00 + (c10 - c00) * dg;
      const c1 = c01 + (c11 - c01) * dg;

      const wert = c0 + (c1 - c0) * db;
      puffer[p + k] = Math.max(0, Math.min(255, Math.round(wert * 255)));
    }
  }
  return puffer;
}
