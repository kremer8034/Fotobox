import sharp from 'sharp';
import { join } from 'node:path';
import {
  DRUCK_DPI,
  SCHRIFT_VORGABE,
  type BildEbene,
  type Ebene,
  type FotoEbene,
  type TextEbene,
  type Vorlage,
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
  /** Gefilterte Fotos, Schluessel ist der 1-basierte Index der Foto-Ebene. */
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

  const auflagen: sharp.OverlayOptions[] = [];
  for (const ebene of vorlage.ebenen) {
    if (ebene.sichtbar === false) continue;
    const auflage = await rendereEbene(ebene, quellen, masse);
    if (auflage) auflagen.push(auflage);
  }

  return grund.composite(auflagen).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function rendereEbene(
  ebene: Ebene,
  quellen: LayoutQuellen,
  masse: LayoutMasse,
): Promise<sharp.OverlayOptions | null> {
  switch (ebene.typ) {
    case 'bild':
      return rendereBild(ebene, quellen, masse);
    case 'foto':
      return rendereFoto(ebene, quellen, masse);
    case 'text':
      return rendereText(ebene, quellen, masse);
  }
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
  try {
    let bild = sharp(join(quellen.assetsOrdner, ebene.datei)).resize(breite, hoehe, {
      fit: 'fill',
    });
    if (ebene.deckkraft !== undefined && ebene.deckkraft < 1) {
      bild = bild.ensureAlpha(Math.max(0, Math.min(1, ebene.deckkraft)));
    }
    if (ebene.rotation) bild = bild.rotate(ebene.rotation, { background: '#00000000' });
    return { input: await bild.png().toBuffer(), left: links, top: oben };
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
): Promise<sharp.OverlayOptions | null> {
  const foto = quellen.fotos.get(ebene.index);
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
    bild = sharp(await bild.png().toBuffer()).composite([{ input: maske, blend: 'dest-in' }]);
  }

  if (ebene.rotation) bild = bild.rotate(ebene.rotation, { background: '#00000000' });
  return { input: await bild.png().toBuffer(), left: links, top: oben };
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
  return { input: await bild.png().toBuffer(), left: links, top: oben };
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
