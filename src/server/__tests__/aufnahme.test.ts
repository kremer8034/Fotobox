import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { schreibeGeraet } from '../db/geraet.js';
import { legeStandardvorlagenAn } from '../fach/vorlagen.js';
import { aktualisiereEvent, erstelleEvent } from '../fach/events.js';
import { bestaetigungsbild, starteSitzung, verbucheFoto, zahlDerFotos } from '../fach/sitzungen.js';
import { wurzelpfade } from '../fach/pfade.js';

/** Aufnahmeablauf: ein Platz, ein Foto - und die Bestaetigung zeigt genau dieses. */

let wurzel: ReturnType<typeof wurzelpfade>;
let eingang: string;

beforeAll(() => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-aufnahme-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  schreibeGeraet({ datenpfad });
  legeStandardvorlagenAn();
  eingang = join(datenpfad, 'eingang');
  mkdirSync(eingang, { recursive: true });
});
afterAll(() => schliesseDb());

let nummer = 0;
async function kamerabild(farbe: { r: number; g: number; b: number }): Promise<string> {
  nummer += 1;
  const pfad = join(eingang, `IMG_${nummer}.jpg`);
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: farbe } }).jpeg().toFile(pfad);
  return pfad;
}

describe('Fotos einer Sitzung', () => {
  it('hält je Platz genau ein Foto, auch wenn noch einmal ausgelöst wurde', async () => {
    const e = aktualisiereEvent(erstelleEvent({ name: 'Sommerfest', datum: '2026-07-01' }, wurzel.events).id, {
      einstellungen: { vorlagen: ['standard-2-quer'] },
    });
    const sitzung = starteSitzung(e, 'standard-2-quer');

    await verbucheFoto(sitzung, e, await kamerabild({ r: 200, g: 0, b: 0 }), 1);
    // Die Antwort ging verloren, der Kiosk loest fuer Platz 1 noch einmal aus.
    await verbucheFoto(sitzung, e, await kamerabild({ r: 0, g: 0, b: 200 }), 1);

    const zeilen = holeDb().prepare('SELECT ebene_index FROM fotos WHERE sitzung_id = ?').all(sitzung.id);
    expect(zeilen).toHaveLength(1);
    expect(zahlDerFotos(sitzung.id)).toBe(1);

    await verbucheFoto(sitzung, e, await kamerabild({ r: 0, g: 200, b: 0 }), 2);
    expect(zahlDerFotos(sitzung.id)).toBe(2);
  });

  it('zeigt zur Bestätigung das aufgenommene Foto, klein genug für den Bildschirm', async () => {
    const e = aktualisiereEvent(erstelleEvent({ name: 'Taufe', datum: '2026-07-02' }, wurzel.events).id, {
      einstellungen: { vorlagen: ['standard-1-quer'] },
    });
    const sitzung = starteSitzung(e, 'standard-1-quer');
    expect(await bestaetigungsbild(sitzung.id, 1)).toBeNull();

    await verbucheFoto(sitzung, e, await kamerabild({ r: 10, g: 20, b: 230 }), 1);
    const bild = await bestaetigungsbild(sitzung.id, 1);
    expect(bild).not.toBeNull();
    const info = await sharp(bild!).metadata();
    expect(Math.max(info.width!, info.height!)).toBeLessThanOrEqual(1600);
    const { dominant } = await sharp(bild!).stats();
    // Blau wie das Kamerabild - nicht ein Standbild des Live-Views.
    expect(dominant.b).toBeGreaterThan(180);
    expect(dominant.r).toBeLessThan(60);
  });
});
