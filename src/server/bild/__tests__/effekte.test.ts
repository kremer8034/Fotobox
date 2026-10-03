import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { wendeRohAn, type Roh } from '../effekte.js';
import { EINGEBAUTE_FILTER, wendeFilterAn } from '../filter.js';
import { FILTER_OPERATION } from '../../fach/filter.js';

/** Ein Verlauf von Schwarz nach Weiss, 256 Pixel breit, 2 hoch, in Farbe. */
function verlauf(): Roh {
  const data = Buffer.alloc(256 * 2 * 3);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 3;
      data[i] = x;
      data[i + 1] = x;
      data[i + 2] = Math.min(255, x + 10);
    }
  }
  return { data, width: 256, height: 2, channels: 3 };
}

const werte = (roh: Roh) => new Set(Array.from(roh.data));

describe('Effekte auf dem Rohpuffer', () => {
  it('Farbstufen: nur noch so viele Werte je Kanal wie Stufen', () => {
    expect(werte(wendeRohAn(verlauf(), { op: 'posterisieren', stufen: 4 })).size).toBeLessThanOrEqual(4);
  });

  it('Verlaufskarte: dunkel wird zur ersten, hell zur letzten Farbe', () => {
    const roh = wendeRohAn(verlauf(), { op: 'verlaufskarte', farben: ['#ff0000', '#0000ff'] });
    // Das erste Pixel ist fast schwarz (Blau 10) - also fast reines Rot.
    expect(roh.data[0]).toBeGreaterThan(250);
    expect(roh.data[2]).toBeLessThan(5);
    const letztes = (256 - 1) * 3;
    expect(roh.data[letztes + 2]).toBeGreaterThan(240);
    expect(roh.data[letztes]).toBeLessThan(15);
  });

  it('Verlaufskarte mit Stufen: harte Farbflaechen (Warhol)', () => {
    const roh = wendeRohAn(verlauf(), {
      op: 'verlaufskarte',
      farben: ['#000000', '#ff0000', '#ffff00', '#ffffff'],
      stufen: 4,
    });
    const farben = new Set<string>();
    for (let i = 0; i < roh.data.length; i += 3) farben.add(`${roh.data[i]},${roh.data[i + 1]},${roh.data[i + 2]}`);
    expect(farben.size).toBe(4);
  });

  it('Solarisation kehrt nur die hellen Werte um', () => {
    const roh = wendeRohAn(verlauf(), { op: 'solarisation', schwelle: 0.5 });
    expect(roh.data[50 * 3]).toBe(50);
    expect(roh.data[200 * 3]).toBe(55);
  });

  it('RGB-Versatz behaelt die Bildgroesse und laesst Gruen stehen', () => {
    const vorher = verlauf();
    const roh = wendeRohAn(vorher, { op: 'kanalversatz', staerke: 0.02 });
    expect(roh.data.length).toBe(vorher.data.length);
    expect(roh.data[100 * 3 + 1]).toBe(vorher.data[100 * 3 + 1]);
    expect(roh.data[100 * 3]).not.toBe(vorher.data[100 * 3]);
  });

  it('Filmkorn ist bei gleichem Bild immer gleich - Vorschau und Druck stimmen ueberein', () => {
    const a = wendeRohAn(verlauf(), { op: 'koernung', staerke: 0.3 });
    const b = wendeRohAn(verlauf(), { op: 'koernung', staerke: 0.3 });
    expect(a.data.equals(b.data)).toBe(true);
    expect(a.data.equals(verlauf().data)).toBe(false);
  });

  it('macht aus einem Graustufenbild eines mit drei Kanaelen', () => {
    const grau: Roh = { data: Buffer.from([0, 128, 255]), width: 3, height: 1, channels: 1 };
    const roh = wendeRohAn(grau, { op: 'teiltonung', schatten: '#0000ff', lichter: '#ff8800', staerke: 1 });
    expect(roh.channels).toBe(3);
    expect(roh.data.length).toBe(9);
  });
});

describe('Die kraeftigen Filter', () => {
  it('laufen alle durch und veraendern das Foto sichtbar', async () => {
    const foto = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 120, b: 90 } },
    })
      .composite([{ input: Buffer.from('<svg width="300" height="200"><circle cx="150" cy="100" r="60" fill="#3060c0"/></svg>') }])
      .jpeg()
      .toBuffer();
    const original = await sharp(foto).raw().toBuffer();
    for (const preset of EINGEBAUTE_FILTER) {
      if (preset.id === 'ohne') continue;
      const ergebnis = await wendeFilterAn(foto, preset, { lutOrdner: '/' });
      const { data, info } = await sharp(ergebnis).raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height], preset.name).toEqual([300, 200]);
      let unterschied = 0;
      for (let i = 0; i < Math.min(data.length, original.length); i++) unterschied += Math.abs(data[i]! - original[i]!);
      expect(unterschied / original.length, preset.name).toBeGreaterThan(3);
    }
  });

  it('jede Operation der eingebauten Filter besteht die Pruefung fuer eigene Filter', () => {
    for (const preset of EINGEBAUTE_FILTER) {
      for (const op of preset.operationen) expect(FILTER_OPERATION.safeParse(op).success, `${preset.name}: ${op.op}`).toBe(true);
    }
  });
});
