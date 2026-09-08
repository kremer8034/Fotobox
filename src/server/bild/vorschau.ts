import sharp from 'sharp';
import { fotoEbenen, type FilterPreset, type Vorlage } from '../../shared/typen.js';
import { baueLayout, layoutMasse } from './layout.js';
import { wendeFilterAn } from './filter.js';

/**
 * Vorschaubilder fuer die Gaesteauswahl.
 *
 * Vorlagen- und Filterauswahl liefen bisher ueber blosse Namen. "Hochzeit 3er"
 * oder "Vintage" sagt einem Gast, der zum ersten Mal vor der Box steht, genau
 * nichts - er tippt auf gut Glueck und sieht erst hinterher, was er gewaehlt
 * hat. Deshalb bekommt jede Kachel ein Bild.
 *
 * Beide Vorschauen rechnen bewusst klein: Die Vorlage in 640 px langer Kante
 * statt der 1800 des Drucks, der Filter auf einem 320-px-Muster. Damit ist eine
 * Kachel in wenigen Millisekunden fertig, und der N100 kommt nicht ins
 * Schwitzen, wenn acht Vorlagen gleichzeitig geladen werden.
 */

const VORLAGE_LANGE_KANTE = 640;
const FILTER_KANTE = 320;

/** Gerechnete Vorschauen, damit dieselbe Kachel nicht bei jedem Antippen neu entsteht. */
const zwischenlager = new Map<string, Buffer>();

export function leereVorschauLager(): void {
  zwischenlager.clear();
}

/**
 * Die Vorlage mit nummerierten Platzhaltern statt echter Fotos - also genau
 * das, was der Gast gleich in der Hand haelt, nur ohne seine Gesichter.
 */
export async function vorlagenVorschau(vorlage: Vorlage, assetsOrdner: string): Promise<Buffer> {
  const schluessel = `vorlage:${vorlage.id}:${vorlage.geaendert}`;
  const vorhanden = zwischenlager.get(schluessel);
  if (vorhanden) return vorhanden;

  const voll = layoutMasse(vorlage);
  const faktor = VORLAGE_LANGE_KANTE / Math.max(voll.breitePx, voll.hoehePx);
  const masse = {
    breitePx: Math.round(voll.breitePx * faktor),
    hoehePx: Math.round(voll.hoehePx * faktor),
  };

  const fotos = new Map<number, Buffer>();
  for (const ebene of fotoEbenen(vorlage)) {
    fotos.set(ebene.index, await platzhalterFlaeche(ebene.index));
  }

  const bild = await baueLayout(
    vorlage,
    {
      fotos,
      assetsOrdner,
      // In der Vorschau stehen Beispielwerte: Die echten kommen erst beim
      // Zusammensetzen der Sitzung dazu.
      platzhalter: {
        veranstaltung: 'Beispielfeier',
        datum: new Date().toLocaleDateString('de-DE'),
        uhrzeit: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        nummer: '1',
      },
    },
    masse,
  );

  zwischenlager.set(schluessel, bild);
  return bild;
}

/**
 * Das Filtermuster: ein Bild, an dem man den Filter tatsaechlich beurteilen
 * kann. Ein nummeriertes Farbfeld taugt dafuer nicht - Schwarzweiss und Sepia
 * sehen darauf fast gleich aus. Also Hauttoene, Himmel, Gruen und ein
 * Grauverlauf nebeneinander: Genau daran sieht man, ob ein Filter waermer
 * wird, Farbe wegnimmt oder den Kontrast anzieht.
 */
export async function filterVorschau(
  preset: FilterPreset,
  lutOrdner: string,
  eigenesFoto?: string | null,
): Promise<Buffer> {
  // Mit dem eigenen Foto wird gar nicht zwischengelagert: Es gilt nur fuer
  // diese eine Sitzung, und fuenf kleine Filterlaeufe kosten zusammen weniger
  // als der Speicher, den ein Lager je Sitzung braeuchte.
  const quelle = eigenesFoto ? await miniatur(eigenesFoto) : null;
  if (quelle) {
    return wendeFilterAn(quelle, preset, { lutOrdner });
  }

  const schluessel = `filter:${preset.id}`;
  const vorhanden = zwischenlager.get(schluessel);
  if (vorhanden) return vorhanden;

  const bild = await wendeFilterAn(await musterFoto(), preset, { lutOrdner });
  zwischenlager.set(schluessel, bild);
  return bild;
}

/**
 * Das eigene Foto auf Kachelgroesse. Quadratisch beschnitten, weil die Kachel
 * quadratisch ist - und klein, damit der Filter in Millisekunden rechnet statt
 * auf achtzehn Megapixeln.
 */
async function miniatur(pfad: string): Promise<Buffer | null> {
  try {
    return await sharp(pfad)
      .resize(FILTER_KANTE, FILTER_KANTE, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    // Datei noch nicht fertig geschrieben oder Format unbekannt: Dann eben das
    // allgemeine Muster - eine Vorschau ist besser als eine leere Kachel.
    return null;
  }
}

/** Ruhige, nummerierte Flaeche fuer die Foto-Ebenen der Vorlagenvorschau. */
async function platzhalterFlaeche(nummer: number): Promise<Buffer> {
  const farben = ['#8fa6bd', '#bd8f8f', '#95bd8f', '#bdb08f', '#a98fbd', '#8fbdb6'];
  const farbe = farben[(nummer - 1) % farben.length] ?? '#9aa0a6';
  const svg = `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="400" fill="${farbe}"/>
    <text x="300" y="200" font-family="DejaVu Sans, sans-serif" font-size="180"
          fill="#ffffff" text-anchor="middle" dominant-baseline="central"
          opacity="0.8">${nummer}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function musterFoto(): Promise<Buffer> {
  const k = FILTER_KANTE;
  const svg = `<svg width="${k}" height="${k}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="himmel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7fb4dd"/>
        <stop offset="100%" stop-color="#cfe4f2"/>
      </linearGradient>
      <linearGradient id="grau" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#111111"/>
        <stop offset="50%" stop-color="#8a8a8a"/>
        <stop offset="100%" stop-color="#f2f2f2"/>
      </linearGradient>
    </defs>
    <rect width="${k}" height="${k}" fill="url(#himmel)"/>
    <rect y="${k * 0.62}" width="${k}" height="${k * 0.24}" fill="#6f9e5c"/>
    <circle cx="${k * 0.38}" cy="${k * 0.44}" r="${k * 0.19}" fill="#e0ab86"/>
    <circle cx="${k * 0.66}" cy="${k * 0.5}" r="${k * 0.14}" fill="#a5714c"/>
    <rect x="${k * 0.06}" y="${k * 0.08}" width="${k * 0.16}" height="${k * 0.16}" fill="#c8433c"/>
    <rect x="${k * 0.78}" y="${k * 0.08}" width="${k * 0.16}" height="${k * 0.16}" fill="#e8c53a"/>
    <rect y="${k * 0.86}" width="${k}" height="${k * 0.14}" fill="url(#grau)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}
