import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Die Versionsnummer der laufenden Software - aus package.json, der einen
 * Stelle, an der sie gepflegt wird.
 *
 * Im Build liegt diese Datei unter dist/server, im Entwicklungsbetrieb unter
 * src/server; in beiden Faellen ist package.json zwei Ebenen hoeher. Das
 * Installationspaket legt package.json deshalb neben dist/.
 */
const hier = dirname(fileURLToPath(import.meta.url));

function lese(): string {
  try {
    const paket = JSON.parse(readFileSync(resolve(hier, '..', '..', 'package.json'), 'utf8')) as { version?: string };
    return paket.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION = lese();
