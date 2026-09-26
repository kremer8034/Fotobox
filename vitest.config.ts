import { defineConfig } from 'vitest/config';

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
