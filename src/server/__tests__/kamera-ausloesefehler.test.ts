import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { wurzelpfade } from '../fach/pfade.js';
import { Betrieb } from '../betrieb.js';
import {
  deuteKamerafehler,
  leseKamerafehler,
  protokollKandidaten,
  zeilenSeit,
} from '../treiber/digicamcontrol-protokoll.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import type { KameraTreiber } from '../treiber/kamera.js';

/** Zeitstempel im Format von log4net, in Ortszeit. */
function stempel(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())},123`;
}

describe('digiCamControl-Protokoll deuten', () => {
  it('erkennt den Autofokus als Grund - als Name und als Zahl', () => {
    expect(deuteKamerafehler(['[ERROR] Capture error EDS_ERR_TAKE_PICTURE_AF_NG'])?.hinweis).toMatch(/MF/);
    expect(deuteKamerafehler(['ERROR Error occurred :0x00008D01'])?.hinweis).toMatch(/Autofokus/);
    expect(deuteKamerafehler(['ERROR Canon error 36097'])?.hinweis).toMatch(/Autofokus/);
  });

  it('unterscheidet fehlende, volle und gesperrte Speicherkarte', () => {
    expect(deuteKamerafehler(['ERROR TAKE_PICTURE_NO_CARD_NG'])?.hinweis).toMatch(/ohne Speicherkarte/);
    expect(deuteKamerafehler(['ERROR TAKE_PICTURE_CARD_NG'])?.hinweis).toMatch(/voll oder fehlerhaft/);
    expect(deuteKamerafehler(['ERROR TAKE_PICTURE_CARD_PROTECT_NG'])?.hinweis).toMatch(/schreibgeschützt/);
  });

  it('ohne Fehlerzeile kein Befund, unbekannter Fehler wird wörtlich weitergegeben', () => {
    expect(deuteKamerafehler(['INFO Capture started', 'INFO Transfer done'])).toBeNull();
    const unbekannt = deuteKamerafehler(['2026-10-16 19:00:00,001 [ERROR] Something odd happened']);
    expect(unbekannt?.hinweis).toBeNull();
    expect(unbekannt?.zeile).toBe('[ERROR] Something odd happened');
  });

  it('nimmt nur Zeilen seit dem Auslösen - ältere Fehler zählen nicht', () => {
    const jetzt = new Date();
    const alt = new Date(jetzt.getTime() - 10 * 60_000);
    const text = [
      `${stempel(alt)} [ERROR] TAKE_PICTURE_AF_NG`,
      `${stempel(jetzt)} [INFO] Capture`,
      `${stempel(jetzt)} [ERROR] TAKE_PICTURE_CARD_NG`,
      '   bei Fortsetzungszeile ohne Zeitstempel',
    ].join('\r\n');
    const zeilen = zeilenSeit(text, jetzt.getTime());
    expect(zeilen).toHaveLength(3);
    expect(deuteKamerafehler(zeilen)?.hinweis).toMatch(/voll/);
  });

  it('liest das Ende der Protokolldatei unter ProgramData', async () => {
    const programData = mkdtempSync(join(tmpdir(), 'fotobox-dcc-log-'));
    const ordner = join(programData, 'digiCamControl', 'Log');
    mkdirSync(ordner, { recursive: true });
    const jetzt = new Date();
    // Viel alter Inhalt davor - gelesen wird nur das Ende.
    const fueller = `${stempel(new Date(jetzt.getTime() - 3_600_000))} [INFO] ${'x'.repeat(200)}\n`.repeat(500);
    writeFileSync(join(ordner, 'app.log'), `${fueller}${stempel(jetzt)} [ERROR] EDS_ERR_TAKE_PICTURE_AF_NG\n`);
    const kandidaten = protokollKandidaten({ ProgramData: programData });
    const befund = await leseKamerafehler(jetzt.getTime(), kandidaten);
    expect(befund?.hinweis).toMatch(/Autofokus/);
    // Keine Datei: kein Befund, kein Fehler.
    expect(await leseKamerafehler(jetzt.getTime(), [join(programData, 'fehlt.log')])).toBeNull();
  });
});

describe('Fotos, die nicht ankommen', () => {
  let betrieb: Betrieb;
  type Ursache = { hinweis: string | null; zeile: string } | null;
  let kamera: MockKamera & { ursache: Ursache; fehlerSeit?: KameraTreiber['fehlerSeit'] };
  let neustarts = 0;

  beforeAll(() => {
    const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-ausloesefehler-'));
    oeffneDb(wurzelpfade(datenpfad).db);
    schreibeGeraet({ datenpfad });
  });
  afterAll(() => schliesseDb());

  function neu() {
    betrieb = new Betrieb({ echteHardware: false, mockDruckOrdner: join(tmpdir(), 'fotobox-af-druck') });
    kamera = Object.assign(new MockKamera(), { ursache: null as Ursache });
    kamera.fehlerSeit = async () => kamera.ursache;
    betrieb.kamera = kamera;
    neustarts = 0;
    // Den digiCamControl-Waechter gibt es nur unter Windows - hier ein Zaehler.
    (betrieb as unknown as { kameraProgramm: unknown }).kameraProgramm = {
      pruefe: async () => 'nichts',
      erzwingeNeustart: async () => {
        neustarts += 1;
        return true;
      },
    };
  }

  it('zweimal nacheinander ohne Grund: digiCamControl wird neu gestartet - aber nicht im Dauerfeuer', async () => {
    neu();
    await betrieb.nachFehlaufnahme();
    expect(neustarts).toBe(0);
    await betrieb.nachFehlaufnahme();
    expect(neustarts).toBe(1);
    await betrieb.nachFehlaufnahme();
    expect(neustarts).toBe(1);
  });

  it('ein Foto dazwischen setzt die Zählung zurück', async () => {
    neu();
    await betrieb.nachFehlaufnahme();
    betrieb.aufnahmeGeklappt();
    await betrieb.nachFehlaufnahme();
    expect(neustarts).toBe(0);
  });

  it('Autofokus oder Speicherkarte: kein Neustart, aber ein Hinweis in der Verwaltung', async () => {
    neu();
    kamera.ursache = { hinweis: 'Die Speicherkarte der Kamera ist voll oder fehlerhaft.', zeile: 'TAKE_PICTURE_CARD_NG' };
    const text1 = await betrieb.nachFehlaufnahme();
    await betrieb.nachFehlaufnahme();
    expect(neustarts).toBe(0);
    expect(text1).toContain('digiCamControl: TAKE_PICTURE_CARD_NG');
    // Die Kamera gilt als verbunden - der Hinweis steht trotzdem da. (Den
    // Zustand setzt sonst die Beobachtungsschleife, die hier nicht laeuft.)
    (betrieb as unknown as { kameraOk: boolean }).kameraOk = true;
    const status = await betrieb.status();
    expect(status.kameraHinweis ?? '').toContain('Speicherkarte');
    betrieb.aufnahmeGeklappt();
  });

  it('ohne verbundene Kamera wird nichts neu gestartet - das ist ein Kabel', async () => {
    neu();
    kamera.abgesteckt = true;
    await betrieb.nachFehlaufnahme();
    await betrieb.nachFehlaufnahme();
    expect(neustarts).toBe(0);
  });
});
