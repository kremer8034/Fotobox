import { defineConfig } from 'vitest/config';

// Eigene Konfiguration, damit die Tests nicht die Vite-Einstellungen der
// Weboberflaeche erben (deren root auf src/web zeigt).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
