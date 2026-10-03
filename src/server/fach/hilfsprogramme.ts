import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sucht die Hilfsprogramme an den ueblichen Stellen.
 *
 * Ohne das muesste man den Pfad zu digiCamControl von Hand eintragen - eine
 * Fehlerquelle genau bei dem Nutzer, der sich am wenigsten damit auskennt.
 * Gefunden wird nur, was auch wirklich da ist; eingetragene Werte werden nie
 * ueberschrieben.
 */

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

export function findeDigiCamControl(): string | null {
  return erstesVorhandenes(
    programmordner().map((o) => join(o, 'digiCamControl', 'CameraControl.exe')),
  );
}
