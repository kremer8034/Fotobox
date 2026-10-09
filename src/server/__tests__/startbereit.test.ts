import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import { aktualisiereEvent, erstelleEvent } from '../fach/events.js';
import { hashePin } from '../fach/pin.js';
import { startbereitPruefung } from '../fach/startbereit.js';
import { wurzelpfade } from '../fach/pfade.js';
import type { Betrieb } from '../betrieb.js';
import type { Konfig } from '../konfig.js';

/*
 * Der Startbereit-Check: Die Besitzer-PIN gehoert zur Box, die Betreuer-PIN
 * zur Veranstaltung. Fehlt bei einer neuen Feier nur die Betreuer-PIN, darf
 * der Check nicht so aussehen, als fehle die Besitzer-PIN.
 */

let konfig: Konfig;
let wurzel: ReturnType<typeof wurzelpfade>;

const betrieb = {
  status: async () => ({
    kamera: 'bereit',
    kameraHinweis: null,
    drucker: 'bereit',
    druckerVorrat: { rest: 300 },
    speicherFreiGb: 100,
  }),
} as unknown as Betrieb;

beforeAll(() => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-startbereit-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeStandardvorlagenAn();
  konfig = { datenpfad, portLokal: 8787, portOeffentlich: 8787, echteHardware: false, webOrdner: 'dist/web' };
});
afterAll(() => schliesseDb());

function punkt(ergebnis: Awaited<ReturnType<typeof startbereitPruefung>>, schluessel: string) {
  return ergebnis.punkte.find((p) => p.schluessel === schluessel);
}

describe('Startbereit-Check: PINs', () => {
  it('trennt Besitzer-PIN (Box) und Betreuer-PIN (Veranstaltung)', async () => {
    schreibeGeraet({ besitzerPinHash: await hashePin('1234') });
    const roh = erstelleEvent({ name: 'Neue Feier', datum: '2026-11-01' }, wurzel.events);
    const event = aktualisiereEvent(roh.id, { einstellungen: { vorlagen: ['standard-1-quer'] } });

    // Neue Feier ohne Betreuer-PIN: Nur dieser Punkt schlaegt fehl.
    let ergebnis = await startbereitPruefung(event, betrieb, konfig);
    expect(punkt(ergebnis, 'besitzerPin')?.bestanden).toBe(true);
    expect(punkt(ergebnis, 'betreuerPin')?.bestanden).toBe(false);
    expect(punkt(ergebnis, 'betreuerPin')?.hinweis).toContain('Aussehen & PIN');
    expect(ergebnis.punkte.some((p) => !p.bestanden && /Besitzer/.test(p.titel + p.hinweis))).toBe(false);

    const mitPin = aktualisiereEvent(event.id, { betreuerPinHash: await hashePin('5678') });
    ergebnis = await startbereitPruefung(mitPin, betrieb, konfig);
    expect(punkt(ergebnis, 'betreuerPin')?.bestanden).toBe(true);
    expect(ergebnis.bestanden).toBe(true);
  });

  it('meldet eine fehlende Besitzer-PIN als Sache der Box, nicht der Veranstaltung', async () => {
    schreibeGeraet({ besitzerPinHash: null });
    const event = erstelleEvent({ name: 'Ohne Besitzer-PIN', datum: '2026-11-02' }, wurzel.events);
    const ergebnis = await startbereitPruefung(event, betrieb, konfig);
    const besitzer = punkt(ergebnis, 'besitzerPin');
    expect(besitzer?.bestanden).toBe(false);
    expect(besitzer?.hinweis).toContain('Gerät');
  });
});
