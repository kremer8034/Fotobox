import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { eventpfade } from './pfade.js';
import { wlanQrText } from '../netzwerk.js';
import type { Veranstaltung } from '../../shared/typen.js';

/**
 * Zwei Zettel, die die Software je Veranstaltung erzeugt - bewusst getrennt,
 * weil sie unterschiedliche Leser haben:
 *
 *  - Die Kurzanleitung fuer den Gastgeber wird in die Box gelegt: Betreuer-PIN,
 *    Papierwechsel, was die Stoerungshinweise bedeuten, Telefonnummer.
 *  - Der Aushang fuer die Gaeste wird aussen angeklebt: die beiden QR-Codes
 *    fuer WLAN und Galerie, sonst nichts. Auf dem Aushang darf keine PIN
 *    stehen - sonst lesen die Gaeste sie mit.
 */

const A5_QUER: [number, number] = [595.28, 419.53];
const RAND = 40;

export interface Unterlagenangaben {
  betreuerPin: string;
  telefon: string;
  galerieUrl?: string;
  wlanName?: string;
  wlanPasswort?: string;
}

export async function schreibeKurzanleitung(
  event: Veranstaltung,
  angaben: Unterlagenangaben,
): Promise<string> {
  const ordner = join(eventpfade(event.ordner).cache, 'unterlagen');
  await mkdir(ordner, { recursive: true });
  const pfad = join(ordner, 'kurzanleitung.pdf');

  await schreibe(pfad, (d) => {
    d.fontSize(22).text('Fotobox — Kurzanleitung', RAND, RAND);
    d.fontSize(11).fillColor('#555').text(`${event.name} · ${datum(event)}`);
    d.moveDown(1).fillColor('#000');

    abschnitt(d, 'Wenn etwas klemmt', [
      'Die Fotobox sagt auf dem Bildschirm in normalen Worten, was los ist.',
      'Sie verliert dabei kein Foto: Alles wird nachgeholt, sobald es weitergeht.',
    ]);

    abschnitt(d, 'Papier wechseln', [
      'Neue Rolle einlegen wie gewohnt.',
      'Dann oben rechts am Bildschirm lange auf die Ecke druecken (zwei Sekunden),',
      `PIN ${angaben.betreuerPin} eingeben und "Papier gewechselt" waehlen.`,
      'Bei einer ganz neuen Rolle zusaetzlich "Neue Rolle eingelegt" antippen.',
    ]);

    abschnitt(d, 'Was du sonst noch kannst', [
      'Nachdruck: im selben Menue "Nachdruck aus der Galerie".',
      'Pause: "Pause ein" zeigt den Gaesten einen freundlichen Hinweis.',
    ]);

    abschnitt(d, 'Wenn gar nichts hilft', [
      `Bitte anrufen: ${angaben.telefon || '(Nummer eintragen)'}`,
      'Hilfreich ist ein Foto vom Bildschirm "Was ist los?" — dieser Knopf steht',
      'auf der PIN-Abfrage und braucht selbst keine PIN.',
    ]);

    d.fontSize(9)
      .fillColor('#777')
      .text('Diesen Zettel bitte in der Box lassen — er enthaelt die PIN.', RAND, A5_QUER[1] - RAND - 10);
  });

  return pfad;
}

export async function schreibeAushang(
  event: Veranstaltung,
  angaben: Unterlagenangaben,
): Promise<string> {
  const ordner = join(eventpfade(event.ordner).cache, 'unterlagen');
  await mkdir(ordner, { recursive: true });
  const pfad = join(ordner, 'qr-aushang.pdf');

  const galerieQr = angaben.galerieUrl
    ? await QRCode.toBuffer(angaben.galerieUrl, { width: 600, margin: 1 })
    : null;
  const wlanQr =
    angaben.wlanName && angaben.wlanPasswort
      ? await QRCode.toBuffer(wlanQrText(angaben.wlanName, angaben.wlanPasswort), {
          width: 600,
          margin: 1,
        })
      : null;

  await schreibe(pfad, (d) => {
    d.fontSize(26).text('Eure Fotos aufs Handy', RAND, RAND, { align: 'center', width: A5_QUER[0] - 2 * RAND });
    d.moveDown(0.4);
    d.fontSize(12)
      .fillColor('#444')
      .text('Kamera aufs Quadrat halten — fertig.', { align: 'center', width: A5_QUER[0] - 2 * RAND });

    const groesse = 170;
    const y = 130;
    const linksX = RAND + 30;
    const rechtsX = A5_QUER[0] - RAND - 30 - groesse;

    if (wlanQr) {
      d.image(wlanQr, linksX, y, { width: groesse });
      d.fillColor('#000')
        .fontSize(13)
        .text('1. Ins WLAN', linksX, y + groesse + 10, { width: groesse, align: 'center' });
    }
    if (galerieQr) {
      d.image(galerieQr, rechtsX, y, { width: groesse });
      d.fillColor('#000')
        .fontSize(13)
        .text(wlanQr ? '2. Galerie öffnen' : 'Galerie öffnen', rechtsX, y + groesse + 10, {
          width: groesse,
          align: 'center',
        });
    }

    d.fontSize(10)
      .fillColor('#777')
      .text(
        'Die Bilder bleiben im lokalen Netz der Fotobox.',
        RAND,
        A5_QUER[1] - RAND - 12,
        { align: 'center', width: A5_QUER[0] - 2 * RAND },
      );
  });

  return pfad;
}

function abschnitt(d: PDFKit.PDFDocument, titel: string, zeilen: string[]): void {
  d.fontSize(13).fillColor('#000').text(titel);
  d.fontSize(10.5).fillColor('#333');
  for (const zeile of zeilen) d.text(`· ${zeile}`, { indent: 8 });
  d.moveDown(0.7);
}

function datum(event: Veranstaltung): string {
  return new Date(event.datum).toLocaleDateString('de-DE');
}

async function schreibe(pfad: string, inhalt: (d: PDFKit.PDFDocument) => void): Promise<void> {
  await new Promise<void>((fertig, fehler) => {
    const d = new PDFDocument({ size: A5_QUER, margin: RAND });
    const strom = createWriteStream(pfad);
    strom.on('finish', () => fertig());
    strom.on('error', fehler);
    d.pipe(strom);
    inhalt(d);
    d.end();
  });
}
