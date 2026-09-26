import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { richteSchriftenEin } from './src/server/fach/schriften.js';

// Der Schriftenordner fuer den Schrift-Test - hier angelegt, bevor die
// Testprozesse starten: Unter Windows sieht fontconfig FONTCONFIG_PATH nur,
// wenn die Variable schon beim Start des Prozesses gesetzt war (siehe
// src/server/schriften-start.ts). Die Prozesse erben sie von hier.
const schriftDaten = mkdtempSync(join(tmpdir(), 'fb-schrift-'));
richteSchriftenEin(schriftDaten);
process.env.FOTOBOX_TEST_SCHRIFTDATEN = schriftDaten;

// Eigene Konfiguration, damit die Tests nicht die Vite-Einstellungen der
// Weboberflaeche erben (deren root auf src/web zeigt).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Der Windows-Rechner in GitHub Actions ist spuerbar langsamer als ein
    // Entwickler-PC; das Zusammensetzen der Testbilder brauchte dort ueber 10 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
