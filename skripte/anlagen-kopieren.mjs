import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

/**
 * Kopiert alles aus src/server, was kein TypeScript ist, in den Build.
 *
 * TypeScript uebersetzt nur .ts-Dateien. Ohne diesen Schritt fehlt im Build
 * die schema.sql, und der gebaute Server stuerzt beim ersten Start ab - was
 * im Entwicklungsmodus mit tsx nie auffaellt, weil dort die Quelldateien
 * nebeneinanderliegen.
 */

const QUELLE = 'src/server';
const ZIEL = 'dist/server';
const UEBERSPRINGEN = /\.(ts|tsx|map)$/;

async function sammle(ordner) {
  const gefunden = [];
  for (const eintrag of await readdir(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) {
      if (eintrag.name === '__tests__') continue;
      gefunden.push(...(await sammle(pfad)));
    } else if (!UEBERSPRINGEN.test(eintrag.name)) {
      gefunden.push(pfad);
    }
  }
  return gefunden;
}

const dateien = await sammle(QUELLE);
for (const datei of dateien) {
  const ziel = join(ZIEL, relative(QUELLE, datei));
  await mkdir(dirname(ziel), { recursive: true });
  await cp(datei, ziel);
}

console.log(
  dateien.length === 0
    ? 'Keine Anlagen zu kopieren.'
    : `${dateien.length} Anlage(n) in den Build kopiert: ${dateien.map((d) => relative(QUELLE, d)).join(', ')}`,
);
