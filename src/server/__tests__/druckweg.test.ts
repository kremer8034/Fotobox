import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { erstelleEvent } from '../fach/events.js';
import { blattInWarteschlange, blattVergeben, reiheEin, sorgeFuerSeitenbild } from '../fach/druckwarteschlange.js';
import { wurzelpfade } from '../fach/pfade.js';
import { schreibeDruckPdf, seitenbildPfad } from '../bild/pdf.js';
import { druckfehlerText } from '../treiber/drucker-windows.js';
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

/** Farbe eines Pixels im Seitenbild. */
async function pixel(datei: string, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(datei).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return [data[0]!, data[1]!, data[2]!];
}
const istRot = ([r, g, b]: number[]) => r! > 200 && g! < 60 && b! < 60;
const istWeiss = ([r, g, b]: number[]) => r! > 240 && g! > 240 && b! > 240;

describe('Seitenbild für den Windows-Druck', () => {
  it('liegt neben dem PDF: quer, 1800 x 1200 px, auch bei Hochformat', async () => {
    const hoch = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: '#c00' } }).jpeg().toBuffer();
    const ziel = join(datenpfad, 'seite-hoch.pdf');
    await schreibeDruckPdf(hoch, ziel, { canvas: CANVAS_PRESETS['10x15-hoch'], kalibrierung: KALIBRIERUNG_VORGABE });
    const seite = seitenbildPfad(ziel);
    expect(seite).toBe(join(datenpfad, '.cache', 'seite-hoch.seite.jpg'));
    const info = await sharp(seite).metadata();
    expect([info.width, info.height]).toEqual([1800, 1200]);
    // Ohne Kalibrierung bis in die Ecken bedruckt.
    expect(istRot(await pixel(seite, 0, 0))).toBe(true);
    expect(istRot(await pixel(seite, 1799, 1199))).toBe(true);
  });

  it('rechnet Versatz und Skalierung ein wie das PDF', async () => {
    const bild = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#c00' } }).jpeg().toBuffer();
    const ziel = join(datenpfad, 'seite-kalibriert.pdf');
    // 2 mm nach rechts (~24 px), auf 90 % verkleinert (links/rechts je 90 px Rand).
    const kalibrierung = { ...KALIBRIERUNG_VORGABE, versatzXMm: 2, skalierungXProzent: 90, skalierungYProzent: 90 };
    await schreibeDruckPdf(bild, ziel, { canvas: CANVAS_PRESETS['10x15-quer'], kalibrierung });
    const seite = seitenbildPfad(ziel);
    expect(istWeiss(await pixel(seite, 100, 600))).toBe(true); // 90 + 24 = 114 px weiss links
    expect(istRot(await pixel(seite, 130, 600))).toBe(true);
    expect(istRot(await pixel(seite, 1720, 600))).toBe(true); // rechts endet es bei 1734
    expect(istWeiss(await pixel(seite, 1750, 600))).toBe(true);
    expect(istWeiss(await pixel(seite, 900, 50))).toBe(true); // oben 60 px Rand
  });

  it('schneidet ab, was über den Rand ragt, statt zu scheitern', async () => {
    const bild = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#c00' } }).jpeg().toBuffer();
    const ziel = join(datenpfad, 'seite-gross.pdf');
    const kalibrierung = { versatzXMm: -5, versatzYMm: 5, skalierungXProzent: 105, skalierungYProzent: 105 };
    await schreibeDruckPdf(bild, ziel, { canvas: CANVAS_PRESETS['10x15-quer'], kalibrierung });
    const seite = seitenbildPfad(ziel);
    expect((await sharp(seite).metadata()).width).toBe(1800);
    expect(istRot(await pixel(seite, 0, 1199))).toBe(true);
    expect(istWeiss(await pixel(seite, 1799, 0))).toBe(true); // 5 mm nach links und unten verschoben
  });

  it('holt das Seitenbild für alte Druckdateien aus dem Layout nach', async () => {
    const event = erstelleEvent({ name: 'Alte Datei', datum: '2026-10-03' }, wurzel.events);
    const layout = join(datenpfad, 'alt-layout.jpg');
    writeFileSync(layout, await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#c00' } }).jpeg().toBuffer());
    const pdf = join(datenpfad, 'alt.pdf');
    writeFileSync(pdf, '%PDF-1.3 (vor 1.0.4)');
    const sitzung = 'alt-sitzung';
    holeDb()
      .prepare("INSERT INTO sitzungen (id, event_id, vorlage_id, gestartet, ist_test) VALUES (?, ?, 'v', '2026-10-03', 0)")
      .run(sitzung, event.id);
    holeDb()
      .prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES ('alt-a', ?, ?, ?, '2026-10-03')")
      .run(sitzung, layout, pdf);
    expect(existsSync(seitenbildPfad(pdf))).toBe(false);
    await sorgeFuerSeitenbild(pdf);
    expect((await sharp(seitenbildPfad(pdf)).metadata()).width).toBe(1800);
  });
});

describe('Fehlertext des Druckhelfers', () => {
  it('nimmt die letzte Zeile, die Windows geschrieben hat', () => {
    expect(druckfehlerText({ stderr: 'Warnung\r\nWindows kennt keinen Drucker mit dem Namen \'DS-RX1\'.\r\n' })).toBe(
      "Windows kennt keinen Drucker mit dem Namen 'DS-RX1'.",
    );
    expect(druckfehlerText({ killed: true, stderr: '' })).toMatch(/zwei Minuten/);
    expect(druckfehlerText(new Error('spawn powershell.exe ENOENT'))).toBe('spawn powershell.exe ENOENT');
  });

  // So kam es im Windows-Probelauf an: Fortschrittsanzeige als CLIXML hinter
  // der eigentlichen Meldung. Die muss trotzdem durchkommen.
  it('übersieht die Fortschrittsanzeige von PowerShell (CLIXML)', () => {
    const stderr =
      "Windows kennt keinen Drucker mit dem Namen 'Gibt es nicht'.\r\n#< CLIXML\r\n" +
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0">' +
      '<PR N="Record"><AV>Preparing modules for first use.</AV></PR></Obj></Objs>';
    expect(druckfehlerText({ stderr })).toBe("Windows kennt keinen Drucker mit dem Namen 'Gibt es nicht'.");
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
