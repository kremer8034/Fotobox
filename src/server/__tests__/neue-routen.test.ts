import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { legeEingebauteFilterAn } from '../fach/filter.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import { aktualisiereEvent, erstelleEvent, setzeStatus } from '../fach/events.js';
import { starteSitzung, stelleFertig, verbucheFoto } from '../fach/sitzungen.js';
import { baueGaestebuchPdf, erzeugeGaestebuchPdf, hatGruss } from '../fach/gaestebuch.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { warteAufNeueDatei } from '../fach/aufnahme.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import { Betrieb } from '../betrieb.js';
import { registriereKiosk } from '../routen/kiosk.js';
import { registriereOeffentlich } from '../routen/oeffentlich.js';
import { beantworteFehler, schuetzeLokal } from '../sicherheit.js';
import { KALIBRIERUNG_VORGABE, type Veranstaltung } from '../../shared/typen.js';
import type { Konfig } from '../konfig.js';

/*
 * Die Schnittstellen von Gaestebuch und Diashow, so wie Kiosk und WLAN sie
 * aufrufen: Was ist aus, was ist an, und was wird abgelehnt.
 */

let wurzel: ReturnType<typeof wurzelpfade>;
let lokal: FastifyInstance;
let oeffentlich: FastifyInstance;
let event: Veranstaltung;

const LOKAL = { host: 'localhost:8787', origin: 'http://localhost:8787' };

async function foto(): Promise<string> {
  const sitzung = starteSitzung(event, 'standard-1-quer');
  const pfade = eventpfade(event.ordner, false);
  const kamera = new MockKamera();
  await kamera.setzeZielordner(pfade.originale);
  const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 10_000 });
  await kamera.ausloesen();
  await verbucheFoto(sitzung, event, await wartet, 1);
  const ausgabe = await stelleFertig(sitzung, event, null, {
    lutOrdner: wurzel.luts,
    vorlagenOrdner: wurzel.vorlagen,
    kalibrierung: KALIBRIERUNG_VORGABE,
  });
  return ausgabe.id;
}

async function grussAlsDatenadresse(): Promise<string> {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><path d="M10 100 L290 100" stroke="#1d2b64" stroke-width="7"/></svg>';
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

beforeAll(async () => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-neue-routen-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
  legeStandardvorlagenAn();
  const roh = erstelleEvent({ name: 'Routen-Test', datum: '2026-11-20' }, wurzel.events);
  event = aktualisiereEvent(roh.id, { einstellungen: { vorlagen: ['standard-1-quer'], galerieAktiv: true } });
  setzeStatus(event.id, 'startbereit');
  event = setzeStatus(event.id, 'aktiv');

  const konfig: Konfig = { datenpfad, portLokal: 8787, portOeffentlich: 8787, echteHardware: false, webOrdner: 'dist/web' };
  const betrieb = new Betrieb({ echteHardware: false, mockDruckOrdner: join(datenpfad, 'mock') });
  lokal = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  schuetzeLokal(lokal);
  beantworteFehler(lokal, () => undefined);
  registriereKiosk(lokal, betrieb, konfig);
  oeffentlich = Fastify();
  registriereOeffentlich(oeffentlich, betrieb);
});

afterAll(async () => {
  await lokal.close();
  await oeffentlich.close();
  schliesseDb();
});

describe('Gaestebuch am Kiosk', () => {
  it('ist ohne Schalter zu', async () => {
    const id = await foto();
    const r = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/gaestebuch',
      headers: LOKAL,
      payload: { ausgabeId: id, bild: await grussAlsDatenadresse() },
    });
    expect(r.statusCode).toBe(403);
    expect(hatGruss(id)).toBe(false);
  });

  it('nimmt mit Schalter den Gruss zum frischen Foto an - nur ein PNG', async () => {
    event = aktualisiereEvent(event.id, { einstellungen: { gaestebuchAktiv: true } });
    const id = await foto();
    const falsch = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/gaestebuch',
      headers: LOKAL,
      payload: { ausgabeId: id, bild: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    });
    expect(falsch.statusCode).toBe(400);

    const r = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/gaestebuch',
      headers: LOKAL,
      payload: { ausgabeId: id, bild: await grussAlsDatenadresse() },
    });
    expect(r.statusCode).toBe(200);
    expect(hatGruss(id)).toBe(true);
  });

  it('schreibt nicht an alte Fotos', async () => {
    const id = await foto();
    holeDb().prepare('UPDATE ausgaben SET erstellt = ? WHERE id = ?').run(new Date(Date.now() - 60 * 60_000).toISOString(), id);
    const r = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/gaestebuch',
      headers: LOKAL,
      payload: { ausgabeId: id, bild: await grussAlsDatenadresse() },
    });
    expect(r.statusCode).toBe(404);
  });

  it('lehnt Anfragen fremder Seiten ab (CSRF)', async () => {
    const id = await foto();
    const r = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/gaestebuch',
      headers: { host: 'localhost:8787', origin: 'https://boese.example', 'sec-fetch-site': 'cross-site' },
      payload: { ausgabeId: id, bild: await grussAlsDatenadresse() },
    });
    expect(r.statusCode).toBe(403);
  });

  it('erzeugt das PDF auch bei gleichzeitigen Anfragen heil', async () => {
    const [a, b, c] = await Promise.all([
      erzeugeGaestebuchPdf(event),
      erzeugeGaestebuchPdf(event),
      baueGaestebuchPdf(event),
    ]);
    expect(a?.anzahl).toBe(1);
    expect(b?.anzahl).toBe(1);
    expect(c?.daten.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Diashow', () => {
  it('liefert am Kiosk Fotos und den Schalter fuer Beamer und Fernseher', async () => {
    const r = await lokal.inject({ url: '/api/kiosk/diashow', headers: LOKAL });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.extern).toBe(false);
    expect(d.bilder.length).toBeGreaterThan(0);
  });

  it('sagt der Diashow im WLAN, ob sie fuer diese Feier an ist', async () => {
    let r = await oeffentlich.inject(`/api/galerie/${event.galerieToken}`);
    expect(r.json().diashowExtern).toBe(false);
    event = aktualisiereEvent(event.id, { einstellungen: { diashowExtern: true } });
    r = await oeffentlich.inject(`/api/galerie/${event.galerieToken}`);
    expect(r.json().diashowExtern).toBe(true);
  });
});

describe('Verwaltung', () => {
  it('laesst sich nicht in fremde Seiten einbetten (Clickjacking)', async () => {
    const r = await lokal.inject({ url: '/api/kiosk/diashow', headers: LOKAL });
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'self'");
  });
});
