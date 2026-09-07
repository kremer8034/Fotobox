import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Sucht die Hilfsprogramme an den ueblichen Stellen.
 *
 * Ohne das muesste man den Pfad zu SumatraPDF von Hand eintragen - eine
 * Fehlerquelle genau bei dem Nutzer, der sich am wenigsten damit auskennt.
 * Gefunden wird nur, was auch wirklich da ist; eingetragene Werte werden nie
 * ueberschrieben.
 */

const hier = dirname(fileURLToPath(import.meta.url));

/** Projektwurzel, egal ob aus dist/server/fach oder src/server/fach gestartet. */
function projektwurzel(): string {
  return resolve(hier, '..', '..', '..');
}

/** Die ueblichen Programmordner, soweit sie gesetzt sind. */
function programmordner(): string[] {
  return [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ].filter((o): o is string => Boolean(o));
}

function erstesVorhandenes(kandidaten: string[]): string | null {
  return kandidaten.find((pfad) => existsSync(pfad)) ?? null;
}

export function findeSumatra(): string | null {
  return erstesVorhandenes([
    // Mitgeliefert im windows-Ordner - der Weg aus der Anleitung.
    join(projektwurzel(), 'windows', 'SumatraPDF.exe'),
    join(projektwurzel(), 'SumatraPDF.exe'),
    ...programmordner().map((o) => join(o, 'SumatraPDF', 'SumatraPDF.exe')),
  ]);
}

export function findeDigiCamControl(): string | null {
  return erstesVorhandenes(
    programmordner().map((o) => join(o, 'digiCamControl', 'CameraControl.exe')),
  );
}
