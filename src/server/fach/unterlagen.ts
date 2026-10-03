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
  const galerieQr = angaben.galerieUrl
    ? await QRCode.toBuffer(angaben.galerieUrl, { width: 400, margin: 1 })
    : null;

  await schreibe(pfad, (d) => zeichneKurzanleitung(d, event, angaben, galerieQr));

  return pfad;
}

/*
 * Die Kurzanleitung auf A4 hoch - der Zettel, der in der Box liegt.
 * Vorher A5 quer, mit der PIN mitten im Fliesstext ("PIN 8585 eingeben") -
 * der Besitzer fand sie nicht. Jetzt steht sie gross in einer eigenen Karte.
 * Alles wird von Hand gesetzt (Rand 0, feste Positionen): Sonst schob PDFKit
 * die Fusszeile auf eine fast leere zweite Seite.
 */
const A4: [number, number] = [595.28, 841.89];
const FARBE = {
  dunkel: '#1b1f27',
  akzent: '#d0a04a',
  akzentHell: '#f7eedc',
  flaeche: '#f3f4f6',
  text: '#1f2329',
  leise: '#5d6470',
  kopfLeise: '#c3c7cf',
};

function zeichneKurzanleitung(
  d: PDFKit.PDFDocument,
  event: Veranstaltung,
  angaben: Unterlagenangaben,
  galerieQr: Buffer | null,
): void {
  const [breite, hoehe] = A4;
  const rand = 46;
  const innen = breite - 2 * rand;

  // Kopf
  d.rect(0, 0, breite, 132).fill(FARBE.dunkel);
  d.rect(0, 132, breite, 4).fill(FARBE.akzent);
  d.font('Helvetica-Bold').fontSize(10).fillColor(FARBE.akzent)
    .text('FOTOBOX', rand, 40, { characterSpacing: 3, lineBreak: false });
  d.font('Helvetica-Bold').fontSize(30).fillColor('#ffffff').text('Kurzanleitung', rand, 56, { lineBreak: false });
  d.font('Helvetica').fontSize(12).fillColor(FARBE.kopfLeise).text('für den Gastgeber', rand, 92, { lineBreak: false });
  d.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff')
    .text(event.name, rand + innen / 2, 60, { width: innen / 2, align: 'right', height: 34, ellipsis: true });
  d.font('Helvetica').fontSize(11).fillColor(FARBE.kopfLeise)
    .text(datum(event), rand + innen / 2, 92, { width: innen / 2, align: 'right', lineBreak: false });

  // PIN-Karte
  let y = 160;
  d.roundedRect(rand, y, innen, 96, 10).fillAndStroke(FARBE.akzentHell, FARBE.akzent);
  d.font('Helvetica-Bold').fontSize(10).fillColor(FARBE.leise)
    .text('DEINE BETREUER-PIN', rand + 22, y + 18, { characterSpacing: 1.5, lineBreak: false });
  d.font('Helvetica-Bold').fontSize(42).fillColor(FARBE.dunkel)
    .text(angaben.betreuerPin, rand + 22, y + 36, { characterSpacing: 10, lineBreak: false });
  const pinText = rand + 250;
  d.font('Helvetica').fontSize(10.5).fillColor(FARBE.text)
    .text('Damit öffnest du das Servicemenü: Papier wechseln, nachdrucken, Pause einlegen.', pinText, y + 20, {
      width: innen - (pinText - rand) - 20,
    });
  d.font('Helvetica-Oblique').fontSize(9.5).fillColor(FARBE.leise)
    .text('Bitte nicht an die Gäste weitergeben – der Zettel bleibt in der Box.', pinText, d.y + 6, {
      width: innen - (pinText - rand) - 20,
    });

  // Drei Schritte zum Servicemenue
  y = 282;
  ueberschrift(d, 'So öffnest du das Servicemenü', rand, y);
  y += 26;
  const schritte = [
    'Oben rechts am Bildschirm den kleinen Kreis eine Sekunde gedrückt halten.',
    'Die Betreuer-PIN eintippen.',
    'Die gewünschte Aktion antippen – fertig.',
  ];
  const abstand = 12;
  const kachel = (innen - 2 * abstand) / 3;
  schritte.forEach((text, i) => {
    const x = rand + i * (kachel + abstand);
    d.roundedRect(x, y, kachel, 86, 8).fill(FARBE.flaeche);
    d.circle(x + 24, y + 24, 12).fill(FARBE.akzent);
    d.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
      .text(String(i + 1), x + 12, y + 18, { width: 24, align: 'center', lineBreak: false });
    d.font('Helvetica').fontSize(10).fillColor(FARBE.text).text(text, x + 14, y + 44, { width: kachel - 28 });
  });

  // Karten in zwei Spalten
  y += 86 + 22;
  const spalte = (innen - 16) / 2;
  const reihe1 = [
    karte('Papier wechseln', [
      'Neue Rolle einlegen wie gewohnt.',
      'Im Servicemenü „Papier gewechselt“ antippen – wartende Fotos werden dann gedruckt.',
      '„Neue Rolle eingelegt“ zeigt gleich, wie viel Papier laut Drucker drauf ist.',
    ]),
    karte('Wenn etwas klemmt', [
      'Die Fotobox sagt auf dem Bildschirm in normalen Worten, was los ist.',
      'Kein Foto geht verloren – alles wird nachgeholt, sobald es weitergeht.',
      'Papier leer oder Drucker aus? Beheben, die Box druckt von selbst weiter.',
    ]),
  ];
  y = zeichneReihe(d, reihe1, rand, y, spalte, null);

  const reihe2 = [
    karte('Was du sonst noch kannst', [
      'Nachdruck: im Servicemenü „Galerie“, Foto antippen, nachdrucken.',
      'Pause: „Pause einlegen“ zeigt den Gästen einen freundlichen Hinweis – etwa während des Essens.',
    ]),
    galerieQr
      ? karte('Fotos aufs Handy', [
          'Die Gäste scannen den QR-Code am Startbildschirm oder auf dem Aushang.',
          angaben.wlanName
            ? `Das Handy muss dafür im WLAN „${angaben.wlanName}“ sein.`
            : 'Das Handy muss dafür im selben WLAN sein wie die Fotobox.',
        ])
      : karte('„Was ist los?“', [
          'Auf der PIN-Abfrage gibt es den Knopf „Was ist los?“ – er zeigt ohne PIN, was die Box gerade meldet.',
        ]),
  ];
  y = zeichneReihe(d, reihe2, rand, y + 14, spalte, galerieQr);

  // Notfall
  const notfallHoehe = 78;
  const notfallY = Math.max(y + 18, hoehe - 46 - notfallHoehe - 22);
  d.roundedRect(rand, notfallY, innen, notfallHoehe, 10).fill(FARBE.dunkel);
  d.font('Helvetica-Bold').fontSize(10).fillColor(FARBE.akzent)
    .text('WENN GAR NICHTS HILFT', rand + 20, notfallY + 16, { characterSpacing: 1.5, lineBreak: false });
  d.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff')
    .text(angaben.telefon || 'Nummer eintragen', rand + 20, notfallY + 34, { lineBreak: false });
  d.font('Helvetica').fontSize(9.5).fillColor(FARBE.kopfLeise)
    .text(
      'Bitte anrufen. Hilfreich ist ein Foto vom Bildschirm „Was ist los?“ – der Knopf steht auf der PIN-Abfrage und braucht keine PIN.',
      rand + innen / 2,
      notfallY + 18,
      { width: innen / 2 - 20 },
    );

  // Fusszeile - innerhalb der Seite, damit keine zweite entsteht.
  d.font('Helvetica').fontSize(8.5).fillColor(FARBE.leise)
    .text('Diesen Zettel bitte in der Box lassen – er enthält die PIN.', rand, hoehe - 36, {
      width: innen,
      align: 'center',
      lineBreak: false,
    });
}

/*
 * Der Aushang fuer die Gaeste - A4 hoch, im Stil der Kurzanleitung: dunkle
 * Kopfleiste, darunter je QR-Code eine grosse Karte mit Nummer und einem Satz.
 * Die Codes sind gut 6 cm gross, damit sie auch aus einem Meter Abstand und
 * bei schummrigem Licht scannen. Bewusst ohne PIN - den lesen die Gaeste.
 */
function zeichneAushang(
  d: PDFKit.PDFDocument,
  event: Veranstaltung,
  angaben: Unterlagenangaben,
  wlanQr: Buffer | null,
  galerieQr: Buffer | null,
): void {
  const [breite, hoehe] = A4;
  const rand = 46;
  const innen = breite - 2 * rand;

  // Kopf
  d.rect(0, 0, breite, 168).fill(FARBE.dunkel);
  d.rect(0, 168, breite, 4).fill(FARBE.akzent);
  d.font('Helvetica-Bold').fontSize(10).fillColor(FARBE.akzent)
    .text('FOTOBOX', rand, 42, { characterSpacing: 3, width: innen, align: 'center', lineBreak: false });
  d.font('Helvetica-Bold').fontSize(32).fillColor('#ffffff')
    .text('Eure Fotos aufs Handy', rand, 60, { width: innen, align: 'center', lineBreak: false });
  d.font('Helvetica').fontSize(13).fillColor(FARBE.kopfLeise)
    .text('Handykamera öffnen und auf den Code halten – fertig.', rand, 104, { width: innen, align: 'center', lineBreak: false });
  d.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
    .text(`${event.name} · ${datum(event)}`, rand, 132, { width: innen, align: 'center', height: 16, ellipsis: true });

  const codes: { titel: string; text: string; zusatz?: string; qr: Buffer }[] = [];
  if (wlanQr) {
    codes.push({
      titel: 'Ins WLAN',
      text: 'Verbindet das Handy mit dem WLAN der Fotobox.',
      zusatz: angaben.wlanName
        ? `WLAN: ${angaben.wlanName}${angaben.wlanPasswort ? `\nPasswort: ${angaben.wlanPasswort}` : ''}`
        : undefined,
      qr: wlanQr,
    });
  }
  if (galerieQr) {
    codes.push({
      titel: 'Galerie öffnen',
      text: 'Zeigt alle Fotos des Abends. Antippen, speichern, teilen.',
      zusatz: wlanQr ? 'Erst ins WLAN, dann diesen Code scannen.' : 'Das Handy muss im selben WLAN sein wie die Fotobox.',
      qr: galerieQr,
    });
  }

  // Je Code eine Karte, uebereinander - bei einem einzigen Code groesser.
  const qrGroesse = codes.length === 1 ? 230 : 180;
  const kartenHoehe = qrGroesse + 44;
  const lueckeY = 22;
  const gesamt = codes.length * kartenHoehe + (codes.length - 1) * lueckeY;
  let y = 172 + Math.max(36, (hoehe - 172 - 90 - gesamt) / 2);

  codes.forEach((c, i) => {
    d.roundedRect(rand, y, innen, kartenHoehe, 12).lineWidth(1).fillAndStroke('#ffffff', '#e1e4e9');
    d.rect(rand, y + 18, 4, kartenHoehe - 36).fill(FARBE.akzent);
    // QR links
    const qrX = rand + 22;
    d.image(c.qr, qrX, y + 22, { width: qrGroesse });
    // Text rechts
    const tx = qrX + qrGroesse + 28;
    const tb = innen - (tx - rand) - 22;
    const ty = y + kartenHoehe / 2 - 58;
    if (codes.length > 1) {
      d.circle(tx + 15, ty + 15, 15).fill(FARBE.akzent);
      d.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff')
        .text(String(i + 1), tx, ty + 7, { width: 30, align: 'center', lineBreak: false });
    }
    d.font('Helvetica-Bold').fontSize(22).fillColor(FARBE.text)
      .text(c.titel, tx, ty + (codes.length > 1 ? 42 : 20), { width: tb });
    d.font('Helvetica').fontSize(12).fillColor(FARBE.text).text(c.text, tx, d.y + 6, { width: tb });
    if (c.zusatz) {
      d.font('Helvetica-Bold').fontSize(11).fillColor(FARBE.leise).text(c.zusatz, tx, d.y + 8, { width: tb });
    }
    y += kartenHoehe + lueckeY;
  });

  // Fuss
  const fussY = hoehe - 46 - 40;
  d.roundedRect(rand, fussY, innen, 40, 10).fill(FARBE.flaeche);
  d.font('Helvetica').fontSize(10).fillColor(FARBE.leise)
    .text('Die Fotos bleiben im WLAN der Fotobox – nichts davon landet im Internet.', rand, fussY + 14, {
      width: innen,
      align: 'center',
      lineBreak: false,
    });
}

interface Karte {
  titel: string;
  punkte: string[];
}

function karte(titel: string, punkte: string[]): Karte {
  return { titel, punkte };
}

function ueberschrift(d: PDFKit.PDFDocument, text: string, x: number, y: number): void {
  d.font('Helvetica-Bold').fontSize(14).fillColor(FARBE.text).text(text, x, y, { lineBreak: false });
}

/** Zwei Karten nebeneinander, gleich hoch. Gibt die Unterkante zurueck. */
function zeichneReihe(
  d: PDFKit.PDFDocument,
  karten: Karte[],
  x: number,
  y: number,
  spalte: number,
  qrRechts: Buffer | null,
): number {
  const innenRand = 16;
  const qrGroesse = 70;
  const textBreite = (i: number) => spalte - 2 * innenRand - 10 - (qrRechts && i === 1 ? qrGroesse + 10 : 0);
  const hoeheVon = (k: Karte, i: number) => {
    d.font('Helvetica').fontSize(10);
    const punkte = k.punkte.reduce((summe, p) => summe + d.heightOfString(p, { width: textBreite(i) }) + 5, 0);
    return Math.max(innenRand + 22 + punkte + innenRand - 5, qrRechts && i === 1 ? innenRand + 22 + qrGroesse + innenRand : 0);
  };
  const hoehe = Math.max(...karten.map(hoeheVon));
  karten.forEach((k, i) => {
    const kx = x + i * (spalte + 16);
    d.roundedRect(kx, y, spalte, hoehe, 8).lineWidth(1).fillAndStroke('#ffffff', '#e1e4e9');
    d.rect(kx, y + 12, 3, 18).fill(FARBE.akzent);
    d.font('Helvetica-Bold').fontSize(12).fillColor(FARBE.text)
      .text(k.titel, kx + innenRand, y + 14, { width: spalte - 2 * innenRand, lineBreak: false });
    let py = y + innenRand + 22;
    for (const p of k.punkte) {
      d.circle(kx + innenRand + 2.5, py + 5, 2).fill(FARBE.akzent);
      d.font('Helvetica').fontSize(10).fillColor(FARBE.text).text(p, kx + innenRand + 10, py, { width: textBreite(i) });
      py = d.y + 5;
    }
    if (qrRechts && i === 1) {
      d.image(qrRechts, kx + spalte - innenRand - qrGroesse, y + innenRand + 20, { width: qrGroesse });
    }
  });
  return y + hoehe;
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

  await schreibe(pfad, (d) => zeichneAushang(d, event, angaben, wlanQr, galerieQr));

  return pfad;
}

function datum(event: Veranstaltung): string {
  return new Date(event.datum).toLocaleDateString('de-DE');
}

async function schreibe(
  pfad: string,
  inhalt: (d: PDFKit.PDFDocument) => void,
  groesse: [number, number] = A4,
  rand = 0,
): Promise<void> {
  await new Promise<void>((fertig, fehler) => {
    const d = new PDFDocument({ size: groesse, margin: rand, info: { Title: 'Fotobox' } });
    const strom = createWriteStream(pfad);
    strom.on('finish', () => fertig());
    strom.on('error', fehler);
    d.pipe(strom);
    inhalt(d);
    d.end();
  });
}
