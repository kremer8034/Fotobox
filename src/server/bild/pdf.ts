import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Canvas, Druckkalibrierung } from '../../shared/typen.js';

/**
 * Verpackt ein fertiges Layout als druckfertiges PDF.
 *
 * Der Weg ist bewusst deterministisch: Die Seite ist exakt so gross wie das
 * Papier (152,4 x 101,6 mm bei 4x6 Zoll), damit der Treiber nichts skalieren
 * muss. Zusammen mit "noscale" beim Druck stimmt die Groesse auf den
 * Millimeter.
 *
 * Die Druckkalibrierung wirkt nur auf das eingebettete Bild, nie auf die
 * Seitengroesse. Damit gilt sie einmal fuer alle Layouts und alle Events.
 */

/** PDF rechnet in Punkten: 1 pt = 1/72 Zoll. */
const PUNKTE_JE_MM = 72 / 25.4;

export interface PdfOptionen {
  canvas: Canvas;
  kalibrierung: Druckkalibrierung;
}

export async function schreibeDruckPdf(
  bild: Buffer,
  zielPfad: string,
  optionen: PdfOptionen,
): Promise<void> {
  await mkdir(dirname(zielPfad), { recursive: true });

  const seiteBreite = optionen.canvas.breiteMm * PUNKTE_JE_MM;
  const seiteHoehe = optionen.canvas.hoeheMm * PUNKTE_JE_MM;

  const k = optionen.kalibrierung;
  const skalaX = k.skalierungXProzent / 100;
  const skalaY = k.skalierungYProzent / 100;

  const bildBreite = seiteBreite * skalaX;
  const bildHoehe = seiteHoehe * skalaY;

  // Mittig ausrichten und den Versatz aufschlagen. So bleibt eine reine
  // Skalierung zentriert, statt aus der Ecke zu wachsen.
  const links = (seiteBreite - bildBreite) / 2 + k.versatzXMm * PUNKTE_JE_MM;
  const oben = (seiteHoehe - bildHoehe) / 2 + k.versatzYMm * PUNKTE_JE_MM;

  await new Promise<void>((fertig, fehler) => {
    const dokument = new PDFDocument({
      size: [seiteBreite, seiteHoehe],
      margin: 0,
      autoFirstPage: true,
    });
    const strom = createWriteStream(zielPfad);
    strom.on('finish', () => fertig());
    strom.on('error', fehler);
    dokument.on('error', fehler);
    dokument.pipe(strom);
    dokument.image(bild, links, oben, { width: bildBreite, height: bildHoehe });
    dokument.end();
  });
}
