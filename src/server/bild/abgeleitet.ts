import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * Abgeleitete Bilder - Miniaturen und bereinigte Vollbilder - einmal rechnen
 * und aufheben.
 *
 * Vorher wurde jedes Galeriebild bei jedem Abruf neu dekodiert, verkleinert
 * und kodiert. Ein fertiges Layout aendert sich aber nie; dasselbe Ergebnis
 * hundertfach zu rechnen, kostete auf dem N100 genau die Zeit, in der die Box
 * das Layout fuer den naechsten Gast bauen soll. Jetzt liegt jede Fassung nach
 * dem ersten Abruf in .cache/ - dem Ordner, der bei der Uebergabe an den
 * Gastgeber ausgelassen wird.
 *
 * Die Bilder entstehen weiter durch sharp ohne withMetadata(), tragen also
 * keine EXIF-Daten. Die Garantie der oeffentlichen Galerie bleibt damit
 * dieselbe - nur wird sie einmal statt bei jedem Abruf eingeloest.
 */

export interface Fassung {
  /** Teil des Dateinamens, etwa "k480" - unterscheidet die Fassungen. */
  name: string;
  /** Lange Kante in Pixeln; ohne Angabe bleibt die Groesse. */
  kante?: number;
  qualitaet: number;
}

export const FASSUNGEN = {
  kioskKlein: { name: 'k480', kante: 480, qualitaet: 78 },
  handyKlein: { name: 'h600', kante: 600, qualitaet: 80 },
  handyVoll: { name: 'voll', qualitaet: 95 },
} satisfies Record<string, Fassung>;

/** Laufende Berechnungen: Zwanzig gleichzeitige Abrufe rechnen einmal, nicht zwanzigmal. */
const inArbeit = new Map<string, Promise<string>>();

/**
 * Pfad der fertigen Fassung - bei Bedarf wird sie erst erzeugt.
 *
 * @param kennung eindeutig je Quellbild, etwa die Ausgabe-ID. Kommt aus der
 *   Datenbank, nie aus der URL.
 */
export async function abgeleitet(
  quelle: string,
  cacheOrdner: string,
  kennung: string,
  fassung: Fassung,
): Promise<string> {
  const ziel = join(cacheOrdner, 'bilder', `${kennung}_${fassung.name}.jpg`);

  const laufend = inArbeit.get(ziel);
  if (laufend) return laufend;

  // Die Arbeit wird eingetragen, BEVOR irgendetwas wartet. Stand die Pruefung
  // auf eine vorhandene Datei davor, liefen zwanzig gleichzeitige Abrufe alle
  // an der Liste vorbei, solange der erste noch auf die Platte wartete - und
  // schrieben dieselbe Zwischendatei. Der Test dazu hat es gezeigt.
  const arbeit = (async () => {
    if (await aktuell(ziel, quelle)) return ziel;
    await mkdir(join(cacheOrdner, 'bilder'), { recursive: true });
    let bild = sharp(quelle).rotate();
    if (fassung.kante) bild = bild.resize(fassung.kante, fassung.kante, { fit: 'inside' });
    // Erst unter anderem Namen schreiben, dann umbenennen: Ein Abruf waehrend
    // des Schreibens bekommt nie eine halbe Datei.
    const zwischen = `${ziel}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await bild.jpeg({ quality: fassung.qualitaet }).toFile(zwischen);
    await rename(zwischen, ziel);
    return ziel;
  })();

  inArbeit.set(ziel, arbeit);
  try {
    return await arbeit;
  } finally {
    inArbeit.delete(ziel);
  }
}

async function aktuell(ziel: string, quelle: string): Promise<boolean> {
  try {
    const [z, q] = await Promise.all([stat(ziel), stat(quelle)]);
    return z.mtimeMs >= q.mtimeMs;
  } catch {
    return false;
  }
}
