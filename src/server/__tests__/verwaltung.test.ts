import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { EINSTELLUNGEN_EINGABE, ersteMeldung, EVENT_DATUM, PIN_EINGABE } from '../fach/einstellungen-pruefung.js';
import { aktualisiereEvent, erstelleEvent, holeEvent, loescheEvent } from '../fach/events.js';
import { FILTER_EINGABE, legeEingebauteFilterAn, loescheFilter, speichereFilter } from '../fach/filter.js';
import { parseCube } from '../bild/lut.js';
import { wurzelpfade } from '../fach/pfade.js';

let wurzel: ReturnType<typeof wurzelpfade>;
beforeAll(() => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-verwaltung-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
});
afterAll(() => schliesseDb());

describe('Einstellungen einer Veranstaltung', () => {
  it.each([
    ['ein geleertes Feld Sitzungsabbruch (0)', { zeiten: { sitzungAbbruch: 0 } }, /Sitzungsabbruch.*mindestens 30/],
    ['Countdown 0', { zeiten: { countdown: 0 } }, /Countdown.*mindestens 1/],
    ['Kopien höchstens 0', { kopienMax: 0 }, /Kopien je Foto.*mindestens 1/],
    ['eine Kommazahl bei Kopien', { kopienMax: 1.5 }, /ganze Zahl/],
    ['Löschfrist 0', { emailLoeschfristTage: 0 }, /mindestens 1/],
    ['eine unbekannte Einstellung', { kopienMaximum: 3 }, /Unbekannte Einstellung/],
    ['eine Farbe ohne #', { farbeAkzent: 'red' }, /Akzentfarbe/],
  ])('weist ab: %s', (_name, eingabe, meldung) => {
    const ergebnis = EINSTELLUNGEN_EINGABE.safeParse(eingabe);
    expect(ergebnis.success).toBe(false);
    if (!ergebnis.success) expect(ersteMeldung(ergebnis.error)).toMatch(meldung);
  });

  it('nimmt einzelne gültige Werte', () => {
    expect(EINSTELLUNGEN_EINGABE.safeParse({ zeiten: { countdown: 5 }, kopienMax: 2 }).success).toBe(true);
    expect(EINSTELLUNGEN_EINGABE.safeParse({ zeiten: { liveViewAbschaltung: 0, bestaetigung: 0 } }).success).toBe(true);
  });

  it('PIN: nur 4 bis 8 Ziffern - wie das Tastenfeld am Kiosk', () => {
    for (const gut of ['1234', '12345678']) expect(PIN_EINGABE.safeParse(gut).success).toBe(true);
    for (const schlecht of ['123', 'abcd', '123456789', '12 34']) expect(PIN_EINGABE.safeParse(schlecht).success).toBe(false);
  });

  it('Datum: nur echte Kalendertage', () => {
    expect(EVENT_DATUM.safeParse('2028-02-29').success).toBe(true);
    for (const falsch of ['2026-02-31', '2026-13-01', '2026-2-3', '31.12.2026']) {
      expect(EVENT_DATUM.safeParse(falsch).success, falsch).toBe(false);
    }
  });

  it('hält "vorausgewählt" unter "höchstens" und "Ohne Filter" in der Liste', () => {
    const e = erstelleEvent({ name: 'Kinderfest', datum: '2026-08-01' }, wurzel.events);
    const nachher = aktualisiereEvent(e.id, { einstellungen: { kopienVorgabe: 3, kopienMax: 1, filter: ['sepia'] } });
    expect(nachher.einstellungen.kopienVorgabe).toBe(1);
    expect(nachher.einstellungen.filter[0]).toBe('ohne');
  });
});

describe('Veranstaltung löschen', () => {
  it('nimmt Sitzungen, Fotos, Drucke und Adressen mit', () => {
    const e = erstelleEvent({ name: 'Geburtstag', datum: '2026-08-02' }, wurzel.events);
    const db = holeDb();
    db.prepare("INSERT INTO sitzungen (id, event_id, vorlage_id, gestartet, ist_test) VALUES ('s1', ?, 'v', 'x', 0)").run(e.id);
    db.prepare("INSERT INTO ausgaben (id, sitzung_id, pfad_layout, erstellt) VALUES ('a1', 's1', '/x.jpg', 'x')").run();
    db.prepare("INSERT INTO versand (id, event_id, kanal, ziel) VALUES ('v1', ?, 'email', 'gast@web.de')").run(e.id);
    loescheEvent(e.id);
    expect(holeEvent(e.id)).toBeNull();
    for (const [tabelle, id] of [['sitzungen', 's1'], ['ausgaben', 'a1'], ['versand', 'v1']]) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${tabelle} WHERE id = ?`).get(id)).toEqual({ n: 0 });
    }
    expect(existsSync(e.ordner)).toBe(true); // den Ordner raeumt die Route auf, nicht die Datenbank
  });
});

describe('Filter', () => {
  it('weist kaputte Operationen und LUT-Pfade ab', () => {
    const schlecht = [
      [{ op: 'saettigung', wert: Number.NaN }],
      [{ op: 'lut', datei: '../../fotobox.db' }],
      [{ op: 'unbekannt' }],
      [],
    ];
    for (const operationen of schlecht) {
      expect(FILTER_EINGABE.safeParse({ name: 'x', operationen }).success, JSON.stringify(operationen)).toBe(false);
    }
    expect(FILTER_EINGABE.safeParse({ name: 'Warm', operationen: [{ op: 'saettigung', wert: 1.2 }] }).success).toBe(true);
  });

  it('ein gelöschter Filter verschwindet auch aus den Veranstaltungen', () => {
    const f = speichereFilter({ id: 'mein-look', name: 'Mein Look', operationen: [{ op: 'graustufen' }] });
    const e = erstelleEvent({ name: 'Sommerfest', datum: '2026-08-03' }, wurzel.events);
    aktualisiereEvent(e.id, { einstellungen: { filter: ['ohne', f.id] } });
    expect(loescheFilter(f.id)).toBe(true);
    expect(holeEvent(e.id)!.einstellungen.filter).toEqual(['ohne']);
    expect(loescheFilter('sepia')).toBe(false); // eingebaut
  });

  it('lehnt riesige LUTs ab, statt den Speicher zu fluten', () => {
    expect(() => parseCube('LUT_3D_SIZE 256\n0 0 0\n')).toThrow(/zu gross/);
  });
});
