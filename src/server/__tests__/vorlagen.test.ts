import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { baueLayout } from '../bild/layout.js';
import { VORLAGE_EINGABE, beschreibePruefung } from '../fach/vorlagen.js';
import { CANVAS_PRESETS, fotoEbenen, type Ebene, type Vorlage } from '../../shared/typen.js';

/*
 * Der Vorlagen-Editor erlaubt mehr, als der Druck frueher verkraftete. Diese
 * Tests halten fest, dass jede Vorlage, die der Editor speichern kann, auch
 * gedruckt wird - und zwar so, wie der Editor sie zeigt.
 */

let ordner: string;
const fotos = new Map<number, Buffer>();
const FARBEN = ['#ff0000', '#00ff00', '#0000ff'];

function vorlage(ebenen: Ebene[]): Vorlage {
  return { id: 't', name: 't', canvas: CANVAS_PRESETS['10x15-quer'], hintergrundFarbe: '#ffffff', ebenen, erstellt: '', geaendert: '' } as Vorlage;
}

async function rendern(ebenen: Ebene[]) {
  const b = await baueLayout(vorlage(ebenen), { fotos, assetsOrdner: ordner, platzhalter: {} });
  return sharp(b).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** Farbe am relativen Punkt (0..1). */
async function farbeBei(ebenen: Ebene[], px: number, py: number): Promise<[number, number, number]> {
  const { data, info } = await rendern(ebenen);
  const i = (Math.round(py * (info.height - 1)) * info.width + Math.round(px * (info.width - 1))) * 3;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

const ist = (farbe: [number, number, number], hex: string) => {
  const soll = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return farbe.every((w, i) => Math.abs(w - soll[i]!) < 40);
};

beforeAll(async () => {
  ordner = mkdtempSync(join(tmpdir(), 'fotobox-vorlagen-'));
  await sharp({ create: { width: 300, height: 200, channels: 4, background: '#ff8800' } }).png().toFile(join(ordner, 'hg.png'));
  writeFileSync(join(tmpdir(), 'fremd.png'), await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).png().toBuffer());
  for (let i = 0; i < 3; i += 1) {
    fotos.set(i + 1, await sharp({ create: { width: 600, height: 400, channels: 3, background: FARBEN[i]! } }).jpeg().toBuffer());
  }
});

const foto = (id: string, index: number, x: number, extra: Partial<Ebene> = {}) =>
  ({ id, typ: 'foto', index, x, y: 0.25, w: 0.3, h: 0.5, einpassung: 'cover', ...extra }) as Ebene;

describe('Druck einer Vorlage', () => {
  it('verkraftet einen Hintergrund, der fuer den randlosen Druck uebersteht', async () => {
    const hg = { id: 'hg', typ: 'bild', datei: 'hg.png', x: -0.02, y: -0.02, w: 1.04, h: 1.04 } as Ebene;
    expect(ist(await farbeBei([hg], 0, 0), '#ff8800')).toBe(true);
    expect(ist(await farbeBei([hg], 1, 1), '#ff8800')).toBe(true);
  });

  it('verkraftet Text, der breiter ist als die Seite, und Ebenen ganz ausserhalb', async () => {
    const text = { id: 't', typ: 'text', text: 'Hallo', x: -0.2, y: 0.4, w: 1.4, h: 0.2, groesse: 0.1, farbe: '#000000' } as Ebene;
    const weg = { id: 'w', typ: 'foto', index: 1, x: 1.5, y: 1.5, w: 0.3, h: 0.3 } as Ebene;
    await expect(rendern([text, weg])).resolves.toBeTruthy();
  });

  it('dreht um die Mitte der Ebene - wie der Editor', async () => {
    const gedreht = { ...foto('f', 1, 0.35), y: 0.25, rotation: 20 } as Ebene;
    const { data, info } = await rendern([gedreht]);
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < info.height; y += 2) for (let x = 0; x < info.width; x += 2) {
      const i = (y * info.width + x) * 3;
      if (data[i]! > 200 && data[i + 1]! < 60) { sx += x; sy += y; n += 1; }
    }
    expect(sx / n / info.width).toBeCloseTo(0.5, 1);
    expect(sy / n / info.height).toBeCloseTo(0.5, 1);
  });

  it('holt keine Datei von ausserhalb des Vorlagenordners', async () => {
    const boese = { id: 'b', typ: 'bild', datei: '../fremd.png', x: 0, y: 0, w: 1, h: 1 } as Ebene;
    expect(ist(await farbeBei([boese], 0.5, 0.5), '#ffffff')).toBe(true);
  });
});

describe('Welches Foto wohin', () => {
  it('eine Luecke in der Nummerierung laesst keinen Platz leer', async () => {
    const ebenen = [foto('a', 1, 0.02), foto('b', 3, 0.35)];
    expect(fotoEbenen(vorlage(ebenen))).toHaveLength(2);
    expect(ist(await farbeBei(ebenen, 0.5, 0.5), FARBEN[1]!)).toBe(true);
  });

  it('doppelte Nummern: jede Ebene bekommt ein eigenes Foto', async () => {
    const ebenen = [foto('a', 2, 0.02), foto('b', 2, 0.35), foto('c', 1, 0.68)];
    expect(ist(await farbeBei(ebenen, 0.83, 0.5), FARBEN[0]!)).toBe(true);
    expect(ist(await farbeBei(ebenen, 0.17, 0.5), FARBEN[1]!)).toBe(true);
    expect(ist(await farbeBei(ebenen, 0.5, 0.5), FARBEN[2]!)).toBe(true);
  });

  it('ausgeblendete Foto-Ebenen bekommen kein Foto - und es wird keins fuer sie aufgenommen', () => {
    const ebenen = [foto('a', 1, 0.02), foto('b', 2, 0.35, { sichtbar: false }), foto('c', 3, 0.68)];
    expect(fotoEbenen(vorlage(ebenen)).map((e) => e.id)).toEqual(['a', 'c']);
  });
});

describe('Pruefung beim Speichern', () => {
  const gut = { name: 'Test', preset: '10x15-quer', ebenen: [foto('a', 1, 0.1)] };

  it('nimmt eine gewoehnliche Vorlage', () => {
    expect(VORLAGE_EINGABE.safeParse(gut).success).toBe(true);
  });

  it.each([
    ['Pfad im Dateinamen', { id: 'b', typ: 'bild', datei: '../../fotobox.db', x: 0, y: 0, w: 1, h: 1 }],
    ['keine Breite', { id: 'f', typ: 'foto', index: 1, x: 0, y: 0, w: 0, h: 1 }],
    ['Position NaN', { id: 'f', typ: 'foto', index: 1, x: Number.NaN, y: 0, w: 1, h: 1 }],
    ['Nummer 0', { id: 'f', typ: 'foto', index: 0, x: 0, y: 0, w: 1, h: 1 }],
    ['Farbe mit Skript', { id: 't', typ: 'text', text: 'x', x: 0, y: 0, w: 1, h: 1, groesse: 0.05, farbe: 'red"/><script>' }],
    ['unbekannter Typ', { id: 'x', typ: 'video', x: 0, y: 0, w: 1, h: 1 }],
  ])('weist ab: %s - mit verstaendlicher Meldung', (_name, ebene) => {
    const eingabe = { ...gut, ebenen: [foto('a', 1, 0.1), ebene] };
    const ergebnis = VORLAGE_EINGABE.safeParse(eingabe);
    expect(ergebnis.success).toBe(false);
    if (!ergebnis.success) expect(beschreibePruefung(ergebnis.error, eingabe.ebenen)).toMatch(/^Ebene 2/);
  });
});
