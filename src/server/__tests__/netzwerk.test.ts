import { describe, expect, it } from 'vitest';
import { galerieBlockiert, galerieUrl, lanAdresse } from '../netzwerk.js';
import { deuteDialogAntwort, waehleOrdner } from '../fach/ordnerdialog.js';

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

describe('Galerie hinter der Windows-Firewall', () => {
  const basis = { netz: 'Fotobox-WLAN', adapter: 'WLAN', regel: true };

  it('erkennt: oeffentliches Netz, Freigabe nur privat - die Handys kommen nicht durch', () => {
    const text = galerieBlockiert({ ...basis, kategorie: 'Public', regelProfile: 'Private' });
    expect(text).toMatch(/öffentlich/);
    expect(text).toMatch(/Fotobox-WLAN/);
  });

  it('laesst durch, wenn die Freigabe fuer alle Profile gilt oder das Netz privat ist', () => {
    expect(galerieBlockiert({ ...basis, kategorie: 'Public', regelProfile: 'Any' })).toBeNull();
    expect(galerieBlockiert({ ...basis, kategorie: 'Private', regelProfile: 'Private' })).toBeNull();
  });

  it('meldet eine fehlende Freigabe', () => {
    expect(galerieBlockiert({ ...basis, regel: false, kategorie: 'Private', regelProfile: null })).toMatch(/fehlt/);
  });
});

describe('Ordnerdialog von Windows', () => {
  it('liest den gewaehlten Pfad - auch einen in OneDrive', () => {
    expect(deuteDialogAntwort('PFAD:C:\\Users\\Kremer\\OneDrive\\Fotobox\r\n')).toBe('C:\\Users\\Kremer\\OneDrive\\Fotobox');
    expect(deuteDialogAntwort('ABGEBROCHEN\r\n')).toBeNull();
    expect(() => deuteDialogAntwort('Kauderwelsch')).toThrow(/Unerwartete Antwort/);
  });

  it('meldet ausserhalb von Windows verstaendlich, dass es ihn nur auf der Box gibt', async () => {
    if (process.platform === 'win32') return;
    await expect(waehleOrdner('Test')).rejects.toThrow(/nur auf der Fotobox/);
  });
});
