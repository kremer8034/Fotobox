import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { aktualisiereEvent, dupliziereEvent, erstelleEvent } from '../fach/events.js';
import { legeEingebauteFilterAn } from '../fach/filter.js';
import { legeStandardvorlagenAn, loescheVorlage } from '../fach/vorlagen.js';
import {
  listeVoreinstellungen,
  loescheVoreinstellung,
  speichereVoreinstellung,
  uebernehmbar,
} from '../fach/voreinstellungen.js';
import { wurzelpfade } from '../fach/pfade.js';

let wurzel: ReturnType<typeof wurzelpfade>;

beforeAll(() => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-voreinstellungen-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
  legeStandardvorlagenAn();
});
afterAll(() => schliesseDb());

function kinderparty() {
  const e = erstelleEvent({ name: 'Kinderparty Mia', datum: '2026-05-02' }, wurzel.events);
  return aktualisiereEvent(e.id, {
    einstellungen: {
      kopienMax: 1,
      druckLimit: 80,
      startTitel: 'Mias 6. Geburtstag',
      vorlagen: ['standard-1-quer', 'standard-2-quer'],
      filter: ['ohne', 'pop'],
      zeiten: { countdown: 5 } as never,
    },
    betreuerPinHash: 'scrypt$abc$def',
  });
}

describe('Veranstaltung duplizieren', () => {
  it('übernimmt alle Einstellungen, aber keine PIN, keine Links und keine Zahlen', () => {
    const quelle = kinderparty();
    holeDb().prepare('UPDATE events SET material_verbraucht = 42 WHERE id = ?').run(quelle.id);

    const kopie = dupliziereEvent(quelle.id, { name: 'Kinderparty Ben', datum: '2026-06-13' }, wurzel.events);

    expect(kopie.id).not.toBe(quelle.id);
    expect(kopie.einstellungen).toEqual(quelle.einstellungen);
    expect(kopie.einstellungen.zeiten.countdown).toBe(5);
    expect(kopie.status).toBe('entwurf');
    expect(kopie.betreuerPinHash).toBeNull();
    expect(kopie.materialVerbraucht).toBe(0);
    expect(kopie.galerieToken).not.toBe(quelle.galerieToken);
    expect(kopie.statusToken).not.toBe(quelle.statusToken);
    expect(kopie.ordner).not.toBe(quelle.ordner);
  });

  it('gibt zwei Veranstaltungen mit gleichem Namen am gleichen Tag getrennte Ordner', () => {
    const a = erstelleEvent({ name: 'Hochzeit', datum: '2026-08-08' }, wurzel.events);
    const b = erstelleEvent({ name: 'Hochzeit', datum: '2026-08-08' }, wurzel.events);
    const c = dupliziereEvent(a.id, { name: 'Hochzeit', datum: '2026-08-08' }, wurzel.events);
    expect(new Set([a.ordner, b.ordner, c.ordner]).size).toBe(3);
    expect(b.ordner).toBe(`${a.ordner}_2`);
  });
});

describe('Voreinstellungen', () => {
  it('speichert, überschreibt bei gleichem Namen und löscht', () => {
    const quelle = kinderparty();
    const erste = speichereVoreinstellung('Kinderparty', quelle.einstellungen);
    const zweite = speichereVoreinstellung('kinderparty', { ...quelle.einstellungen, kopienMax: 2 });

    expect(zweite.id).toBe(erste.id);
    const liste = listeVoreinstellungen().filter((v) => v.name.toLowerCase() === 'kinderparty');
    expect(liste).toHaveLength(1);
    expect(liste[0]!.einstellungen.kopienMax).toBe(2);

    expect(loescheVoreinstellung(erste.id)).toBe(true);
    expect(listeVoreinstellungen().some((v) => v.id === erste.id)).toBe(false);
  });

  it('lässt gelöschte Vorlagen und Filter beim Übernehmen weg, "Ohne Filter" bleibt', () => {
    const quelle = kinderparty();
    const v = speichereVoreinstellung('Mit alter Vorlage', {
      ...quelle.einstellungen,
      vorlagen: ['standard-1-quer', 'standard-4-quer'],
      filter: ['pop', 'gibt-es-nicht'],
    });
    loescheVorlage('standard-4-quer');

    const neu = uebernehmbar(v.einstellungen);
    expect(neu.vorlagen).toEqual(['standard-1-quer']);
    expect(neu.filter).toEqual(['ohne', 'pop']);
    expect(neu.druckLimit).toBe(80);
  });
});
