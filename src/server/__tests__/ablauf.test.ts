import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oeffneDb, schliesseDb } from '../db/index.js';
import { leseGeraet, schreibeGeraet, begrenzeKalibrierung } from '../db/geraet.js';
import { legeEingebauteFilterAn } from '../fach/filter.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import {
  erstelleEvent,
  aktualisiereEvent,
  holeAktivesEvent,
  setzeStatus,
  setzeProbelauf,
} from '../fach/events.js';
import { starteSitzung, stelleFertig, verbucheFoto } from '../fach/sitzungen.js';
import { berechneAuslagen } from '../fach/auslagen.js';
import { reiheEin, Druckschleife } from '../fach/druckwarteschlange.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { hashePin, pruefePin, PinDrossel } from '../fach/pin.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import { MockDrucker } from '../treiber/drucker-mock.js';
import { warteAufNeueDatei } from '../fach/aufnahme.js';
import { KALIBRIERUNG_VORGABE } from '../../shared/typen.js';

/**
 * Ende-zu-Ende-Test des Kernablaufs mit Mock-Kamera und Mock-Drucker: vom
 * Anlegen der Veranstaltung bis zum Auslagenersatz.
 */

let wurzel: ReturnType<typeof wurzelpfade>;
let datenpfad: string;

beforeAll(() => {
  datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-test-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
  legeStandardvorlagenAn();
});

afterAll(() => schliesseDb());

describe('Lebenszyklus einer Veranstaltung', () => {
  it('erlaubt immer nur genau eine aktive Veranstaltung', () => {
    const a = erstelleEvent({ name: 'Feier A', datum: '2026-01-01' }, wurzel.events);
    const b = erstelleEvent({ name: 'Feier B', datum: '2026-01-02' }, wurzel.events);

    setzeStatus(a.id, 'startbereit');
    setzeStatus(a.id, 'aktiv');
    setzeStatus(b.id, 'startbereit');

    expect(() => setzeStatus(b.id, 'aktiv')).toThrow(/nur eine Veranstaltung aktiv/);
    setzeStatus(a.id, 'abgeschlossen');
    expect(() => setzeStatus(b.id, 'aktiv')).not.toThrow();
    setzeStatus(b.id, 'abgeschlossen');
  });

  it('weist unvorgesehene Statuswechsel ab', () => {
    const e = erstelleEvent({ name: 'Feier C', datum: '2026-01-03' }, wurzel.events);
    expect(() => setzeStatus(e.id, 'aktiv')).toThrow(/nicht vorgesehen/);
  });
});

describe('Kernablauf einer Sitzung', () => {
  it('fuehrt von der Vorlage bis zum Auslagenersatz', async () => {
    const event0 = erstelleEvent({ name: 'Hochzeit Test', datum: '2026-05-16' }, wurzel.events);
    const event = aktualisiereEvent(event0.id, {
      einstellungen: { vorlagen: ['standard-3-quer'], kopienMax: 3 },
    });
    setzeStatus(event.id, 'startbereit');
    const aktiv = setzeStatus(event.id, 'aktiv');

    const kamera = new MockKamera();
    const pfade = eventpfade(aktiv.ordner, false);
    await kamera.setzeZielordner(pfade.originale);

    const sitzung = starteSitzung(aktiv, 'standard-3-quer');
    expect(sitzung.benoetigteFotos).toBe(3);

    for (let i = 1; i <= 3; i += 1) {
      const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 10_000 });
      await kamera.ausloesen();
      const datei = await wartet;
      await verbucheFoto(sitzung, aktiv, datei, i);
    }

    // Genau ein Original je Foto - nicht doppelt, weil verschoben statt kopiert.
    expect(readdirSync(pfade.originale)).toHaveLength(3);

    const ausgabe = await stelleFertig(sitzung, aktiv, 'schwarzweiss', {
      lutOrdner: wurzel.luts,
      vorlagenOrdner: wurzel.vorlagen,
      kalibrierung: KALIBRIERUNG_VORGABE,
    });

    expect(readdirSync(pfade.bearbeitet)).toHaveLength(3);
    expect(readdirSync(pfade.layouts)).toHaveLength(1);
    expect(readdirSync(pfade.druck)).toHaveLength(1);

    // Die Druckdatei traegt die Papiergroesse, nicht die Bildgroesse.
    const pdf = readFileSync(ausgabe.pfadDruckPdf!, 'latin1');
    expect(pdf).toMatch(/\/MediaBox \[0 0 432 288\]/);

    const drucker = new MockDrucker(join(datenpfad, 'mock-drucke'));
    const schleife = new Druckschleife(
      () => drucker,
      () => undefined,
    );
    reiheEin({
      eventId: aktiv.id,
      ausgabeId: ausgabe.id,
      pfadPdf: ausgabe.pfadDruckPdf!,
      kopien: 2,
      quelle: 'kiosk',
      berechnen: true,
    });
    schleife.starte();
    await warteBis(() => berechneAuslagen(holeAktivesEvent()!).druckeGesamt === 2);
    schleife.stoppe();

    const auslagen = berechneAuslagen(holeAktivesEvent()!);
    expect(auslagen.sitzungen).toBe(1);
    expect(auslagen.fotos).toBe(3);
    expect(auslagen.layouts).toBe(1);
    expect(auslagen.druckeGesamt).toBe(2);
    // Zwei Drucke zu 20 Cent.
    expect(auslagen.betrag).toBeCloseTo(0.4, 2);
    // Ein Blatt = ein Bild, 700 pro Rolle.
    expect(auslagen.materialRest).toBe(698);

    setzeStatus(aktiv.id, 'abgeschlossen');
  });
});

describe('Probelauf', () => {
  it('zaehlt weder in den Auslagenersatz noch in die Galerie', async () => {
    const event0 = erstelleEvent({ name: 'Probe', datum: '2026-07-01' }, wurzel.events);
    const event = aktualisiereEvent(event0.id, {
      einstellungen: { vorlagen: ['standard-1-quer'] },
    });
    setzeStatus(event.id, 'startbereit');
    setzeStatus(event.id, 'aktiv');
    const imProbelauf = setzeProbelauf(event.id, true);

    const pfade = eventpfade(imProbelauf.ordner, true);
    const kamera = new MockKamera();
    await kamera.setzeZielordner(pfade.originale);

    const sitzung = starteSitzung(imProbelauf, 'standard-1-quer');
    const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 10_000 });
    await kamera.ausloesen();
    await verbucheFoto(sitzung, imProbelauf, await wartet, 1);
    await stelleFertig(sitzung, imProbelauf, null, {
      lutOrdner: wurzel.luts,
      vorlagenOrdner: wurzel.vorlagen,
      kalibrierung: KALIBRIERUNG_VORGABE,
    });

    const auslagen = berechneAuslagen(holeAktivesEvent()!);
    expect(auslagen.sitzungen).toBe(0);
    expect(auslagen.fotos).toBe(0);
    expect(auslagen.layouts).toBe(0);
    // Die Dateien liegen im eigenen Unterordner.
    expect(pfade.originale).toContain('_probelauf');

    setzeStatus(imProbelauf.id, 'abgeschlossen');
  });
});

describe('Druckwarteschlange', () => {
  it('verliert bei Druckerausfall keinen Auftrag und setzt nach dem Papierwechsel fort', async () => {
    const event0 = erstelleEvent({ name: 'Stau', datum: '2026-08-01' }, wurzel.events);
    const event = aktualisiereEvent(event0.id, {
      einstellungen: { vorlagen: ['standard-1-quer'] },
    });
    setzeStatus(event.id, 'startbereit');
    const aktiv = setzeStatus(event.id, 'aktiv');

    const drucker = new MockDrucker(join(datenpfad, 'mock-drucke-stau'));
    drucker.zustand = { zustand: 'papier-leer' };
    const schleife = new Druckschleife(
      () => drucker,
      () => undefined,
    );

    const pfade = eventpfade(aktiv.ordner, false);
    const kamera = new MockKamera();
    await kamera.setzeZielordner(pfade.originale);
    const sitzung = starteSitzung(aktiv, 'standard-1-quer');
    const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 10_000 });
    await kamera.ausloesen();
    await verbucheFoto(sitzung, aktiv, await wartet, 1);
    const ausgabe = await stelleFertig(sitzung, aktiv, null, {
      lutOrdner: wurzel.luts,
      vorlagenOrdner: wurzel.vorlagen,
      kalibrierung: KALIBRIERUNG_VORGABE,
    });

    reiheEin({
      eventId: aktiv.id,
      ausgabeId: ausgabe.id,
      pfadPdf: ausgabe.pfadDruckPdf!,
      kopien: 1,
      quelle: 'kiosk',
      berechnen: true,
    });
    schleife.starte();
    await warteBis(() => schleife.istAngehalten());

    // Der Auftrag ist nicht verloren, nur angehalten.
    expect(berechneAuslagen(holeAktivesEvent()!).druckeGesamt).toBe(0);

    drucker.zustand = { zustand: 'bereit' };
    schleife.fortsetzen();
    await warteBis(() => berechneAuslagen(holeAktivesEvent()!).druckeGesamt === 1);
    schleife.stoppe();

    expect(berechneAuslagen(holeAktivesEvent()!).druckeGesamt).toBe(1);
    setzeStatus(aktiv.id, 'abgeschlossen');
  });
});

describe('PIN', () => {
  it('speichert niemals im Klartext und prueft korrekt', async () => {
    const hash = await hashePin('4711');
    expect(hash).not.toContain('4711');
    expect(await pruefePin('4711', hash)).toBe(true);
    expect(await pruefePin('4712', hash)).toBe(false);
    expect(await pruefePin('4711', null)).toBe(false);
  });

  it('drosselt nach drei Fehlversuchen', () => {
    const drossel = new PinDrossel();
    expect(drossel.gesperrtFuerMs()).toBe(0);
    drossel.merkeFehlversuch();
    drossel.merkeFehlversuch();
    expect(drossel.gesperrtFuerMs()).toBe(0);
    drossel.merkeFehlversuch();
    expect(drossel.gesperrtFuerMs()).toBeGreaterThan(25_000);
    drossel.merkeErfolg();
    expect(drossel.gesperrtFuerMs()).toBe(0);
  });
});

describe('Druckkalibrierung', () => {
  it('begrenzt auf den erlaubten Bereich', () => {
    // Abweichungen von Zentimetern sind ein falsches Papierformat im Treiber,
    // kein Kalibrierproblem.
    const begrenzt = begrenzeKalibrierung({
      versatzXMm: 40,
      versatzYMm: -12,
      skalierungXProzent: 300,
      skalierungYProzent: 10,
    });
    expect(begrenzt.versatzXMm).toBe(5);
    expect(begrenzt.versatzYMm).toBe(-5);
    expect(begrenzt.skalierungXProzent).toBe(105);
    expect(begrenzt.skalierungYProzent).toBe(95);
  });

  it('wird beim Geraet gespeichert, nicht im Event', () => {
    schreibeGeraet({ kalibrierung: { versatzXMm: 1.2, versatzYMm: -0.4, skalierungXProzent: 99.5, skalierungYProzent: 100 } });
    expect(leseGeraet().kalibrierung.versatzXMm).toBeCloseTo(1.2, 2);
  });
});

async function warteBis(bedingung: () => boolean, zeitlimitMs = 15_000): Promise<void> {
  const bis = Date.now() + zeitlimitMs;
  while (Date.now() < bis) {
    if (bedingung()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Bedingung wurde nicht erfuellt.');
}
