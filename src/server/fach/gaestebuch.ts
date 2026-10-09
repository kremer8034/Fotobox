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
export async function erzeugeGaestebuchPdf(event: Veranstaltung): Promise<{ pfad: string; anzahl: number } | null> {
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
  return { pfad, anzahl: pdf.anzahl };
}

/** Laufende Erzeugungen je Veranstaltung: Wer gleichzeitig fragt, bekommt dasselbe Ergebnis. */
const inArbeit = new Map<string, Promise<{ daten: Buffer; anzahl: number } | null>>();

/**
 * Das Gaestebuch als PDF im Speicher: ein Deckblatt, danach je Seite zwei
 * Eintraege - links das Foto, rechts der Gruss. Querformat A4, damit es sich
 * auch ausdrucken und abheften laesst.
 */
export function baueGaestebuchPdf(event: Veranstaltung): Promise<{ daten: Buffer; anzahl: number } | null> {
  const laufend = inArbeit.get(event.id);
  if (laufend) return laufend;
  const neu = baue(event).finally(() => inArbeit.delete(event.id));
  inArbeit.set(event.id, neu);
  return neu;
}

async function baue(event: Veranstaltung): Promise<{ daten: Buffer; anzahl: number } | null> {
  const gruesse = gruesseVon(event.id).filter((g) => existsSync(g.pfad));
  if (gruesse.length === 0) return null;
  const layouts = eventpfade(event.ordner).layouts + sep;

  const d = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, autoFirstPage: false });
  d.info.Title = `Gästebuch – ${event.name}`;
  const teile: Buffer[] = [];
  d.on('data', (teil: Buffer) => teile.push(teil));
  const fertig = new Promise<void>((ok, fehler) => {
    d.on('end', ok);
    d.on('error', fehler);
  });

  const skript = join(MITGELIEFERT, 'GreatVibes-Regular.ttf');
  const hatSkript = existsSync(skript);
  if (hatSkript) d.registerFont('Skript', skript);

  const B = 841.89;
  const H = 595.28;

  // Deckblatt
  d.addPage();
  papier(d, B, H);
  d.font(hatSkript ? 'Skript' : 'Helvetica-Oblique')
    .fontSize(hatSkript ? 96 : 60)
    .fillColor(FARBE.gold)
    .text('Gästebuch', 0, 170, { width: B, align: 'center' });
  d.font('Helvetica-Bold').fontSize(26).fillColor(FARBE.text).text(event.name, 60, 320, { width: B - 120, align: 'center' });
  d.font('Helvetica').fontSize(14).fillColor(FARBE.leise)
    .text(`${datum(event.datum)} · ${gruesse.length} ${gruesse.length === 1 ? 'Gruß' : 'Grüße'}`, 0, 362, {
      width: B,
      align: 'center',
    });

  // Eintraege, zwei je Seite
  const rand = 40;
  const luecke = 28;
  const breite = (B - 2 * rand - luecke) / 2;
  const hoehe = breite / 1.5;
  const zeilen = [rand + 4, rand + 4 + hoehe + 34];
  for (let i = 0; i < gruesse.length; i++) {
    const g = gruesse[i]!;
    if (i % 2 === 0) {
      d.addPage();
      papier(d, B, H);
    }
    const y = zeilen[i % 2]!;

    // Das Foto - verkleinert, sonst wiegt das PDF so viel wie alle Layouts zusammen.
    if (g.pfadLayout.startsWith(layouts) && existsSync(g.pfadLayout)) {
      const foto = await sharp(g.pfadLayout).rotate().resize({ width: 1400, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      d.save().rect(rand - 4, y - 4, breite + 8, hoehe + 8).fill('#ffffff').restore();
      d.image(foto, rand, y, { fit: [breite, hoehe], align: 'center', valign: 'center' });
    }

    // Der Gruss auf einer weissen Karte
    const x = rand + breite + luecke;
    d.save().roundedRect(x, y - 4, breite, hoehe + 8, 8).fillAndStroke('#ffffff', '#e4d9c6').restore();
    d.image(g.pfad, x + 8, y + 4, { fit: [breite - 16, hoehe - 8], align: 'center', valign: 'center' });

    d.font('Helvetica').fontSize(9).fillColor(FARBE.leise).text(`${uhrzeit(g.erstellt)} Uhr`, x, y + hoehe + 10, {
      width: breite,
      align: 'right',
    });
  }

  d.end();
  await fertig;
  return { daten: Buffer.concat(teile), anzahl: gruesse.length };
}

const FARBE = { papier: '#faf6ee', gold: '#b8862f', text: '#2b2620', leise: '#8a8174' };

function papier(d: PDFKit.PDFDocument, b: number, h: number): void {
  d.save().rect(0, 0, b, h).fill(FARBE.papier).restore();
}

function datum(iso: string): string {
  const [j, m, t] = iso.split('-');
  return j && m && t ? `${t}.${m}.${j}` : iso;
}

function uhrzeit(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function dateiZeit(iso: string): string {
  const d = new Date(iso);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
}
