import sharp from 'sharp';
import { basename, join } from 'node:path';
import {
  DRUCK_DPI,
  SCHRIFT_VORGABE,
  type BildEbene,
  type Ebene,
  type FotoEbene,
  type TextEbene,
  type Vorlage,
  fotoPlaetze,
} from '../../shared/typen.js';

/**
 * Setzt eine Vorlage mit den aufgenommenen Fotos zu einem fertigen Layout
 * zusammen.
 *
 * Die Ebenen werden in Reihenfolge des Arrays gerendert, erstes Element ganz
 * unten. Der Vorteil des freien Stapels: Ein Zierrahmen kann ueber einem Foto
 * und gleichzeitig unter dem Logo liegen - mit festen Rollen Hintergrund und
 * Overlay ginge das nicht.
 */

export interface LayoutQuellen {
  /** Gefilterte Fotos, Schluessel ist die Aufnahmenummer (1 = erstes Foto) - siehe fotoPlaetze(). */
  fotos: Map<number, Buffer>;
  /** Ordner mit den Bilddateien der Vorlage. */
  assetsOrdner: string;
  /** Werte fuer die Platzhalter in Textebenen. */
  platzhalter: Record<string, string>;
}

export interface LayoutMasse {
  breitePx: number;
  hoehePx: number;
}

/** Zielaufloesung aus dem Canvas: 300 dpi ergeben auf 4x6 Zoll exakt 1800x1200. */
export function layoutMasse(vorlage: Vorlage): LayoutMasse {
  const zoll = (mm: number) => mm / 25.4;
  return {
    breitePx: Math.round(zoll(vorlage.canvas.breiteMm) * DRUCK_DPI),
    hoehePx: Math.round(zoll(vorlage.canvas.hoeheMm) * DRUCK_DPI),
  };
}

export async function baueLayout(
  vorlage: Vorlage,
  quellen: LayoutQuellen,
  masse: LayoutMasse = layoutMasse(vorlage),
): Promise<Buffer> {
  const { breitePx, hoehePx } = masse;
  const grund = sharp({
    create: {
      width: breitePx,
      height: hoehePx,
      channels: 4,
      background: vorlage.hintergrundFarbe ?? '#ffffff',
    },
  });

  // Alle Ebenen gleichzeitig vorbereiten - die Stapelreihenfolge bleibt, weil
  // Promise.all die Ergebnisse in der Reihenfolge der Eingabe liefert.
  const plaetze = fotoPlaetze(vorlage);
  const auflagen = (
    await Promise.all(
      vorlage.ebenen
        .filter((ebene) => ebene.sichtbar !== false)
        .map((ebene) => rendereEbene(ebene, quellen, masse, plaetze)),
    )
  ).filter((auflage): auflage is sharp.OverlayOptions => auflage !== null);

  return grund.composite(auflagen).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function rendereEbene(
  ebene: Ebene,
  quellen: LayoutQuellen,
  masse: LayoutMasse,
  plaetze: Map<string, number>,
): Promise<sharp.OverlayOptions | null> {
  switch (ebene.typ) {
    case 'bild':
      return rendereBild(ebene, quellen, masse);
    case 'foto':
      return rendereFoto(ebene, quellen, masse, plaetze.get(ebene.id));
    case 'text':
      return rendereText(ebene, quellen, masse);
  }
}

/**
 * Eine fertige Ebene als Rohpixel samt Transparenz weiterreichen. Vorher ging
 * jede Ebene als PNG hinueber - bei einem Foto in Druckgroesse hiess das,
 * Millionen Pixel zu komprimieren, nur damit composite() sie gleich wieder
 * entpackt.
 *
 * Zwei Dinge passieren hier ausserdem, damit der Druck dem Editor entspricht:
 *
 *  - Gedreht wird um die Mitte der Ebene, wie im Editor. sharp vergroessert
 *    beim Drehen das Bild auf das umschliessende Rechteck; vorher wurde dieses
 *    an die alte linke obere Ecke gesetzt, und ein um 20 Grad gedrehtes Foto
 *    landete im Druck rund 9 mm tiefer als auf dem Bildschirm.
 *  - Was ueber die Seite hinausragt, wird abgeschnitten. Der Editor erlaubt das
 *    ausdruecklich - ein Hintergrund, der fuer den randlosen Druck ein Stueck
 *    uebersteht, ist Absicht. composite() lehnt solche Ebenen aber ab, und
 *    vorher scheiterte daran das Zusammensetzen jeder Sitzung.
 */
async function alsAuflage(
  bild: sharp.Sharp,
  kasten: { links: number; oben: number; breite: number; hoehe: number },
  masse: LayoutMasse,
): Promise<sharp.OverlayOptions | null> {
  const { data, info } = await bild.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const kanaele = info.channels;
  const links = Math.round(kasten.links + (kasten.breite - info.width) / 2);
  const oben = Math.round(kasten.oben + (kasten.hoehe - info.height) / 2);

  const x0 = Math.max(0, -links);
  const y0 = Math.max(0, -oben);
  const x1 = Math.min(info.width, masse.breitePx - links);
  const y1 = Math.min(info.height, masse.hoehePx - oben);
  if (x1 <= x0 || y1 <= y0) return null; // liegt ganz ausserhalb

  if (x0 === 0 && y0 === 0 && x1 === info.width && y1 === info.height) {
    return { input: data, raw: { width: info.width, height: info.height, channels: kanaele }, left: links, top: oben };
  }
  const teil = await sharp(data, { raw: { width: info.width, height: info.height, channels: kanaele } })
    .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
    .raw()
    .toBuffer();
  return {
    input: teil,
    raw: { width: x1 - x0, height: y1 - y0, channels: kanaele },
    left: links + x0,
    top: oben + y0,
  };
}

/** Normalisierte Koordinaten in Pixel umrechnen. */
function rechteck(ebene: Ebene, masse: LayoutMasse) {
  const breite = Math.max(1, Math.round(ebene.w * masse.breitePx));
  const hoehe = Math.max(1, Math.round(ebene.h * masse.hoehePx));
  const links = Math.round(ebene.x * masse.breitePx);
  const oben = Math.round(ebene.y * masse.hoehePx);
  return { breite, hoehe, links, oben };
}

async function rendereBild(
  ebene: BildEbene,
  quellen: LayoutQuellen,
  masse: LayoutMasse,
): Promise<sharp.OverlayOptions | null> {
  const { breite, hoehe, links, oben } = rechteck(ebene, masse);
  // Nur ein Dateiname, nie ein Pfad: Eine Vorlage darf keine Datei ausserhalb
  // ihres Ordners in den Druck holen.
  if (!ebene.datei || basename(ebene.datei) !== ebene.datei) return null;
  try {
    let bild = sharp(join(quellen.assetsOrdner, ebene.datei)).resize(breite, hoehe, {
      fit: 'fill',
    });
    if (ebene.deckkraft !== undefined && ebene.deckkraft < 1) {
      bild = bild.ensureAlpha(Math.max(0, Math.min(1, ebene.deckkraft)));
    }
    if (ebene.rotation) bild = bild.rotate(ebene.rotation, { background: '#00000000' });
    return await alsAuflage(bild, { links, oben, breite, hoehe }, masse);
  } catch {
    // Eine fehlende Bilddatei darf nicht die ganze Sitzung sprengen. Der
    // Startbereit-Check meldet so etwas vorher.
    return null;
  }
}

async function rendereFoto(
  ebene: FotoEbene,
  quellen: LayoutQuellen,
  masse: LayoutMasse,
  platz: number | undefined,
): Promise<sharp.OverlayOptions | null> {
  const foto = platz === undefined ? undefined : quellen.fotos.get(platz);
  if (!foto) return null;
  const { breite, hoehe, links, oben } = rechteck(ebene, masse);

  let bild = sharp(foto).resize(breite, hoehe, {
    fit: ebene.einpassung === 'contain' ? 'contain' : 'cover',
    position: 'centre',
    background: '#00000000',
  });

  if (ebene.radius && ebene.radius > 0) {
    const radiusPx = Math.round(ebene.radius * Math.min(masse.breitePx, masse.hoehePx));
    const maske = Buffer.from(
      `<svg width="${breite}" height="${hoehe}"><rect x="0" y="0" width="${breite}" height="${hoehe}" rx="${radiusPx}" ry="${radiusPx}" fill="#fff"/></svg>`,
    );
    const { data, info } = await bild.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    bild = sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    }).composite([{ input: maske, blend: 'dest-in' }]);
  }

  if (ebene.rotation) bild = bild.rotate(ebene.rotation, { background: '#00000000' });
  return alsAuflage(bild, { links, oben, breite, hoehe }, masse);
}

async function rendereText(
  ebene: TextEbene,
  quellen: LayoutQuellen,
  masse: LayoutMasse,
): Promise<sharp.OverlayOptions | null> {
  const text = ersetzePlatzhalter(ebene.text, quellen.platzhalter);
  if (!text.trim()) return null;

  const { breite, hoehe, links, oben } = rechteck(ebene, masse);
  const schriftPx = Math.max(8, Math.round(ebene.groesse * masse.hoehePx));
  const anker =
    ebene.ausrichtung === 'links' ? 'start' : ebene.ausrichtung === 'rechts' ? 'end' : 'middle';
  const xPos = anker === 'start' ? 0 : anker === 'end' ? breite : breite / 2;

  const zeilen = text.split('\n');
  const zeilenAbstand = schriftPx * 1.2;
  const startY = (hoehe - (zeilen.length - 1) * zeilenAbstand) / 2 + schriftPx * 0.35;

  const tspans = zeilen
    .map(
      (zeile, i) =>
        `<tspan x="${xPos}" y="${startY + i * zeilenAbstand}">${maskiereXml(zeile)}</tspan>`,
    )
    .join('');

  // Die Schrift der Ebene, sonst die Vorgabe. Eine selbst hinzugefuegte Schrift
  // steht hier mit ihrem Familiennamen; gefunden wird sie ueber fontconfig,
  // dem der Schriftenordner beim Start bekannt gemacht wurde.
  const schrift = ebene.schrift?.trim() || SCHRIFT_VORGABE;

  const svg = `<svg width="${breite}" height="${hoehe}" xmlns="http://www.w3.org/2000/svg">
    <text font-family="${maskiereXml(schrift)}" font-size="${schriftPx}"
          fill="${maskiereXml(ebene.farbe)}" text-anchor="${anker}">${tspans}</text>
  </svg>`;

  let bild = sharp(Buffer.from(svg));
  if (ebene.rotation) bild = bild.rotate(ebene.rotation, { background: '#00000000' });
  return alsAuflage(bild, { links, oben, breite, hoehe }, masse);
}

/**
 * Platzhalter in Textebenen. Damit funktioniert dieselbe Vorlage bei jeder
 * Feier, ohne dass vorher Name und Datum von Hand geaendert werden muessen.
 */
export function ersetzePlatzhalter(text: string, werte: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (treffer, name: string) => werte[name] ?? treffer);
}

function maskiereXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
