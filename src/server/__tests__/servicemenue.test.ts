import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { erstelleEvent } from '../fach/events.js';
import { Druckschleife, reiheEin, stelleFremdeZurueck } from '../fach/druckwarteschlange.js';
import { MockDrucker } from '../treiber/drucker-mock.js';
import { wurzelpfade } from '../fach/pfade.js';

/**
 * "Papier gewechselt" und der Start einer neuen Veranstaltung duerfen keine
 * Fotos einer frueheren Feier auf den Drucker schicken.
 */

let wurzel: ReturnType<typeof wurzelpfade>;
let datenpfad: string;

beforeAll(() => {
  datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-service-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
});
afterAll(() => schliesseDb());

function auftrag(eventId: string): string {
  return reiheEin({ eventId, ausgabeId: null, pfadPdf: '/gibt/es/nicht.pdf', kopien: 1, quelle: 'kiosk', berechnen: true });
}

function statusVon(id: string): string {
  return (holeDb().prepare('SELECT status FROM druckauftraege WHERE id = ?').get(id) as { status: string }).status;
}

function scheitere(id: string): void {
  holeDb().prepare("UPDATE druckauftraege SET status = 'fehlgeschlagen' WHERE id = ?").run(id);
}

describe('Papier gewechselt', () => {
  it('holt nur die Fehldrucke der laufenden Veranstaltung nach', () => {
    const alt = erstelleEvent({ name: 'Letzte Woche', datum: '2026-09-01' }, wurzel.events);
    const neu = erstelleEvent({ name: 'Heute', datum: '2026-09-08' }, wurzel.events);
    const fremd = auftrag(alt.id);
    const eigen = auftrag(neu.id);
    scheitere(fremd);
    scheitere(eigen);

    const schleife = new Druckschleife(() => new MockDrucker(join(datenpfad, 'drucke')), () => undefined);
    expect(schleife.fortsetzen(neu.id)).toBe(1);

    expect(statusVon(eigen)).toBe('wartend');
    expect(statusVon(fremd)).toBe('fehlgeschlagen');

    // Zu Hause, ohne laufende Veranstaltung, kommt alles zurueck.
    schleife.fortsetzen(null);
    expect(statusVon(fremd)).toBe('wartend');
    holeDb().prepare('DELETE FROM druckauftraege').run();
  });

  it('meldet 0, wenn nichts wartet', () => {
    const e = erstelleEvent({ name: 'Leer', datum: '2026-09-09' }, wurzel.events);
    const schleife = new Druckschleife(() => new MockDrucker(join(datenpfad, 'drucke')), () => undefined);
    expect(schleife.fortsetzen(e.id)).toBe(0);
  });
});

describe('Neue Veranstaltung startet', () => {
  it('stellt wartende Drucke frueherer Feiern zurueck, statt sie zu drucken', () => {
    const alt = erstelleEvent({ name: 'Ende mit leerer Rolle', datum: '2026-09-01' }, wurzel.events);
    const neu = erstelleEvent({ name: 'Naechste Feier', datum: '2026-09-15' }, wurzel.events);
    const liegengeblieben = auftrag(alt.id);
    const eigen = auftrag(neu.id);

    expect(stelleFremdeZurueck(neu.id)).toBe(1);
    expect(statusVon(liegengeblieben)).toBe('fehlgeschlagen');
    expect(statusVon(eigen)).toBe('wartend');
    const { fehlertext } = holeDb().prepare('SELECT fehlertext FROM druckauftraege WHERE id = ?').get(liegengeblieben) as {
      fehlertext: string;
    };
    expect(fehlertext).toMatch(/andere Veranstaltung/);
  });
});
