import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { abgeleitet, FASSUNGEN } from '../bild/abgeleitet.js';

/**
 * Galeriebilder werden einmal gerechnet und dann von der Platte geliefert -
 * vorher geschah das bei jedem Abruf neu.
 */
describe('Abgeleitete Bilder', () => {
  async function quellbild(): Promise<{ ordner: string; quelle: string }> {
    const ordner = mkdtempSync(join(tmpdir(), 'fb-abgeleitet-'));
    const quelle = join(ordner, 'layout.jpg');
    // Mit EXIF-Daten, um zu pruefen, dass sie in der Fassung fehlen.
    await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#4a7' } })
      .withMetadata({ exif: { IFD0: { Make: 'Canon', Model: 'EOS 600D' } } })
      .jpeg()
      .toFile(quelle);
    return { ordner, quelle };
  }

  it('rechnet einmal und liefert danach dieselbe Datei', async () => {
    const { ordner, quelle } = await quellbild();
    const erst = await abgeleitet(quelle, ordner, 'a1', FASSUNGEN.kioskKlein);
    const zeitErst = (await stat(erst)).mtimeMs;
    await new Promise((r) => setTimeout(r, 30));
    const zweit = await abgeleitet(quelle, ordner, 'a1', FASSUNGEN.kioskKlein);
    expect(zweit).toBe(erst);
    expect((await stat(zweit)).mtimeMs).toBe(zeitErst);

    const meta = await sharp(erst).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(480);
  });

  it('rechnet bei gleichzeitigen Abrufen nur einmal', async () => {
    const { ordner, quelle } = await quellbild();
    const pfade = await Promise.all(
      Array.from({ length: 20 }, () => abgeleitet(quelle, ordner, 'a2', FASSUNGEN.handyKlein)),
    );
    expect(new Set(pfade).size).toBe(1);
  });

  it('traegt keine EXIF-Daten, auch wenn die Quelle welche hat', async () => {
    const { ordner, quelle } = await quellbild();
    expect((await sharp(quelle).metadata()).exif).toBeDefined();
    const voll = await abgeleitet(quelle, ordner, 'a3', FASSUNGEN.handyVoll);
    expect((await sharp(voll).metadata()).exif).toBeUndefined();
  });
});
