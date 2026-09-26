import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { gastKopienVon, reiheEin } from '../fach/druckwarteschlange.js';

/**
 * "Maximale Kopien" gilt je Foto. Gezaehlt wird, was Gaeste am Ergebnis und
 * ueber die Galerie angestossen haben - nicht die Nachdrucke des Betreuers.
 */
beforeAll(() => {
  oeffneDb(join(mkdtempSync(join(tmpdir(), 'fotobox-nachdruck-')), 'fotobox.db'));
  holeDb().pragma('foreign_keys = OFF');
});
afterAll(() => schliesseDb());

describe('Nachdrucke je Foto', () => {
  it('zaehlt Ergebnis und Galerie zusammen, den Betreuer nicht', () => {
    const auftrag = (quelle: 'kiosk' | 'galerie' | 'servicemenue', kopien: number, ausgabeId = 'foto1') =>
      reiheEin({ eventId: 'e', ausgabeId, pfadPdf: '/x.pdf', kopien, quelle, berechnen: true });
    expect(gastKopienVon('foto1')).toBe(0);
    auftrag('kiosk', 2);
    auftrag('galerie', 1);
    auftrag('servicemenue', 5);
    auftrag('galerie', 3, 'anderes');
    expect(gastKopienVon('foto1')).toBe(3);
    expect(gastKopienVon('anderes')).toBe(3);
  });
});
