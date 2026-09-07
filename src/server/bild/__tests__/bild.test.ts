import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { parseCube, wendeLutAn } from '../lut.js';
import { baueLayout, ersetzePlatzhalter, layoutMasse } from '../layout.js';
import { schreibeDruckPdf } from '../pdf.js';
import { kalibrierTestbild, platzhalterFoto } from '../testbilder.js';
import { CANVAS_PRESETS, KALIBRIERUNG_VORGABE, type Vorlage } from '../../../shared/typen.js';

const canvasQuer = CANVAS_PRESETS['10x15-quer'];

function vorlageMitEinemFoto(): Vorlage {
  return {
    id: 'test',
    name: 'Test',
    canvas: canvasQuer,
    hintergrundFarbe: '#ffffff',
    ebenen: [
      { id: 'f1', typ: 'foto', index: 1, x: 0.1, y: 0.1, w: 0.8, h: 0.6 },
      {
        id: 't1',
        typ: 'text',
        text: '{veranstaltung} am {datum}',
        x: 0.1,
        y: 0.75,
        w: 0.8,
        h: 0.15,
        groesse: 0.08,
        farbe: '#222222',
        ausrichtung: 'mitte',
      },
    ],
  };
}

describe('Druckmasse', () => {
  it('ergibt bei 10x15 quer exakt 1800 x 1200 Pixel', () => {
    // 300 dpi auf 4x6 Zoll. Diese Zahl ist die Grundlage des ganzen Druckwegs.
    expect(layoutMasse(vorlageMitEinemFoto())).toEqual({ breitePx: 1800, hoehePx: 1200 });
  });

  it('ergibt bei 10x15 hoch exakt 1200 x 1800 Pixel', () => {
    const hoch = { ...vorlageMitEinemFoto(), canvas: CANVAS_PRESETS['10x15-hoch'] };
    expect(layoutMasse(hoch)).toEqual({ breitePx: 1200, hoehePx: 1800 });
  });
});

describe('Platzhalter in Textebenen', () => {
  it('ersetzt bekannte Namen und laesst unbekannte stehen', () => {
    const text = ersetzePlatzhalter('{veranstaltung} am {datum}, {unbekannt}', {
      veranstaltung: 'Hochzeit Mueller',
      datum: '16.05.2026',
    });
    expect(text).toBe('Hochzeit Mueller am 16.05.2026, {unbekannt}');
  });
});

describe('Layout-Compositing', () => {
  it('setzt Foto und Text zu einem 1800x1200-Bild zusammen', async () => {
    const foto = await platzhalterFoto(1);
    const ergebnis = await baueLayout(vorlageMitEinemFoto(), {
      fotos: new Map([[1, foto]]),
      assetsOrdner: tmpdir(),
      platzhalter: { veranstaltung: 'Testfeier', datum: '01.01.2026' },
    });
    const metadaten = await sharp(ergebnis).metadata();
    expect(metadaten.width).toBe(1800);
    expect(metadaten.height).toBe(1200);
  });

  it('ueberspringt ausgeblendete Ebenen', async () => {
    const vorlage = vorlageMitEinemFoto();
    vorlage.ebenen[0]!.sichtbar = false;
    const ergebnis = await baueLayout(vorlage, {
      fotos: new Map([[1, await platzhalterFoto(1)]]),
      assetsOrdner: tmpdir(),
      platzhalter: {},
    });
    // Ohne das Foto bleibt die obere Bildhaelfte der weisse Hintergrund.
    const pixel = await sharp(ergebnis)
      .extract({ left: 900, top: 300, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(pixel[0]).toBeGreaterThan(240);
  });
});

describe('3D-LUT', () => {
  const cubeInvertiert = `TITLE "Invertiert"
LUT_3D_SIZE 2
0 0 0
0 0 0
0 0 0
0 0 0
1 1 1
1 1 1
1 1 1
1 1 1`;

  it('liest eine .cube-Datei ein', () => {
    const lut = parseCube(cubeInvertiert);
    expect(lut.groesse).toBe(2);
    expect(lut.daten.length).toBe(24);
  });

  it('weist eine unvollstaendige Datei zurueck', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/Eintraege/);
  });

  it('wendet die LUT auf einen Rohpuffer an', () => {
    // Diese LUT haengt nur an Blau: b=0 wird schwarz, b=1 wird weiss.
    const lut = parseCube(cubeInvertiert);
    const puffer = Buffer.from([255, 255, 0, 255, 255, 255]);
    wendeLutAn(puffer, 3, lut);
    expect(puffer[0]).toBe(0);
    expect(puffer[3]).toBe(255);
  });
});

describe('Druck-PDF', () => {
  it('erzeugt eine Seite mit exakt 152,4 x 101,6 mm', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'fotobox-pdf-'));
    const ziel = join(ordner, 'druck.pdf');
    await schreibeDruckPdf(await platzhalterFoto(1, 1800, 1200), ziel, {
      canvas: canvasQuer,
      kalibrierung: KALIBRIERUNG_VORGABE,
    });

    const inhalt = readFileSync(ziel, 'latin1');
    const treffer = inhalt.match(/\/MediaBox \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/);
    expect(treffer).not.toBeNull();
    // 152,4 mm = 432 pt, 101,6 mm = 288 pt. Toleranz 0,1 pt gegen Rundung.
    expect(Number(treffer![3])).toBeCloseTo(432, 1);
    expect(Number(treffer![4])).toBeCloseTo(288, 1);
  });
});

describe('Kalibrier-Testbild', () => {
  it('hat Druckaufloesung und ist ueberwiegend weiss', async () => {
    const bild = await kalibrierTestbild(canvasQuer);
    const metadaten = await sharp(bild).metadata();
    expect(metadaten.width).toBe(1800);
    expect(metadaten.height).toBe(1200);
    const { channels } = await sharp(bild).stats();
    expect(channels[0]!.mean).toBeGreaterThan(200);
  });
});
