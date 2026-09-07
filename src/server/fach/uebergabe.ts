import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { galerieEintraege } from './sitzungen.js';
import { eventpfade } from './pfade.js';
import { schreibeAuslagenCsv } from './auslagen.js';
import { schreibeEventJson } from './events.js';
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

export async function bereiteUebergabeVor(event: Veranstaltung): Promise<void> {
  schreibeEventJson(event);
  await schreibeAuslagenCsv(event);
  await schreibeGalerieHtml(event);
}

export async function uebergebeAufDatentraeger(
  event: Veranstaltung,
  zielWurzel: string,
): Promise<Uebergabeergebnis> {
  await bereiteUebergabeVor(event);

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
      // /E alle Unterordner, /XD .cache auslassen, /R:2 zwei Wiederholungen.
      await fuehreAus(
        'robocopy',
        [quelle, ziel, '/E', '/XD', '.cache', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS'],
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
    if (eintrag.name === '.cache') continue;
    const von = join(quelle, eintrag.name);
    const nach = join(ziel, eintrag.name);
    if (eintrag.isDirectory()) await kopiereRekursiv(von, nach);
    else await copyFile(von, nach);
  }
}

async function zaehleDateien(ordner: string): Promise<{ anzahl: number; bytes: number }> {
  let anzahl = 0;
  let bytes = 0;
  const gehe = async (pfad: string): Promise<void> => {
    for (const eintrag of await readdir(pfad, { withFileTypes: true })) {
      if (eintrag.name === '.cache') continue;
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

/**
 * Eigenstaendige Galerie im Event-Ordner. Der Gastgeber oeffnet sie per
 * Doppelklick, ohne irgendetwas zu installieren - kein Server, kein Internet.
 */
export async function schreibeGalerieHtml(event: Veranstaltung): Promise<string> {
  const pfade = eventpfade(event.ordner);
  const bilder = galerieEintraege(event.id).map((e) => relative(event.ordner, e.pfadLayout).replace(/\\/g, '/'));

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${maskiere(event.name)}</title>
<style>
  body { margin:0; font-family: 'Segoe UI', system-ui, sans-serif; background:#14161a; color:#f4f5f7; }
  header { padding:1.5rem 1.5rem 0.5rem; }
  h1 { margin:0; font-size:1.6rem; }
  p.leise { color:#a8adb8; margin:0.3rem 0 0; }
  .raster { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; padding:1.5rem; }
  .raster a { display:block; }
  .raster img { width:100%; border-radius:8px; display:block; background:#000; }
  footer { padding:0 1.5rem 2rem; color:#a8adb8; font-size:0.85rem; }
</style>
</head>
<body>
<header>
  <h1>${maskiere(event.name)}</h1>
  <p class="leise">${maskiere(new Date(event.datum).toLocaleDateString('de-DE'))} · ${bilder.length} Bilder</p>
</header>
<div class="raster">
${bilder.map((b) => `  <a href="${b}" target="_blank"><img src="${b}" alt="" loading="lazy"></a>`).join('\n')}
</div>
<footer>
  Alle Bilder liegen im Ordner <code>03_layouts</code>. Die Einzelaufnahmen findest du unter
  <code>01_originale</code>, die bearbeiteten Fassungen unter <code>02_bearbeitet</code>.
</footer>
</body>
</html>
`;
  await writeFile(pfade.galerieHtml, html, 'utf8');
  return pfade.galerieHtml;
}

function maskiere(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Nur zur Sicherheit: Pruefsumme einer Datei, falls einmal genauer verglichen werden soll. */
export async function pruefsumme(pfad: string): Promise<string> {
  return createHash('sha256').update(await readFile(pfad)).digest('hex');
}
