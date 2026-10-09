import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { erstelleEvent, holeEvent } from '../fach/events.js';
import { UEBERGAENGE } from '../../shared/typen.js';

/*
 * Die Pause gibt es nicht mehr. Eine Datenbank aus einer aelteren Version
 * kann aber noch eine pausierte Veranstaltung enthalten - die muss danach
 * weiterlaufen, statt in einem Zustand zu haengen, den niemand mehr kennt.
 */
describe('Pause entfernt', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'fotobox-pause-'));
  const db = join(ordner, 'fotobox.db');
  afterAll(() => schliesseDb());

  it('kennt keinen Wechsel in eine Pause mehr', () => {
    expect(Object.keys(UEBERGAENGE)).not.toContain('pausiert');
    expect(UEBERGAENGE.aktiv).toEqual(['abgeschlossen']);
  });

  it('laesst eine pausierte Veranstaltung nach dem Update weiterlaufen', () => {
    oeffneDb(db);
    const laeuft = erstelleEvent({ name: 'Alt pausiert', datum: '2026-10-10' }, join(ordner, 'events'));
    const zweite = erstelleEvent({ name: 'Auch pausiert', datum: '2026-10-11' }, join(ordner, 'events'));
    holeDb().prepare("UPDATE events SET status = 'pausiert', erstellt = ? WHERE id = ?").run('2026-01-02', laeuft.id);
    holeDb().prepare("UPDATE events SET status = 'pausiert', erstellt = ? WHERE id = ?").run('2026-01-01', zweite.id);
    schliesseDb();

    oeffneDb(db);
    // Nur eine darf aktiv sein: die juengste laeuft weiter, die andere gilt als abgeschlossen.
    expect(holeEvent(laeuft.id)?.status).toBe('aktiv');
    expect(holeEvent(zweite.id)?.status).toBe('abgeschlossen');
    expect(holeEvent(zweite.id)?.geschlossenAm).not.toBeNull();
  });
});
