import PDFDocument from 'pdfkit';
import sharp from 'sharp';
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
 *
 * Die Seite liegt immer quer, so wie das Papier im Drucker. Ein Layout im
 * Hochformat wird vorher um 90 Grad gedreht. Vorher bekam es eine hochkant
 * stehende Seite, die SumatraPDF beim Drucken selbst drehte - und dabei
 * drehte es die Kalibrierung mit: Der am queren Testbild gemessene Versatz
 * "waagerecht" landete bei Hochformat-Layouts auf dem Papier senkrecht, die
 * Skalierungen waren vertauscht.
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

  const { breiteMm, hoeheMm } = optionen.canvas;
  const hochkant = hoeheMm > breiteMm;
  const seiteBreite = Math.max(breiteMm, hoeheMm) * PUNKTE_JE_MM;
  const seiteHoehe = Math.min(breiteMm, hoeheMm) * PUNKTE_JE_MM;
  const seitenbild = hochkant ? await sharp(bild).rotate(90).jpeg({ quality: 95 }).toBuffer() : bild;

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
    dokument.image(seitenbild, links, oben, { width: bildBreite, height: bildHoehe });
    dokument.end();
  });
}
