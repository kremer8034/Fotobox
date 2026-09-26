import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { erstelleEvent } from '../fach/events.js';
import { blattInWarteschlange, blattVergeben, reiheEin } from '../fach/druckwarteschlange.js';
import { wurzelpfade } from '../fach/pfade.js';
import { schreibeDruckPdf } from '../bild/pdf.js';
import { CANVAS_PRESETS, KALIBRIERUNG_VORGABE } from '../../shared/typen.js';

let datenpfad: string;
let wurzel: ReturnType<typeof wurzelpfade>;

beforeAll(() => {
  datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-druckweg-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
});
afterAll(() => schliesseDb());

/** Die Zeichenbefehle der PDF-Seite, entpackt. */
function inhalt(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  let ergebnis = '';
  let pos = 0;
  for (;;) {
    const anfang = text.indexOf('stream\n', pos);
    if (anfang < 0) break;
    const ende = text.indexOf('endstream', anfang);
    if (ende < 0) break;
    try {
      ergebnis += inflateSync(pdf.subarray(anfang + 7, ende)).toString('latin1');
    } catch {
      // Bilddaten, kein Zeichenbefehl.
    }
    pos = ende + 9;
  }
  return ergebnis;
}

describe('Druck-PDF', () => {
  it('legt ein Hochformat-Layout gedreht auf die quere Papierseite', async () => {
    const hoch = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#c00' } }).jpeg().toBuffer();
    const ziel = join(datenpfad, 'hoch.pdf');
    await schreibeDruckPdf(hoch, ziel, { canvas: CANVAS_PRESETS['10x15-hoch'], kalibrierung: KALIBRIERUNG_VORGABE });
    const pdf = readFileSync(ziel);
    const text = pdf.toString('latin1');
    expect(text).toMatch(/\/MediaBox \[0 0 432 288\]/);
    expect(text).toMatch(/\/Width 1800/);
    expect(text).toMatch(/\/Height 1200/);
  });

  it('wendet den Versatz "waagerecht" auch bei Hochformat waagerecht auf dem Papier an', async () => {
    const hoch = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#00c' } }).jpeg().toBuffer();
    const ziel = join(datenpfad, 'versatz.pdf');
    await schreibeDruckPdf(hoch, ziel, {
      canvas: CANVAS_PRESETS['10x15-hoch'],
      kalibrierung: { ...KALIBRIERUNG_VORGABE, versatzXMm: 2 },
    });
    // "b 0 0 -h x y cm": 2 mm = 5,67 pt nach rechts, senkrecht unveraendert.
    const treffer = /([\d.]+) 0 0 -([\d.]+) ([\d.-]+) ([\d.-]+) cm\n\/I1 Do/.exec(inhalt(readFileSync(ziel)));
    expect(treffer).not.toBeNull();
    const [, breite, hoehe, x, y] = treffer!.map(Number);
    expect(breite).toBeCloseTo(432, 1);
    expect(hoehe).toBeCloseTo(288, 1);
    expect(x).toBeCloseTo(5.67, 1);
    expect(y).toBeCloseTo(288, 1);
  });
});

describe('Druck-Limit', () => {
  it('zählt wartende und fehlgeschlagene Blatt mit, Probelauf und Testdrucke nicht', () => {
    const e = erstelleEvent({ name: 'Kinderfest', datum: '2026-06-01' }, wurzel.events);
    const auftrag = (kopien: number, quelle: 'kiosk' | 'testdruck' = 'kiosk', berechnen = true) =>
      reiheEin({ eventId: e.id, ausgabeId: null, pfadPdf: '/x.pdf', kopien, quelle, berechnen });

    const gedruckt = auftrag(2);
    holeDb().prepare("UPDATE druckauftraege SET status = 'gedruckt' WHERE id = ?").run(gedruckt);
    auftrag(3); // wartet noch - die Rolle ist leer
    const gescheitert = auftrag(1);
    holeDb().prepare("UPDATE druckauftraege SET status = 'fehlgeschlagen' WHERE id = ?").run(gescheitert);
    auftrag(2, 'kiosk', false); // Probelauf
    auftrag(1, 'testdruck');

    expect(blattVergeben(e.id)).toBe(6);
    // In der Schlange stehen alle, die noch herauskommen - auch Probelauf und Testdruck.
    expect(blattInWarteschlange()).toBe(3 + 2 + 1);
  });
});
