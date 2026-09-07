import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findeSumatra } from '../fach/hilfsprogramme.js';

/**
 * Die Selbstsuche nimmt dem Nutzer den fehleranfaelligsten Handgriff der
 * Einrichtung ab: den Pfad zu SumatraPDF von Hand einzutippen.
 */
describe('Hilfsprogramme finden', () => {
  it('meldet nichts, wenn nichts da ist', () => {
    // Auf Linux existiert keiner der Windows-Pfade - genau das muss sauber
    // "nichts gefunden" ergeben statt zu werfen.
    const alt = process.env.ProgramFiles;
    const altLokal = process.env.LOCALAPPDATA;
    process.env.ProgramFiles = join(tmpdir(), 'gibtesnicht');
    process.env.LOCALAPPDATA = join(tmpdir(), 'gibtesauchnicht');
    try {
      expect(findeSumatra()).toBeNull();
    } finally {
      if (alt === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = alt;
      if (altLokal === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = altLokal;
    }
  });

  it('findet eine Datei im Programme-Ordner', () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'fotobox-progs-'));
    mkdirSync(join(wurzel, 'SumatraPDF'), { recursive: true });
    const datei = join(wurzel, 'SumatraPDF', 'SumatraPDF.exe');
    writeFileSync(datei, '');

    const alt = process.env.ProgramFiles;
    process.env.ProgramFiles = wurzel;
    try {
      expect(findeSumatra()).toBe(datei);
    } finally {
      if (alt === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = alt;
    }
  });
});
