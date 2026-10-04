import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Veranstaltung } from '../../shared/typen.js';

const fuehreAus = promisify(execFile);

/**
 * Uebergabe des Event-Ordners an den Gastgeber.
 *
 * Nach dem Vorbild von Move2USB wird erst nach verifizierter Kopie Vollzug
 * gemeldet: Eine Markerdatei muss auf dem Ziel ankommen, und die Zahl der
 * Dateien muss stimmen. Sonst hat man am Ende einen Stick, auf dem die Haelfte
 * fehlt - und merkt es erst zu Hause.
 */

export interface Uebergabeergebnis {
  ziel: string;
  dateien: number;
  bytes: number;
  geprueft: boolean;
  meldung: string;
}

/**
 * Der Gastgeber bekommt nur die Fotos: 01_originale, 02_bearbeitet und
 * 03_layouts - dazu 05_gaestebuch, wenn Gaeste etwas geschrieben haben (die
 * Verwaltung erzeugt das Gaestebuch-PDF vorher frisch). Nicht mit gehen der Zwischenspeicher, der Probelauf (Testfotos
 * vom Aufbau), die Druckdateien (nur die Layouts als PDF - jedes Bild doppelt)
 * und die Unterlagen der Box: event.json und auslagen.csv bleiben fuer die
 * eigene Abrechnung auf der Box; eine galerie.html aus aelteren Versionen
 * ebenso. Vom Gast geloeschte Fotos gibt es gar nicht mehr; vom Betreuer aus
 * der Galerie genommene gehen bewusst mit.
 */
const AUSGELASSENE_ORDNER = ['.cache', '_probelauf', '04_druck'];
const AUSGELASSENE_DATEIEN = ['event.json', 'auslagen.csv', 'galerie.html'];

function ausgelassen(name: string, istOrdner: boolean): boolean {
  return istOrdner ? AUSGELASSENE_ORDNER.includes(name) : AUSGELASSENE_DATEIEN.includes(name);
}

export async function uebergebeAufDatentraeger(
  event: Veranstaltung,
  zielWurzel: string,
): Promise<Uebergabeergebnis> {
  const quelle = event.ordner;
  const ziel = join(zielWurzel, basename(quelle));
  await mkdir(ziel, { recursive: true });

  // Markerdatei vor dem Kopieren anlegen; sie muss nachher drueben auftauchen.
  const marker = `kopie_${randomUUID()}.chk`;
  const markerInhalt = new Date().toISOString();
  await writeFile(join(quelle, marker), markerInhalt, 'utf8');

  try {
    await kopiereOrdner(quelle, ziel);

    const markerZiel = join(ziel, marker);
    const markerAngekommen =
      existsSync(markerZiel) && (await readFile(markerZiel, 'utf8')) === markerInhalt;

    const quelleDateien = await zaehleDateien(quelle);
    const zielDateien = await zaehleDateien(ziel);
    const geprueft = markerAngekommen && zielDateien.anzahl >= quelleDateien.anzahl;

    return {
      ziel,
      dateien: zielDateien.anzahl,
      bytes: zielDateien.bytes,
      geprueft,
      meldung: geprueft
        ? `${zielDateien.anzahl} Dateien uebertragen und geprueft.`
        : 'Die Kopie ist unvollstaendig. Bitte den Datentraeger pruefen und erneut versuchen.',
    };
  } finally {
    // Marker auf beiden Seiten wieder aufraeumen.
    await unlink(join(quelle, marker)).catch(() => undefined);
    await unlink(join(ziel, marker)).catch(() => undefined);
  }
}

/** Unter Windows uebernimmt robocopy, sonst wird von Hand kopiert. */
async function kopiereOrdner(quelle: string, ziel: string): Promise<void> {
  if (process.platform === 'win32') {
    try {
      // /E alle Unterordner, /XD Ordner und /XF Dateien auslassen, /R:2 zwei Wiederholungen.
      await fuehreAus(
        'robocopy',
        [
          quelle,
          ziel,
          '/E',
          '/XD',
          ...AUSGELASSENE_ORDNER,
          '/XF',
          ...AUSGELASSENE_DATEIEN,
          '/R:2',
          '/W:2',
          '/NFL',
          '/NDL',
          '/NJH',
          '/NJS',
        ],
        { timeout: 30 * 60_000, windowsHide: true },
      );
    } catch (fehler) {
      // robocopy meldet Erfolg mit Rueckgabewerten unter 8. Das laesst execFile
      // als Fehler durchgehen, obwohl alles gut ging.
      const code = (fehler as { code?: number }).code ?? 16;
      if (code >= 8) throw new Error(`robocopy meldet einen Fehler (Code ${code}).`);
    }
    return;
  }
  await kopiereRekursiv(quelle, ziel);
}

async function kopiereRekursiv(quelle: string, ziel: string): Promise<void> {
  await mkdir(ziel, { recursive: true });
  for (const eintrag of await readdir(quelle, { withFileTypes: true })) {
    if (ausgelassen(eintrag.name, eintrag.isDirectory())) continue;
    const von = join(quelle, eintrag.name);
    const nach = join(ziel, eintrag.name);
    if (eintrag.isDirectory()) await kopiereRekursiv(von, nach);
    else await copyFile(von, nach);
  }
}

/** Zaehlt, was uebergeben werden soll - mit denselben Auslassungen wie die Kopie. */
async function zaehleDateien(ordner: string): Promise<{ anzahl: number; bytes: number }> {
  let anzahl = 0;
  let bytes = 0;
  const gehe = async (pfad: string): Promise<void> => {
    for (const eintrag of await readdir(pfad, { withFileTypes: true })) {
      if (ausgelassen(eintrag.name, eintrag.isDirectory())) continue;
      const voll = join(pfad, eintrag.name);
      if (eintrag.isDirectory()) await gehe(voll);
      else {
        anzahl += 1;
        bytes += (await stat(voll)).size;
      }
    }
  };
  await gehe(ordner);
  return { anzahl, bytes };
}

/** Nur zur Sicherheit: Pruefsumme einer Datei, falls einmal genauer verglichen werden soll. */
export async function pruefsumme(pfad: string): Promise<string> {
  return createHash('sha256').update(await readFile(pfad)).digest('hex');
}
