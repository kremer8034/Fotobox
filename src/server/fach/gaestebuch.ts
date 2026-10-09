import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { holeDb, jetzt } from '../db/index.js';
import { eventpfade } from './pfade.js';
import { MITGELIEFERT } from './schriften.js';
import type { Veranstaltung } from '../../shared/typen.js';

/**
 * Das Gaestebuch: Nach dem Foto schreiben Gaeste mit dem Finger einen Gruss.
 *
 * Bewusst getrennt vom Ausdruck - der Gruss kommt nicht aufs Foto, das schon
 * aus dem Drucker kommt, sondern ins Gaestebuch fuer den Gastgeber: ein PDF mit
 * jedem Foto und dem Gruss daneben, dazu die einzelnen Bilder. Gezeigt wird er
 * sonst nirgends - nicht in der Galerie, nicht in der Diashow. Wer einem
 * Brautpaar etwas Persoenliches schreibt, schreibt nicht fuer den ganzen Saal.
 */

/** So gross darf ein Gruss hoechstens sein - die Schreibflaeche liefert weit weniger. */
const MAX_KANTE = 4000;
const PDF_NAME = 'Gaestebuch.pdf';

export interface Gruss {
  id: string;
  ausgabeId: string;
  pfad: string;
  pfadLayout: string;
  erstellt: string;
}

interface Zeile {
  id: string;
  ausgabe_id: string;
  pfad: string;
  pfad_layout: string;
  erstellt: string;
}

/**
 * Speichert den Gruss zu einem Foto. Schreibt ein Gast ein zweites Mal, ersetzt
 * der neue Gruss den alten - es gibt einen je Foto.
 *
 * Das Bild kommt vom Kiosk; es wird trotzdem geprueft und neu kodiert, statt
 * die Bytes ungesehen abzulegen.
 */
export async function speichereGruss(
  event: Veranstaltung,
  ausgabe: { id: string; istTest: boolean },
  png: Buffer,
): Promise<Gruss> {
  let daten: Buffer;
  try {
    const bild = sharp(png, { limitInputPixels: MAX_KANTE * MAX_KANTE });
    const info = await bild.metadata();
    if (info.format !== 'png' || !info.width || !info.height || info.width > MAX_KANTE || info.height > MAX_KANTE) {
      throw new Error('Kein gueltiges Bild.');
    }
    daten = await bild.png({ compressionLevel: 9 }).toBuffer();
  } catch {
    throw new UngueltigerGruss();
  }

  const ordner = eventpfade(event.ordner, ausgabe.istTest).gaestebuch;
  await mkdir(ordner, { recursive: true });
  // Lesbarer Name fuer den Gastgeber: wann, und zu welchem Foto.
  const zeit = jetzt();
  const pfad = join(ordner, `Gruss_${dateiZeit(zeit)}_${ausgabe.id.slice(0, 8)}.png`);
  await writeFile(pfad, daten);

  const db = holeDb();
  const alt = db.prepare('SELECT pfad FROM gaestebuch WHERE ausgabe_id = ?').get(ausgabe.id) as
    | { pfad: string }
    | undefined;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO gaestebuch (id, event_id, ausgabe_id, pfad, ist_test, erstellt) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ausgabe_id) DO UPDATE SET id = excluded.id, pfad = excluded.pfad, erstellt = excluded.erstellt`,
  ).run(id, event.id, ausgabe.id, pfad, ausgabe.istTest ? 1 : 0, zeit);
  if (alt && alt.pfad !== pfad) await unlink(alt.pfad).catch(() => undefined);

  const zeile = holeDb()
    .prepare('SELECT a.pfad_layout FROM ausgaben a WHERE a.id = ?')
    .get(ausgabe.id) as { pfad_layout: string };
  return { id, ausgabeId: ausgabe.id, pfad, pfadLayout: zeile.pfad_layout, erstellt: zeit };
}

export class UngueltigerGruss extends Error {
  constructor() {
    super('Der Gruß ließ sich nicht lesen.');
  }
}

/** Die Gruesse einer Veranstaltung in der Reihenfolge, in der sie geschrieben wurden - ohne Probelauf. */
export function gruesseVon(eventId: string): Gruss[] {
  const zeilen = holeDb()
    .prepare(
      `SELECT g.id, g.ausgabe_id, g.pfad, a.pfad_layout, g.erstellt
         FROM gaestebuch g JOIN ausgaben a ON a.id = g.ausgabe_id
        WHERE g.event_id = ? AND g.ist_test = 0
        ORDER BY g.erstellt ASC`,
    )
    .all(eventId) as Zeile[];
  return zeilen.map((z) => ({
    id: z.id,
    ausgabeId: z.ausgabe_id,
    pfad: z.pfad,
    pfadLayout: z.pfad_layout,
    erstellt: z.erstellt,
  }));
}

/**
 * Die Fotos einer Veranstaltung ohne Gruss - fuer den Anhang "Momente des
 * Abends". Dieselbe Auswahl wie die Galerie: kein Probelauf, nichts, was der
 * Betreuer herausgenommen hat. In der Reihenfolge der Aufnahme.
 */
export function fotosOhneGruss(eventId: string): { ausgabeId: string; pfadLayout: string; erstellt: string }[] {
  return (
    holeDb()
      .prepare(
        `SELECT a.id, a.pfad_layout, a.erstellt
           FROM ausgaben a JOIN sitzungen s ON s.id = a.sitzung_id
          WHERE s.event_id = ? AND s.ist_test = 0 AND a.verborgen = 0
            AND NOT EXISTS (SELECT 1 FROM gaestebuch g WHERE g.ausgabe_id = a.id AND g.ist_test = 0)
          ORDER BY a.erstellt ASC`,
      )
      .all(eventId) as { id: string; pfad_layout: string; erstellt: string }[]
  ).map((z) => ({ ausgabeId: z.id, pfadLayout: z.pfad_layout, erstellt: z.erstellt }));
}

/** Gibt es zu diesem Foto schon einen Gruss? */
export function hatGruss(ausgabeId: string): boolean {
  return holeDb().prepare('SELECT 1 FROM gaestebuch WHERE ausgabe_id = ?').get(ausgabeId) !== undefined;
}

/**
 * Die Dateien der Gruesse zu einem Foto - fuer das endgueltige Loeschen am
 * Ergebnis. Die Zeilen verschwinden mit dem Foto (ON DELETE CASCADE), die
 * Dateien muss der Aufrufer loeschen.
 */
export function grussDateienVon(ausgabeId: string): string[] {
  return (
    holeDb().prepare('SELECT pfad FROM gaestebuch WHERE ausgabe_id = ?').all(ausgabeId) as { pfad: string }[]
  ).map((z) => z.pfad);
}

/**
 * Das Gaestebuch als PDF in 05_gaestebuch - fuer die Uebergabe.
 *
 * Erst in eine Zwischendatei, dann umbenannt: Laufen "Gaestebuch ansehen" und
 * die Uebergabe zugleich, schrieben sonst zwei Erzeugungen in dieselbe Datei,
 * und auf dem Stick laege ein kaputtes PDF.
 *
 * @returns null, wenn es (noch) keinen Gruss gibt
 */
export async function erzeugeGaestebuchPdf(
  event: Veranstaltung,
): Promise<{ pfad: string; anzahl: number; fotos: number } | null> {
  const pdf = await baueGaestebuchPdf(event);
  if (!pdf) return null;
  const ordner = eventpfade(event.ordner).gaestebuch;
  await mkdir(ordner, { recursive: true });
  const pfad = join(ordner, PDF_NAME);
  const zwischen = join(ordner, `.${PDF_NAME}.${randomUUID()}.tmp`);
  await writeFile(zwischen, pdf.daten);
  try {
    await rename(zwischen, pfad);
  } catch {
    // Windows verweigert das Umbenennen, solange jemand die alte Datei offen
    // hat - dann eben direkt hineinschreiben.
    await unlink(zwischen).catch(() => undefined);
    await writeFile(pfad, pdf.daten);
  }
  return { pfad, anzahl: pdf.anzahl, fotos: pdf.fotos };
}

/** Laufende Erzeugungen je Veranstaltung: Wer gleichzeitig fragt, bekommt dasselbe Ergebnis. */
const inArbeit = new Map<string, Promise<GaestebuchPdf | null>>();

interface GaestebuchPdf {
  daten: Buffer;
  /** Zahl der Gruesse. */
  anzahl: number;
  /** Zahl der Fotos ohne Gruss im Anhang. */
  fotos: number;
}

/**
 * Das Gaestebuch als PDF im Speicher: ein Deckblatt, danach je Seite zwei
 * Eintraege - Foto und Gruss nebeneinander -, am Ende alle Fotos ohne Gruss,
 * sechs je Seite. Querformat A4, damit es sich auch ausdrucken und binden
 * laesst.
 *
 * Es entsteht immer, auch wenn die Gaeste keine Gruesse schreiben konnten:
 * Dann ist es die Erinnerung an die Feier in Albumform, die der Gastgeber
 * bei der Uebergabe bekommt.
 *
 * @returns null, wenn es noch kein Foto gibt
 */
export function baueGaestebuchPdf(event: Veranstaltung): Promise<GaestebuchPdf | null> {
  const laufend = inArbeit.get(event.id);
  if (laufend) return laufend;
  const neu = baue(event).finally(() => inArbeit.delete(event.id));
  inArbeit.set(event.id, neu);
  return neu;
}

async function baue(event: Veranstaltung): Promise<GaestebuchPdf | null> {
  const gruesse = gruesseVon(event.id).filter((g) => existsSync(g.pfad));
  const layouts = eventpfade(event.ordner).layouts + sep;
  // Nur Layouts, die dort liegen, wo Layouts hingehoeren - der Pfad kommt aus
  // der Datenbank, nicht von aussen, aber sicher ist sicher.
  const vorhanden = (pfad: string) => pfad.startsWith(layouts) && existsSync(pfad);
  const ohneGruss = fotosOhneGruss(event.id).filter((f) => vorhanden(f.pfadLayout));
  if (gruesse.length === 0 && ohneGruss.length === 0) return null;

  const d = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false });
  d.info.Title = `Gästebuch – ${event.name}`;
  const teile: Buffer[] = [];
  d.on('data', (teil: Buffer) => teile.push(teil));
  const fertig = new Promise<void>((ok, fehler) => {
    d.on('end', ok);
    d.on('error', fehler);
  });

  const skript = join(MITGELIEFERT, 'GreatVibes-Regular.ttf');
  const schrift = existsSync(skript) ? 'Skript' : 'Helvetica-Oblique';
  if (schrift === 'Skript') d.registerFont('Skript', skript);

  // Das fertige Layout, verkleinert - sonst wiegt das PDF so viel wie alle
  // Layouts zusammen. Im Anhang sind die Fotos kleiner, also auch die Dateien.
  // null, wenn es fehlt.
  const foto = async (pfad: string, kante = 1200): Promise<Foto | null> => {
    if (!vorhanden(pfad)) return null;
    try {
      const { data, info } = await sharp(pfad)
        .rotate()
        .resize({ width: kante, height: kante, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      return { daten: data, breite: info.width, hoehe: info.height };
    } catch {
      return null;
    }
  };

  // ---- Deckblatt -------------------------------------------------------
  d.addPage();
  seite(d);
  d.font(schrift).fontSize(schrift === 'Skript' ? 92 : 56).fillColor(FARBE.gold)
    .text('Gästebuch', 0, 62, { width: B, align: 'center' });
  schnoerkel(d, B / 2, 182, 150);
  // Der Name in derselben Schreibschrift wie der Titel - ohne Datum und
  // Zahl der Gruesse: Das Deckblatt ist eine Erinnerung, keine Statistik.
  d.font(schrift).fontSize(schrift === 'Skript' ? 44 : 28).fillColor(FARBE.text)
    .text(event.name, BUND + 30, 196, { width: B - 2 * BUND - 60, align: 'center' });
  // Ein Faecher aus den ersten Fotos - wie auf den Tisch gelegt.
  const titelPfade = [...gruesse.map((g) => g.pfadLayout), ...ohneGruss.map((f) => f.pfadLayout)].slice(0, 3);
  const titelFotos = (await Promise.all(titelPfade.map((p) => foto(p)))).filter((f): f is Foto => f !== null);
  const faecher = titelFotos.length === 1 ? [0] : titelFotos.length === 2 ? [-6, 6] : [-9, 0, 9];
  titelFotos.forEach((bild, i) => {
    const winkel = faecher[i]!;
    const mitte = B / 2 + winkel * 17;
    sofortbild(d, bild, mitte, 412, 215, 240, winkel);
  });

  // ---- Eintraege, zwei je Seite ----------------------------------------
  let seitenNr = 1;
  const neueSeite = (titel: string, groesse = 22) => {
    d.addPage();
    seitenNr += 1;
    seite(d);
    d.font(schrift).fontSize(groesse).fillColor(FARBE.gold).text(titel, 0, KOPF + 10, { width: B, align: 'center' });
    d.font('Helvetica').fontSize(9).fillColor(FARBE.gold).text(`·  ${seitenNr}  ·`, 0, H - KOPF - 22, { width: B, align: 'center' });
  };
  const innenLinks = BUND + 22;
  const innenRechts = B - BUND - 22;

  const zeilen = gruesse.length;
  for (let i = 0; i < zeilen; i++) {
    const g = gruesse[i]!;
    const oben = i % 2 === 0;
    if (oben) neueSeite(event.name);
    // Allein auf der letzten Seite: in die Mitte statt nach oben.
    const allein = oben && i === zeilen - 1;
    const mitteY = allein ? H / 2 : oben ? 182 : 404;
    // Foto und Gruss wechseln die Seite - wie in einem Album, in das
    // nacheinander eingeklebt wurde. Alles bleibt innerhalb des Rahmens und
    // damit ausserhalb des Bindungsrands.
    const fotoLinks = i % 2 === 0;
    const fotoX = fotoLinks ? innenLinks + FOTO_BREITE / 2 + 8 : innenRechts - FOTO_BREITE / 2 - 8;
    const kartenX = fotoLinks ? innenRechts - KARTE_BREITE / 2 - 8 : innenLinks + KARTE_BREITE / 2 + 8;

    const bild = await foto(g.pfadLayout);
    // Ein Hochformat-Layout ist schmaler - das Herz sitzt trotzdem mittig
    // zwischen Foto und Karte.
    const halb = (bild ? sofortbild(d, bild, fotoX, mitteY, FOTO_BREITE, FOTO_HOEHE, fotoLinks ? -2.5 : 2.5) : FOTO_BREITE) / 2;
    briefkarte(d, g.pfad, kartenX, mitteY, KARTE_BREITE, KARTE_HOEHE, fotoLinks ? 1.5 : -1.5);
    const luecke = fotoLinks
      ? (fotoX + halb + kartenX - KARTE_BREITE / 2) / 2
      : (kartenX + KARTE_BREITE / 2 + fotoX - halb) / 2;
    herz(d, luecke, mitteY - 4, 9);
  }

  // ---- Momente des Abends: alle Fotos ohne Gruss, sechs je Seite --------
  // Dichter als die Grussseiten - bei 300 Fotos sind das 50 Seiten statt 150,
  // und die Gruesse bleiben vorne beisammen.
  for (let start = 0; start < ohneGruss.length; start += ANHANG_JE_SEITE) {
    if (start === 0) neueSeite('Momente des Abends', 30);
    else neueSeite(event.name);
    const stapel = ohneGruss.slice(start, start + ANHANG_JE_SEITE);
    // Die sechs Bilder einer Seite zugleich verkleinern - bei ein paar hundert
    // Fotos wartet die Uebergabe sonst unnoetig lange.
    const bilder = await Promise.all(stapel.map((f) => foto(f.pfadLayout, 900)));
    // Bis drei Fotos: eine Reihe in der Mitte, sonst zwei Reihen zu je drei.
    const reihen = stapel.length <= 3 ? [stapel.length] : [3, stapel.length - 3];
    const reiheY = reihen.length === 1 ? [H / 2 + 10] : [ANHANG_OBEN, ANHANG_UNTEN];
    const spalte = (innenRechts - innenLinks) / 3;
    let n = 0;
    for (const [r, anzahlInReihe] of reihen.entries()) {
      const links = (innenLinks + innenRechts) / 2 - (anzahlInReihe * spalte) / 2;
      for (let k = 0; k < anzahlInReihe; k++, n++) {
        const bild = bilder[n];
        if (!bild) continue;
        // Wie von Hand eingeklebt: jedes etwas anders gedreht und versetzt.
        const j = (start + n) % ANHANG_WINKEL.length;
        sofortbild(
          d,
          bild,
          links + spalte * (k + 0.5) + ANHANG_VERSATZ[j]!,
          reiheY[r]! + ANHANG_VERSATZ[(j + 2) % ANHANG_VERSATZ.length]! / 2,
          ANHANG_BREITE,
          ANHANG_HOEHE,
          ANHANG_WINKEL[j]!,
        );
      }
    }
  }

  d.end();
  await fertig;
  return { daten: Buffer.concat(teile), anzahl: gruesse.length, fotos: ohneGruss.length };
}

/*
 * DIN A4 quer (297 x 210 mm) - druckt jeder Drucker und jeder Copyshop.
 *
 * Das Gaestebuch wird ausgedruckt und gebunden: Ringbuch-Lochung, Spirale
 * oder Klebebindung brauchen am Rand Platz. Links UND rechts deshalb je 20 mm
 * Bindungsrand - beim beidseitigen Druck liegt die Bindung der Rueckseite auf
 * der anderen Seite. Rahmen und Inhalt bleiben innerhalb; nur der Papierton
 * laeuft bis an die Kante.
 */
const B = 841.89;
const H = 595.28;
const MM = 72 / 25.4;
/** Bindungsrand links und rechts. */
const BUND = 20 * MM;
/** Rand oben und unten. */
const KOPF = 10 * MM;
const FOTO_BREITE = 270;
const FOTO_HOEHE = 205;
/** Anhang: sechs Fotos je Seite in zwei Reihen. */
const ANHANG_JE_SEITE = 6;
const ANHANG_BREITE = 196;
const ANHANG_HOEHE = 200;
const ANHANG_OBEN = 196;
const ANHANG_UNTEN = 420;
const ANHANG_WINKEL = [-3, 2, -1.5, 2.5, -2, 1.5, 3, -2.5];
const ANHANG_VERSATZ = [-5, 3, -2, 4, -3, 2, 5, -4];
const KARTE_BREITE = 310;
const KARTE_HOEHE = 190;
const FARBE = {
  papierHell: '#fffaf1',
  papierRand: '#f1e6d2',
  gold: '#b8862f',
  goldHell: '#d9b86a',
  text: '#2b2620',
  band: '#e8d6a2',
};

/** Eine Albumseite: warmes Papier, feiner goldener Doppelrahmen mit Eckverzierungen. */
function seite(d: PDFKit.PDFDocument): void {
  const grund = d.radialGradient(B / 2, H / 2, 60, B / 2, H / 2, B * 0.62);
  grund.stop(0, FARBE.papierHell).stop(1, FARBE.papierRand);
  d.rect(0, 0, B, H).fill(grund);

  d.save().lineWidth(1.1).strokeColor(FARBE.gold).rect(BUND, KOPF, B - 2 * BUND, H - 2 * KOPF).stroke().restore();
  d.save().lineWidth(0.5).strokeColor(FARBE.goldHell).rect(BUND + 6, KOPF + 6, B - 2 * BUND - 12, H - 2 * KOPF - 12).stroke().restore();
  for (const [x, y, sx, sy] of [
    [BUND + 6, KOPF + 6, 1, 1],
    [B - BUND - 6, KOPF + 6, -1, 1],
    [BUND + 6, H - KOPF - 6, 1, -1],
    [B - BUND - 6, H - KOPF - 6, -1, -1],
  ] as const) {
    d.save().translate(x, y).scale(sx, sy);
    d.lineWidth(0.9).strokeColor(FARBE.gold);
    d.moveTo(6, 46).bezierCurveTo(6, 22, 22, 6, 46, 6).stroke();
    d.moveTo(14, 30).bezierCurveTo(14, 20, 20, 14, 30, 14).stroke();
    d.circle(14, 14, 2.6).fill(FARBE.gold);
    d.restore();
  }
}

/** Eine geschwungene Linie mit Herz in der Mitte - unter dem Titel. */
function schnoerkel(d: PDFKit.PDFDocument, x: number, y: number, breite: number): void {
  d.save().lineWidth(0.9).strokeColor(FARBE.gold);
  d.moveTo(x - breite, y).bezierCurveTo(x - breite * 0.6, y - 8, x - breite * 0.3, y + 8, x - 16, y).stroke();
  d.moveTo(x + breite, y).bezierCurveTo(x + breite * 0.6, y - 8, x + breite * 0.3, y + 8, x + 16, y).stroke();
  d.restore();
  herz(d, x, y, 7);
}

function herz(d: PDFKit.PDFDocument, x: number, y: number, r: number): void {
  d.save()
    .translate(x, y)
    .moveTo(0, r * 0.9)
    .bezierCurveTo(-r * 1.6, -r * 0.1, -r * 0.7, -r * 1.3, 0, -r * 0.4)
    .bezierCurveTo(r * 0.7, -r * 1.3, r * 1.6, -r * 0.1, 0, r * 0.9)
    .fill(FARBE.gold)
    .restore();
}

interface Foto {
  daten: Buffer;
  breite: number;
  hoehe: number;
}

/**
 * Ein Foto wie ein eingeklebtes Sofortbild: weisser Rand, weicher Schatten,
 * leicht schraeg. Der Rahmen folgt dem Layout - quer oder hoch - und passt in
 * maxBreite x maxHoehe.
 *
 * @returns die Breite des Rahmens
 */
function sofortbild(
  d: PDFKit.PDFDocument,
  bild: Foto,
  mx: number,
  my: number,
  maxBreite: number,
  maxHoehe: number,
  winkel: number,
): number {
  const rand = 9;
  const unten = 14;
  const verhaeltnis = bild.breite / bild.hoehe;
  let bildB = maxBreite - 2 * rand;
  let bildH = bildB / verhaeltnis;
  if (bildH > maxHoehe - 2 * rand - unten) {
    bildH = maxHoehe - 2 * rand - unten;
    bildB = bildH * verhaeltnis;
  }
  const breite = bildB + 2 * rand;
  const hoehe = bildH + 2 * rand + unten;
  const x = mx - breite / 2;
  const y = my - hoehe / 2;
  d.save().rotate(winkel, { origin: [mx, my] });
  for (const [versatz, deckung] of [
    [6, 0.05],
    [4, 0.07],
    [2, 0.09],
  ] as const) {
    d.save().fillOpacity(deckung).rect(x + versatz, y + versatz + 2, breite, hoehe).fill('#3a2a10').restore();
  }
  d.rect(x, y, breite, hoehe).fill('#ffffff');
  d.image(bild.daten, x + rand, y + rand, { width: bildB, height: bildH });
  klebeband(d, mx - 18, y - 5, -6);
  d.restore();
  return breite;
}

/** Der Gruss auf einer Briefkarte mit zwei Klebestreifen. */
function briefkarte(
  d: PDFKit.PDFDocument,
  pfad: string,
  mx: number,
  my: number,
  breite: number,
  hoehe: number,
  winkel: number,
): void {
  const x = mx - breite / 2;
  const y = my - hoehe / 2;
  d.save().rotate(winkel, { origin: [mx, my] });
  d.save().fillOpacity(0.07).rect(x + 4, y + 5, breite, hoehe).fill('#3a2a10').restore();
  // Bewusst ohne Linien: Mit dem Finger trifft niemand eine Zeile genau,
  // und schraeg ueber Linien geschrieben sieht der Gruss krumm aus.
  d.rect(x, y, breite, hoehe).fill('#fffdf7');
  d.image(pfad, x + 6, y + 6, { fit: [breite - 12, hoehe - 12], align: 'center', valign: 'center' });
  klebeband(d, x - 6, y - 4, -35);
  klebeband(d, x + breite - 34, y - 4, 35);
  d.restore();
}

function klebeband(d: PDFKit.PDFDocument, x: number, y: number, winkel: number): void {
  d.save()
    .rotate(winkel, { origin: [x + 20, y + 7] })
    .fillOpacity(0.72)
    .rect(x, y, 40, 14)
    .fill(FARBE.band)
    .restore();
}

function dateiZeit(iso: string): string {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}
