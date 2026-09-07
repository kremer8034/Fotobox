import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ordnerstruktur der Fotobox.
 *
 * Ein Event-Ordner ist vollstaendig und kann als Ganzes an den Gastgeber
 * uebergeben werden:
 *
 *   Fotobox-Daten/
 *     fotobox.db
 *     vorlagen/            Vorlagen-Definitionen und ihre Bilddateien
 *     luts/                eigene .cube-Dateien
 *     events/
 *       2026-05-16_Hochzeit-Mueller/
 *         event.json       Kopie der Konfiguration, macht den Ordner portabel
 *         01_originale/    unveraenderte Kameradateien
 *         02_bearbeitet/   Fotos mit angewendetem Filter
 *         03_layouts/      fertige Layouts, das ist der Galerie-Inhalt
 *         04_druck/        Druck-PDFs
 *         _probelauf/      Sitzungen aus dem Probelauf, zaehlen nirgends mit
 *         .cache/          Thumbnails und QR-Codes, nicht Teil der Uebergabe
 *         auslagen.csv
 *         galerie.html
 */

export interface Wurzelpfade {
  wurzel: string;
  db: string;
  vorlagen: string;
  luts: string;
  events: string;
}

export function wurzelpfade(datenpfad: string): Wurzelpfade {
  return {
    wurzel: datenpfad,
    db: join(datenpfad, 'fotobox.db'),
    vorlagen: join(datenpfad, 'vorlagen'),
    luts: join(datenpfad, 'luts'),
    events: join(datenpfad, 'events'),
  };
}

export interface Eventpfade {
  wurzel: string;
  originale: string;
  bearbeitet: string;
  layouts: string;
  druck: string;
  probelauf: string;
  cache: string;
  eventJson: string;
  auslagenCsv: string;
  galerieHtml: string;
}

export function eventpfade(eventOrdner: string, probelauf = false): Eventpfade {
  // Im Probelauf landet alles in einem eigenen Unterordner, damit die
  // Testbilder weder in der Galerie noch in der Abrechnung auftauchen.
  const basis = probelauf ? join(eventOrdner, '_probelauf') : eventOrdner;
  return {
    wurzel: eventOrdner,
    originale: join(basis, '01_originale'),
    bearbeitet: join(basis, '02_bearbeitet'),
    layouts: join(basis, '03_layouts'),
    druck: join(basis, '04_druck'),
    probelauf: join(eventOrdner, '_probelauf'),
    cache: join(eventOrdner, '.cache'),
    eventJson: join(eventOrdner, 'event.json'),
    auslagenCsv: join(eventOrdner, 'auslagen.csv'),
    galerieHtml: join(eventOrdner, 'galerie.html'),
  };
}

export function legeEventordnerAn(eventOrdner: string): void {
  const echt = eventpfade(eventOrdner, false);
  const test = eventpfade(eventOrdner, true);
  for (const pfad of [
    echt.originale,
    echt.bearbeitet,
    echt.layouts,
    echt.druck,
    echt.cache,
    test.originale,
    test.bearbeitet,
    test.layouts,
    test.druck,
  ]) {
    mkdirSync(pfad, { recursive: true });
  }
}

/** Aus Datum und Name einen dateisystemtauglichen Ordnernamen bauen. */
export function ordnernameFuer(datum: string, name: string): string {
  const sauber = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${datum}_${sauber || 'Veranstaltung'}`;
}
