import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { legeEingebauteFilterAn } from '../fach/filter.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import { aktualisiereEvent, erstelleEvent, setzeStatus } from '../fach/events.js';
import { holeAusgabe, loescheAusgabeEndgueltig, starteSitzung, stelleFertig, verbucheFoto } from '../fach/sitzungen.js';
import { warteAufNeueDatei } from '../fach/aufnahme.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import {
  erzeugeGaestebuchPdf,
  gruesseVon,
  hatGruss,
  speichereGruss,
  UngueltigerGruss,
} from '../fach/gaestebuch.js';
import { uebergebeAufDatentraeger } from '../fach/uebergabe.js';
import { EINSTELLUNGEN_EINGABE } from '../fach/einstellungen-pruefung.js';
import { bauePortal } from '../portal/http.js';
import { KALIBRIERUNG_VORGABE, type Veranstaltung } from '../../shared/typen.js';

/*
 * Das Gaestebuch: ein handgeschriebener Gruss je Foto, nur fuer den Gastgeber.
 * Er geht mit der Uebergabe als PDF mit - und verschwindet, wenn der Gast sein
 * Foto loescht.
 */

let wurzel: ReturnType<typeof wurzelpfade>;
let event: Veranstaltung;

async function fotoMachen(istTest = false): Promise<string> {
  const sitzung = starteSitzung(event, 'standard-1-quer');
  if (istTest) holeDb().prepare('UPDATE sitzungen SET ist_test = 1 WHERE id = ?').run(sitzung.id);
  const s = istTest ? { ...sitzung, istTest: true } : sitzung;
  const pfade = eventpfade(event.ordner, istTest);
  const kamera = new MockKamera();
  await kamera.setzeZielordner(pfade.originale);
  const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 10_000 });
  await kamera.ausloesen();
  await verbucheFoto(s, event, await wartet, 1);
  const ausgabe = await stelleFertig(s, event, null, {
    lutOrdner: wurzel.luts,
    vorlagenOrdner: wurzel.vorlagen,
    kalibrierung: KALIBRIERUNG_VORGABE,
  });
  return ausgabe.id;
}

/** Ein Gruss, wie ihn die Schreibflaeche liefert: Schrift auf durchsichtigem Grund. */
function gruss(farbe = '#1d2b64'): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000">
    <path d="M100 500 C 300 200, 500 800, 700 500 S 1100 200, 1300 500" stroke="${farbe}" stroke-width="7" fill="none"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

beforeAll(() => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-gaestebuch-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
  legeStandardvorlagenAn();
  const roh = erstelleEvent({ name: 'Hochzeit Gästebuch', datum: '2026-10-10' }, wurzel.events);
  event = aktualisiereEvent(roh.id, { einstellungen: { vorlagen: ['standard-1-quer'], gaestebuchAktiv: true } });
  setzeStatus(event.id, 'startbereit');
  event = setzeStatus(event.id, 'aktiv');
});

afterAll(() => schliesseDb());

describe('Gaestebuch', () => {
  it('speichert einen Gruss je Foto - ein zweiter ersetzt den ersten', async () => {
    const id = await fotoMachen();
    const ausgabe = holeAusgabe(id)!;
    const erster = await speichereGruss(event, ausgabe, await gruss());
    expect(existsSync(erster.pfad)).toBe(true);
    expect(erster.pfad.startsWith(eventpfade(event.ordner).gaestebuch)).toBe(true);
    expect(hatGruss(id)).toBe(true);

    // Neu geschrieben: Es bleibt einer, und die alte Datei ist weg.
    await new Promise((r) => setTimeout(r, 1100));
    const zweiter = await speichereGruss(event, ausgabe, await gruss('#b8323a'));
    const alle = gruesseVon(event.id).filter((g) => g.ausgabeId === id);
    expect(alle).toHaveLength(1);
    expect(alle[0]!.pfad).toBe(zweiter.pfad);
    expect(existsSync(erster.pfad)).toBe(false);
  });

  it('nimmt nur echte Bilder an', async () => {
    const id = await fotoMachen();
    const ausgabe = holeAusgabe(id)!;
    await expect(speichereGruss(event, ausgabe, Buffer.from('kein Bild'))).rejects.toBeInstanceOf(UngueltigerGruss);
    // Ein JPEG ist auch kein Gruss von der Schreibflaeche.
    const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await expect(speichereGruss(event, ausgabe, jpeg)).rejects.toBeInstanceOf(UngueltigerGruss);
    expect(hatGruss(id)).toBe(false);
  });

  it('laesst Gruesse aus dem Probelauf aus dem Gaestebuch', async () => {
    const id = await fotoMachen(true);
    const g = await speichereGruss(event, holeAusgabe(id)!, await gruss());
    expect(g.pfad.startsWith(eventpfade(event.ordner, true).gaestebuch)).toBe(true);
    expect(gruesseVon(event.id).some((x) => x.ausgabeId === id)).toBe(false);
  });

  it('loescht den Gruss mit, wenn der Gast sein Foto loescht', async () => {
    const id = await fotoMachen();
    const g = await speichereGruss(event, holeAusgabe(id)!, await gruss());
    await loescheAusgabeEndgueltig(id, event.ordner);
    expect(existsSync(g.pfad)).toBe(false);
    expect(hatGruss(id)).toBe(false);
  });

  it('erzeugt das Gaestebuch als PDF: Deckblatt und zwei Eintraege je Seite', async () => {
    await speichereGruss(event, holeAusgabe(await fotoMachen())!, await gruss());
    await speichereGruss(event, holeAusgabe(await fotoMachen())!, await gruss());
    const anzahl = gruesseVon(event.id).length;
    expect(anzahl).toBe(3);

    const ergebnis = await erzeugeGaestebuchPdf(event);
    expect(ergebnis?.anzahl).toBe(3);
    const pdf = readFileSync(ergebnis!.pfad);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const seiten = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length;
    expect(seiten).toBe(1 + Math.ceil(anzahl / 2));
  });

  it('kein PDF ohne Gruss', async () => {
    const leer = erstelleEvent({ name: 'Ohne Grüße', datum: '2026-10-11' }, wurzel.events);
    expect(await erzeugeGaestebuchPdf(leer)).toBeNull();
  });

  it('geht mit der Uebergabe an den Gastgeber - der Probelauf nicht', async () => {
    await erzeugeGaestebuchPdf(event);
    const ziel = mkdtempSync(join(tmpdir(), 'fotobox-stick-'));
    const ergebnis = await uebergebeAufDatentraeger(event, ziel);
    expect(ergebnis.geprueft).toBe(true);
    const kopie = join(ziel, readdirSync(ziel)[0]!);
    const dateien = readdirSync(join(kopie, '05_gaestebuch'));
    expect(dateien).toContain('Gaestebuch.pdf');
    expect(dateien.filter((d) => d.endsWith('.png'))).toHaveLength(3);
    expect(existsSync(join(kopie, '_probelauf'))).toBe(false);
  });
});

describe('Diashow-Einstellungen', () => {
  it('haben Grenzen', () => {
    expect(EINSTELLUNGEN_EINGABE.safeParse({ diashowNachSekunden: 60, diashowWechselSekunden: 7 }).success).toBe(true);
    expect(EINSTELLUNGEN_EINGABE.safeParse({ diashowNachSekunden: 5 }).success).toBe(false);
    expect(EINSTELLUNGEN_EINGABE.safeParse({ diashowWechselSekunden: 0 }).success).toBe(false);
    expect(EINSTELLUNGEN_EINGABE.safeParse({ diashowAufStart: false, gaestebuchAktiv: true }).success).toBe(true);
  });
});

describe('Portal und Diashow', () => {
  it('"192.168.254.1/diashow" fuehrt zur Diashow der laufenden Galerie', async () => {
    const galerie = 'http://192.168.254.1:8788/g/abc123';
    const app = bauePortal(() => galerie);
    for (const url of ['/diashow', '/diashow/', '/Diashow']) {
      const r = await app.inject({ method: 'GET', url, headers: { host: '192.168.254.1' } });
      expect(r.statusCode, url).toBe(302);
      expect(r.headers.location, url).toBe(`${galerie}/diashow`);
    }
    // Alles andere wie bisher zur Galerie.
    const r = await app.inject({ method: 'GET', url: '/diashow-x' });
    expect(r.headers.location).toBe(galerie);
    await app.close();
  });
});
