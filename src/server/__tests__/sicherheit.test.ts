import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { legeEingebauteFilterAn } from '../fach/filter.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import { aktualisiereEvent, erstelleEvent, setzeProbelauf, setzeStatus } from '../fach/events.js';
import { starteSitzung, stelleFertig, verbucheFoto } from '../fach/sitzungen.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { warteAufNeueDatei } from '../fach/aufnahme.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import { Betrieb } from '../betrieb.js';
import { registriereOeffentlich } from '../routen/oeffentlich.js';
import { haerteOeffentlich, schuetzeLokal } from '../sicherheit.js';
import { KALIBRIERUNG_VORGABE, type Veranstaltung } from '../../shared/typen.js';

/*
 * Die Galerie steht in einem WLAN, in dem fremde Handys haengen, und die
 * Verwaltung auf einem PC, auf dem vielleicht auch einmal im Internet gesurft
 * wird. Diese Tests stellen die Angriffe nach, gegen die beides dicht sein muss.
 */

let wurzel: ReturnType<typeof wurzelpfade>;
let oeffentlich: FastifyInstance;
let lokal: FastifyInstance;

async function eventMitBild(name: string, mitProbelauf = false) {
  const e0 = erstelleEvent({ name, datum: '2026-06-01' }, wurzel.events);
  aktualisiereEvent(e0.id, { einstellungen: { vorlagen: ['standard-1-quer'], galerieAktiv: true } });
  setzeStatus(e0.id, 'startbereit');
  let event = setzeStatus(e0.id, 'aktiv');
  const bild = await fotografiere(event);
  let probe: string | null = null;
  if (mitProbelauf) {
    event = setzeProbelauf(event.id, true);
    probe = await fotografiere(event);
    event = setzeProbelauf(event.id, false);
  }
  return { event, bild, probe };
}

async function fotografiere(event: Veranstaltung): Promise<string> {
  const kamera = new MockKamera();
  const pfade = eventpfade(event.ordner, event.probelauf);
  await kamera.setzeZielordner(pfade.originale);
  const sitzung = starteSitzung(event, 'standard-1-quer');
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

beforeAll(async () => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-sicherheit-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeEingebauteFilterAn();
  legeStandardvorlagenAn();

  const betrieb = new Betrieb({ echteHardware: false, mockDruckOrdner: join(datenpfad, 'mock') });
  oeffentlich = Fastify();
  haerteOeffentlich(oeffentlich);
  registriereOeffentlich(oeffentlich, betrieb);

  lokal = Fastify();
  schuetzeLokal(lokal);
  lokal.get('/api/admin/events', async () => ['geheim']);
  lokal.post('/api/kiosk/service/fortsetzen', async () => ({ ok: true }));
});

afterAll(async () => {
  await oeffentlich.close();
  await lokal.close();
  schliesseDb();
});

describe('Galerie im WLAN', () => {
  let alt: Awaited<ReturnType<typeof eventMitBild>>;
  let neu: Awaited<ReturnType<typeof eventMitBild>>;

  beforeAll(async () => {
    // Die Hochzeit vom letzten Wochenende ist vorbei, heute laeuft der
    // Geburtstag - im selben Reise-Router-WLAN, mit demselben WLAN-Passwort.
    alt = await eventMitBild('Hochzeit letzte Woche');
    setzeStatus(alt.event.id, 'abgeschlossen');
    neu = await eventMitBild('Geburtstag heute', true);
  });

  it('zeigt die laufende Veranstaltung', async () => {
    const r = await oeffentlich.inject(`/api/galerie/${neu.event.galerieToken}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().bilder).toHaveLength(1);
  });

  it('der Link einer vergangenen Veranstaltung zeigt nichts mehr', async () => {
    expect((await oeffentlich.inject(`/api/galerie/${alt.event.galerieToken}`)).statusCode).toBe(404);
    expect(
      (await oeffentlich.inject(`/medien/galerie/${alt.event.galerieToken}/${alt.bild}.jpg`)).statusCode,
    ).toBe(404);
    expect(
      (await oeffentlich.inject(`/medien/download/${alt.event.galerieToken}/${alt.bild}.jpg`)).statusCode,
    ).toBe(404);
    expect((await oeffentlich.inject(`/api/status/${alt.event.statusToken}`)).statusCode).toBe(404);
  });

  it('ein Bild einer anderen Veranstaltung gibt es auch mit gueltigem Token nicht', async () => {
    const r = await oeffentlich.inject(`/medien/download/${neu.event.galerieToken}/${alt.bild}.jpg`);
    expect(r.statusCode).toBe(404);
  });

  it('Probelauf-Bilder bleiben draussen - auch ueber den Download', async () => {
    for (const art of ['galerie', 'download']) {
      const r = await oeffentlich.inject(`/medien/${art}/${neu.event.galerieToken}/${neu.probe}.jpg`);
      expect(r.statusCode, art).toBe(404);
    }
  });

  it('ein aus der Galerie genommenes Bild ist nirgends mehr abrufbar', async () => {
    const zweites = await fotografiere(neu.event);
    holeDb().prepare('UPDATE ausgaben SET verborgen = 1 WHERE id = ?').run(zweites);
    const liste = (await oeffentlich.inject(`/api/galerie/${neu.event.galerieToken}`)).json();
    expect(liste.bilder.map((b: { id: string }) => b.id)).not.toContain(zweites);
    for (const art of ['galerie', 'download']) {
      const r = await oeffentlich.inject(`/medien/${art}/${neu.event.galerieToken}/${zweites}.jpg`);
      expect(r.statusCode, art).toBe(404);
    }
  });

  it('liefert Bilder ohne Kamera-Metadaten', async () => {
    const r = await oeffentlich.inject(`/medien/download/${neu.event.galerieToken}/${neu.bild}.jpg`);
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.includes(Buffer.from('Exif'))).toBe(false);
  });

  it('setzt Sicherheits-Kopfzeilen', async () => {
    const r = await oeffentlich.inject(`/api/galerie/${neu.event.galerieToken}`);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('bietet keinen QR-Generator nach aussen an', async () => {
    expect((await oeffentlich.inject('/api/qr?text=x')).statusCode).toBe(404);
  });
});

describe('Verwaltung gegen fremde Webseiten', () => {
  it('antwortet nur unter localhost - DNS-Rebinding laeuft ins Leere', async () => {
    const boese = await lokal.inject({ url: '/api/admin/events', headers: { host: 'boese.example:8787' } });
    expect(boese.statusCode).toBe(403);
    const gut = await lokal.inject({ url: '/api/admin/events', headers: { host: '127.0.0.1:8787' } });
    expect(gut.statusCode).toBe(200);
    const vite = await lokal.inject({ url: '/api/admin/events', headers: { host: 'localhost:5173' } });
    expect(vite.statusCode).toBe(200);
  });

  it('lehnt schreibende Anfragen von fremden Seiten ab', async () => {
    const fremd = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/service/fortsetzen',
      headers: { host: '127.0.0.1:8787', origin: 'http://boese.example', 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(fremd.statusCode).toBe(403);
    const quer = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/service/fortsetzen',
      headers: { host: '127.0.0.1:8787', 'sec-fetch-site': 'cross-site' },
    });
    expect(quer.statusCode).toBe(403);
    const eigen = await lokal.inject({
      method: 'POST',
      url: '/api/kiosk/service/fortsetzen',
      headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'same-origin' },
    });
    expect(eigen.statusCode).toBe(200);
  });
});
