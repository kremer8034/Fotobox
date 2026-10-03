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

describe('Foto am Ergebnis loeschen', () => {
  it('erlaubt es nur fuer das juengste Foto der Feier, und nur eine Viertelstunde lang', async () => {
    const { darfKioskLoeschen } = await import('../fach/sitzungen.js');
    const db = holeDb();
    db.prepare("INSERT INTO sitzungen (id, event_id, vorlage_id, gestartet, ist_test) VALUES ('s1', 'ev', 'v', '2026-10-03', 0)").run();
    db.prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES ('alt', 's1', '/a.jpg', '/a.pdf', '2026-10-03T18:00:00.000Z')").run();
    db.prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES ('neu', 's1', '/b.jpg', '/b.pdf', '2026-10-03T18:05:00.000Z')").run();
    const kurzDanach = Date.parse('2026-10-03T18:06:00.000Z');
    expect(darfKioskLoeschen('ev', 'neu', kurzDanach)).toBe(true);
    // Das Foto des Vorgaengers nicht - sonst liessen sich am Touchscreen fremde Fotos loeschen.
    expect(darfKioskLoeschen('ev', 'alt', kurzDanach)).toBe(false);
    expect(darfKioskLoeschen('ev', 'neu', Date.parse('2026-10-03T18:30:00.000Z'))).toBe(false);
    expect(darfKioskLoeschen('anderes', 'neu', kurzDanach)).toBe(false);
  });

  it('verwirft wartende Drucke, und "Papier gewechselt" holt sie nicht zurueck', async () => {
    const { verwirfAuftraegeVon, Druckschleife } = await import('../fach/druckwarteschlange.js');
    const { setzeVerborgen } = await import('../fach/sitzungen.js');
    const id = reiheEin({ eventId: 'ev', ausgabeId: 'neu', pfadPdf: '/b.pdf', kopien: 2, quelle: 'kiosk', berechnen: true });
    setzeVerborgen('neu', true);
    expect(verwirfAuftraegeVon('neu')).toBe(1);
    const status = () => holeDb().prepare('SELECT status, berechnen FROM druckauftraege WHERE id = ?').get(id);
    expect(status()).toEqual({ status: 'fehlgeschlagen', berechnen: 0 });
    new Druckschleife(() => ({}) as never, () => undefined).fortsetzen('ev');
    expect(status()).toEqual({ status: 'fehlgeschlagen', berechnen: 0 });
  });
});

describe('Foto per E-Mail am Kiosk', () => {
  it('Ergebnisseite: nur frisch - Galerie: jedes, das dort steht', async () => {
    const { darfKioskVerschicken, setzeVerborgen } = await import('../fach/sitzungen.js');
    const db = holeDb();
    db.prepare("INSERT INTO sitzungen (id, event_id, vorlage_id, gestartet, ist_test) VALUES ('m1', 'mail', 'v', '2026-10-03', 0)").run();
    db.prepare("INSERT INTO sitzungen (id, event_id, vorlage_id, gestartet, ist_test) VALUES ('m2', 'mail', 'v', '2026-10-03', 1)").run();
    db.prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES ('m-alt', 'm1', '/a.jpg', '/a.pdf', '2026-10-03T18:00:00.000Z')").run();
    db.prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES ('m-weg', 'm1', '/b.jpg', '/b.pdf', '2026-10-03T18:01:00.000Z')").run();
    db.prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES ('m-probe', 'm2', '/c.jpg', '/c.pdf', '2026-10-03T18:02:00.000Z')").run();
    setzeVerborgen('m-weg', true);
    const spaeter = Date.parse('2026-10-03T22:00:00.000Z');

    // Von der Ergebnisseite ist das Foto nach vier Stunden zu alt ...
    expect(darfKioskVerschicken('mail', 'm-alt', 'ergebnis', spaeter)).toBe(false);
    expect(darfKioskVerschicken('mail', 'm-alt', 'ergebnis', Date.parse('2026-10-03T18:05:00.000Z'))).toBe(true);
    // ... aus der Galerie geht es noch.
    expect(darfKioskVerschicken('mail', 'm-alt', 'galerie', spaeter)).toBe(true);
    // Nicht, was die Galerie nicht zeigt: herausgenommen, Probelauf, andere Feier.
    expect(darfKioskVerschicken('mail', 'm-weg', 'galerie', spaeter)).toBe(false);
    expect(darfKioskVerschicken('mail', 'm-probe', 'galerie', spaeter)).toBe(false);
    expect(darfKioskVerschicken('anderes', 'm-alt', 'galerie', spaeter)).toBe(false);
    expect(darfKioskVerschicken('mail', 'gibtsnicht', 'galerie', spaeter)).toBe(false);
  });
});
