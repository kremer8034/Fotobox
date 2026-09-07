import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { legeEingebauteFilterAn } from '../fach/filter.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import { aktualisiereEvent, erstelleEvent, setzeStatus } from '../fach/events.js';
import { starteSitzung, stelleFertig, verbucheFoto } from '../fach/sitzungen.js';
import { warteAufNeueDatei } from '../fach/aufnahme.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { schreibeGalerieHtml, uebergebeAufDatentraeger } from '../fach/uebergabe.js';
import { schreibeAushang, schreibeKurzanleitung } from '../fach/unterlagen.js';
import { drosselGreift, pruefeAdresse } from '../fach/email.js';
import { KALIBRIERUNG_VORGABE, type Veranstaltung } from '../../shared/typen.js';

let wurzel: ReturnType<typeof wurzelpfade>;
let datenpfad: string;
let event: Veranstaltung;

beforeAll(async () => {
  datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-uebergabe-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
  legeStandardvorlagenAn();

  const roh = erstelleEvent({ name: 'Übergabe Test', datum: '2026-09-12' }, wurzel.events);
  event = aktualisiereEvent(roh.id, {
    einstellungen: { vorlagen: ['standard-1-quer'], galerieAktiv: true },
  });
  setzeStatus(event.id, 'startbereit');
  event = setzeStatus(event.id, 'aktiv');

  // Eine echte Sitzung, damit im Ordner auch etwas liegt.
  const pfade = eventpfade(event.ordner, false);
  const kamera = new MockKamera();
  await kamera.setzeZielordner(pfade.originale);
  const sitzung = starteSitzung(event, 'standard-1-quer');
  const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 10_000 });
  await kamera.ausloesen();
  await verbucheFoto(sitzung, event, await wartet, 1);
  await stelleFertig(sitzung, event, null, {
    lutOrdner: wurzel.luts,
    vorlagenOrdner: wurzel.vorlagen,
    kalibrierung: KALIBRIERUNG_VORGABE,
  });
});

afterAll(() => schliesseDb());

describe('Uebergabe an den Gastgeber', () => {
  it('schreibt eine eigenstaendige Galerie in den Event-Ordner', async () => {
    const pfad = await schreibeGalerieHtml(event);
    const html = readFileSync(pfad, 'utf8');
    // Relative Pfade, damit die Datei per Doppelklick funktioniert - ohne
    // Server, ohne Internet.
    expect(html).toContain('03_layouts/');
    expect(html).not.toContain('http://');
    expect(html).toContain('Übergabe Test');
  });

  it('kopiert vollstaendig und bestaetigt erst nach geprueftem Marker', async () => {
    const ziel = mkdtempSync(join(tmpdir(), 'fotobox-stick-'));
    const ergebnis = await uebergebeAufDatentraeger(event, ziel);

    expect(ergebnis.geprueft).toBe(true);
    expect(ergebnis.dateien).toBeGreaterThan(0);

    const kopie = join(ziel, readdirSync(ziel)[0]!);
    expect(existsSync(join(kopie, 'event.json'))).toBe(true);
    expect(existsSync(join(kopie, 'auslagen.csv'))).toBe(true);
    expect(existsSync(join(kopie, 'galerie.html'))).toBe(true);
    expect(readdirSync(join(kopie, '01_originale'))).toHaveLength(1);
    expect(readdirSync(join(kopie, '03_layouts'))).toHaveLength(1);

    // Der Cache gehoert nicht zur Uebergabe.
    expect(existsSync(join(kopie, '.cache'))).toBe(false);
    // Und die Markerdatei raeumt sich selbst wieder weg.
    expect(readdirSync(kopie).some((n) => n.endsWith('.chk'))).toBe(false);
  });
});

describe('Unterlagen', () => {
  it('erzeugt die Kurzanleitung mit der PIN', async () => {
    const pfad = await schreibeKurzanleitung(event, { betreuerPin: '1234', telefon: '0170 1234567' });
    const inhalt = readFileSync(pfad, 'latin1');
    expect(inhalt.startsWith('%PDF')).toBe(true);
    expect(inhalt.length).toBeGreaterThan(1000);
  });

  it('erzeugt den Aushang mit den beiden QR-Codes', async () => {
    const pfad = await schreibeAushang(event, {
      betreuerPin: '1234',
      telefon: '',
      galerieUrl: 'http://192.168.8.2:8787/g/abc',
      wlanName: 'Fotobox',
      wlanPasswort: 'geheim123',
    });
    expect(readFileSync(pfad, 'latin1').startsWith('%PDF')).toBe(true);
  });
});

describe('E-Mail-Schutz', () => {
  it('nimmt nur brauchbare Adressen an', () => {
    expect(pruefeAdresse('gast@example.com')).toBe(true);
    expect(pruefeAdresse('kein-at-zeichen')).toBe(false);
    expect(pruefeAdresse('a@b')).toBe(false);
    expect(pruefeAdresse(`${'x'.repeat(300)}@example.com`)).toBe(false);
  });

  it('bremst nach fuenf Adressen je Minute', () => {
    const kennung = `test-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) expect(drosselGreift(kennung)).toBe(false);
    expect(drosselGreift(kennung)).toBe(true);
  });
});
