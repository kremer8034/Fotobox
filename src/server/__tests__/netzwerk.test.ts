import { describe, expect, it } from 'vitest';
import { galerieUrl, lanAdresse } from '../netzwerk.js';

/**
 * Der QR-Code am Startbildschirm hat einmal auf http://127.0.0.1 gezeigt - auf
 * einem Handy ist das das Handy selbst. Dieser Test haelt fest, dass die
 * Galerie-Adresse nie eine Adresse ist, die nur auf der Box selbst gilt.
 */
describe('Galerie-Adresse fuer QR-Codes', () => {
  it('zeigt nie auf die Box selbst', () => {
    const url = galerieUrl('abc', 8787);
    if (url === null) {
      // Ohne Netzwerk keine Adresse - und damit kein QR-Code, der ins Leere fuehrt.
      expect(lanAdresse()).toBeNull();
      return;
    }
    expect(url).not.toMatch(/127\.0\.0\.1|localhost|::1/);
    expect(url).toMatch(/^http:\/\/[\d.]+:8787\/g\/abc$/);
  });
});
