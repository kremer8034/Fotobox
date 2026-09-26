/**
 * Gibt den Abschnitt einer Version aus docs/Aenderungen.md aus - er wird der
 * Text des GitHub-Releases und damit das, was die Verwaltung beim Update
 * anzeigt.
 *
 *   node skripte/aenderungen.mjs 1.0.0 > hinweise.md
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('Aufruf: node skripte/aenderungen.mjs <version>');
  process.exit(1);
}
const text = readFileSync(resolve(import.meta.dirname, '..', 'docs', 'Aenderungen.md'), 'utf8').replace(/\r\n/g, '\n');
const zeilen = text.split('\n');
const anfang = zeilen.findIndex((z) => z.trim() === `## ${version}`);
if (anfang < 0) {
  console.error(`In docs/Aenderungen.md fehlt der Abschnitt "## ${version}".`);
  process.exit(1);
}
const ende = zeilen.findIndex((z, i) => i > anfang && z.startsWith('## '));
console.log(zeilen.slice(anfang + 1, ende < 0 ? undefined : ende).join('\n').trim());
