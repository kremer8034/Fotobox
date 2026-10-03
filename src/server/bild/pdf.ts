import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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

  await schreibeSeitenbild(bild, seitenbildPfad(zielPfad), optionen.kalibrierung);
}

/** 300 dpi auf 6 x 4 Zoll - genau die Seite, die auf dem Papier landet. */
const SEITE_PX = { breite: 1800, hoehe: 1200 };
const PX_JE_MM = 300 / 25.4;

/**
 * Wo das Seitenbild zu einer Druckdatei liegt: daneben im Unterordner .cache.
 * Den laesst die Uebergabe auf den USB-Stick aus - der Gastgeber bekommt die
 * PDFs, nicht zusaetzlich jedes Bild ein zweites Mal.
 */
export function seitenbildPfad(pdfPfad: string): string {
  return join(dirname(pdfPfad), '.cache', basename(pdfPfad).replace(/\.pdf$/i, '') + '.seite.jpg');
}

/**
 * Dieselbe Seite wie im PDF, als fertiges Bild: quer, 1800 x 1200 px, die
 * Druckkalibrierung schon eingerechnet. Das druckt der Windows-Druckhelfer
 * Pixel fuer Pixel auf das ganze Blatt.
 *
 * Warum ein Bild und nicht das PDF: SumatraPDF meldete mit "-silent" jeden
 * Fehlschlag als Erfolg (Rueckgabewert 0) - die Box hielt Auftraege fuer
 * gedruckt, bei Windows kam nie einer an. Ein Bild kann Windows selbst
 * drucken, ohne fremdes Programm, und jeder Fehler kommt als Text zurueck.
 *
 * Ob das Layout hochkant liegt, verraet das Bild selbst.
 */
export async function schreibeSeitenbild(
  layout: Buffer,
  zielPfad: string,
  kalibrierung: Druckkalibrierung,
): Promise<void> {
  await mkdir(dirname(zielPfad), { recursive: true });
  const info = await sharp(layout).metadata();
  const hochkant = (info.height ?? 0) > (info.width ?? 0);
  const quer = hochkant ? sharp(layout).rotate(90) : sharp(layout);

  const breite = Math.max(1, Math.round((SEITE_PX.breite * kalibrierung.skalierungXProzent) / 100));
  const hoehe = Math.max(1, Math.round((SEITE_PX.hoehe * kalibrierung.skalierungYProzent) / 100));
  const links = Math.round((SEITE_PX.breite - breite) / 2 + kalibrierung.versatzXMm * PX_JE_MM);
  const oben = Math.round((SEITE_PX.hoehe - hoehe) / 2 + kalibrierung.versatzYMm * PX_JE_MM);

  // Was ueber den Seitenrand hinausragt, abschneiden - sharp legt nur Bilder
  // auf, die ganz auf die Seite passen. Genau so beschneidet es auch das PDF.
  const vonX = Math.max(0, -links);
  const vonY = Math.max(0, -oben);
  const sichtbarBreite = Math.min(breite, SEITE_PX.breite - links) - vonX;
  const sichtbarHoehe = Math.min(hoehe, SEITE_PX.hoehe - oben) - vonY;

  const seite = sharp({
    create: { width: SEITE_PX.breite, height: SEITE_PX.hoehe, channels: 3, background: '#ffffff' },
  });
  const ebenen =
    sichtbarBreite > 0 && sichtbarHoehe > 0
      ? [
          {
            input: await sharp(await quer.toBuffer())
              .resize(breite, hoehe, { fit: 'fill' })
              .extract({ left: vonX, top: vonY, width: sichtbarBreite, height: sichtbarHoehe })
              .toBuffer(),
            left: Math.max(0, links),
            top: Math.max(0, oben),
          },
        ]
      : [];
  await seite
    .composite(ebenen)
    .withMetadata({ density: 300 })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(zielPfad);
}
