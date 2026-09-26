import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { wendeFilterAn } from '../bild/filter.js';
import type { FilterPreset } from '../../shared/typen.js';

/*
 * Saettigung, Helligkeit, Kontrast und Farbmatrix werden vorab zu einem
 * einzigen Rechenschritt zusammengefasst. Diese Tests pruefen, dass dabei die
 * Wirkung jedes einzelnen und ihre Reihenfolge erhalten bleiben.
 */

const kontext = { lutOrdner: '/nicht/benutzt' };

async function einfarbig(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

async function pixel(bild: Buffer): Promise<number[]> {
  const { data } = await sharp(bild).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}

function preset(operationen: FilterPreset['operationen']): FilterPreset {
  return { id: 'test', name: 'Test', eingebaut: false, operationen };
}

describe('Filter', () => {
  it('Saettigung 0 macht grau, ohne die Helligkeit zu verschieben', async () => {
    const [r, g, b] = await pixel(await wendeFilterAn(await einfarbig(200, 80, 40), preset([{ op: 'saettigung', wert: 0 }]), kontext));
    expect(Math.abs(r! - g!)).toBeLessThanOrEqual(2);
    expect(Math.abs(g! - b!)).toBeLessThanOrEqual(2);
    // Rec.-709-Helligkeit von (200, 80, 40): 0,2126·200 + 0,7152·80 + 0,0722·40 ≈ 102
    expect(Math.abs(g! - 102)).toBeLessThanOrEqual(3);
  });

  it('Kontrast laesst die Bildmitte stehen und spreizt den Rest', async () => {
    const mitte = await pixel(await wendeFilterAn(await einfarbig(128, 128, 128), preset([{ op: 'kontrast', wert: 1.5 }]), kontext));
    expect(mitte.every((w) => Math.abs(w - 128) <= 2)).toBe(true);
    const hell = await pixel(await wendeFilterAn(await einfarbig(178, 178, 178), preset([{ op: 'kontrast', wert: 1.5 }]), kontext));
    expect(hell.every((w) => Math.abs(w - 203) <= 2)).toBe(true);
  });

  it('haelt die Reihenfolge ein: erst heller, dann Kontrast ist nicht dasselbe wie umgekehrt', async () => {
    const quelle = await einfarbig(100, 100, 100);
    const [a] = await pixel(await wendeFilterAn(quelle, preset([{ op: 'helligkeit', wert: 1.2 }, { op: 'kontrast', wert: 2 }]), kontext));
    const [b] = await pixel(await wendeFilterAn(quelle, preset([{ op: 'kontrast', wert: 2 }, { op: 'helligkeit', wert: 1.2 }]), kontext));
    // 100 · 1,2 = 120 → 2 · 120 − 128 = 112   bzw.   2 · 100 − 128 = 72 → 72 · 1,2 ≈ 86
    expect(Math.abs(a! - 112)).toBeLessThanOrEqual(2);
    expect(Math.abs(b! - 86)).toBeLessThanOrEqual(2);
  });

  it('wendet zwei Farbmatrizen nacheinander an, statt die erste zu verlieren', async () => {
    const tauschen = { op: 'farbmatrix' as const, matrix: [0, 1, 0, 1, 0, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number] };
    const [r, g, b] = await pixel(await wendeFilterAn(await einfarbig(200, 50, 10), preset([tauschen, tauschen]), kontext));
    // Zweimal Rot und Gruen tauschen ergibt das Original.
    expect([r, g, b].map((w, i) => Math.abs(w! - [200, 50, 10][i]!) <= 2)).toEqual([true, true, true]);
  });

  it('verkraftet lineare Schritte auf einem Graustufenbild', async () => {
    const [r, g, b] = await pixel(
      await wendeFilterAn(await einfarbig(200, 80, 40), preset([{ op: 'graustufen' }, { op: 'saettigung', wert: 1.4 }, { op: 'kontrast', wert: 1.1 }]), kontext),
    );
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('Sepia toent warm, statt nur grau zu machen', async () => {
    const [r, g, b] = await pixel(
      await wendeFilterAn(await einfarbig(150, 150, 150), preset([{ op: 'tonung', farbe: '#a07850', staerke: 0.8 }]), kontext),
    );
    expect(r! - b!).toBeGreaterThan(40);
    // auch mit einem Graustufen-Schritt davor
    const [r2, , b2] = await pixel(
      await wendeFilterAn(
        await einfarbig(150, 150, 150),
        preset([{ op: 'graustufen' }, { op: 'tonung', farbe: '#a07850', staerke: 0.8 }]),
        kontext,
      ),
    );
    expect(r2! - b2!).toBeGreaterThan(40);
  });
});
