import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { wurzelpfade } from '../fach/pfade.js';
import { Betrieb } from '../betrieb.js';
import type { KameraStatus, KameraTreiber } from '../treiber/kamera.js';

/**
 * Eine Kamera, deren Live-View haengt: verbunden, aber es kommt immer
 * dasselbe Bild - bis der Live-View neu gestartet wird.
 */
class HaengendeKamera implements KameraTreiber {
  readonly name = 'haengend';
  starts = 0;
  stopps = 0;
  haengt = true;
  private zaehler = 0;
  status: KameraStatus = { verbunden: true, antwortet: true, liveViewLaeuft: true };

  async pruefe() {
    return this.status;
  }
  async starteLiveView() {
    this.starts += 1;
  }
  async stoppeLiveView() {
    this.stopps += 1;
  }
  async liveBild() {
    if (this.haengt) return Buffer.from('immer dasselbe Bild');
    this.zaehler += 1;
    return Buffer.from(`frisches Bild ${this.zaehler}`);
  }
  async ausloesen() {}
  async setzeZielordner() {}
  async setzeBelichtung() {}
}

let betrieb: Betrieb;
let kamera: HaengendeKamera;

beforeAll(() => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-belebung-'));
  oeffneDb(wurzelpfade(datenpfad).db);
  schreibeGeraet({ datenpfad });
});

afterAll(() => schliesseDb());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  betrieb = new Betrieb({ echteHardware: false, mockDruckOrdner: join(tmpdir(), 'fotobox-belebung-druck') });
  kamera = new HaengendeKamera();
  betrieb.kamera = kamera;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('haengender Live-View', () => {
  it('wird nach acht Sekunden ohne frisches Bild neu gestartet - und nicht im Dauerfeuer', async () => {
    await betrieb.starteLiveView();
    expect(kamera.starts).toBe(1);
    // Das erste Bild zaehlt als frisch, danach kommt nur noch dasselbe.
    expect(await betrieb.liveBildDa()).toBe(true);

    // Sieben Sekunden Warten: noch kein Eingriff.
    await vi.advanceTimersByTimeAsync(7000);
    expect(await betrieb.liveBildDa()).toBe(false);
    expect(kamera.stopps).toBe(0);

    // Nach acht Sekunden: aus und wieder ein.
    await vi.advanceTimersByTimeAsync(2000);
    expect(await betrieb.liveBildDa()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(kamera.stopps).toBe(1);
    expect(kamera.starts).toBe(2);

    // Weiter eingefroren: der naechste Versuch fruehestens zehn Sekunden spaeter.
    await vi.advanceTimersByTimeAsync(5000);
    expect(await betrieb.liveBildDa()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(kamera.stopps).toBe(1);
  });

  it('kommt nach dem Neustart wieder ein Bild, ist die Kamera bereit', async () => {
    await betrieb.starteLiveView();
    await betrieb.liveBildDa();
    await vi.advanceTimersByTimeAsync(9000);
    expect(await betrieb.liveBildDa()).toBe(false);
    kamera.haengt = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(await betrieb.liveBildDa()).toBe(true);
  });

  it('nach einem Foto, das nicht ankam: Zustand ins Protokoll, Live-View sofort neu', async () => {
    await betrieb.starteLiveView();
    await betrieb.liveBildDa();
    const text = await betrieb.nachFehlaufnahme();
    expect(text).toContain('verbunden');
    expect(text).toContain('letztes Live-Bild vor');
    await vi.advanceTimersByTimeAsync(2000);
    expect(kamera.stopps).toBe(1);
    expect(kamera.starts).toBe(2);
  });

  it('ohne Kamera wird nichts neu gestartet - das ist ein Kabel, kein Haenger', async () => {
    kamera.status = { verbunden: false, antwortet: true, liveViewLaeuft: false, grund: 'keine-kamera' };
    const text = await betrieb.nachFehlaufnahme();
    expect(text).toContain('sieht aber keine Kamera');
    await vi.advanceTimersByTimeAsync(2000);
    expect(kamera.stopps).toBe(0);
  });

  it('Startbereit: liefert die Kamera kein Bild, faellt die Pruefung durch', async () => {
    const pruefung = betrieb.liveViewLiefert(3000);
    await vi.advanceTimersByTimeAsync(4000);
    // Ein erstes Bild ist noch "frisch" - danach friert es ein. Das reicht
    // fuer die Pruefung, denn sie fragt nur, ob ueberhaupt Bilder kommen.
    expect(await pruefung).toBe(true);

    kamera.haengt = true;
    const zweite = new Betrieb({ echteHardware: false, mockDruckOrdner: join(tmpdir(), 'fotobox-belebung-druck') });
    const leer = new HaengendeKamera();
    leer.liveBild = async () => null;
    zweite.kamera = leer;
    const ohneBild = zweite.liveViewLiefert(3000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await ohneBild).toBe(false);
    expect(leer.starts).toBe(1);
  });
});
