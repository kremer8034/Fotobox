import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Aktualisierer,
  lesePruefsumme,
  pruefeAufUpdate,
  vergleicheVersionen,
  type UpdateInfo,
} from '../fach/aktualisierung.js';

/** Ein nachgebautes GitHub: Adresse -> Antwort. */
function falschesGithub(antworten: Record<string, () => Response>): typeof fetch {
  return (async (adresse: string | URL | Request) => {
    const url = String(adresse);
    const antwort = antworten[url];
    if (!antwort) return new Response('nicht da', { status: 404 });
    return antwort();
  }) as typeof fetch;
}

const API = 'https://api.github.com/repos/kremer8034/fotobox/releases/latest';
const SETUP = 'https://github.com/kremer8034/fotobox/releases/download/v2.0.0/Fotobox-Setup-2.0.0.exe';
const SUMME = `${SETUP}.sha256`;

function release(tag = 'v2.0.0') {
  return Response.json({
    tag_name: tag,
    name: 'Fotobox 2.0',
    body: '- Neue Filter\n- Schnellerer Druck',
    published_at: '2026-10-01T10:00:00Z',
    assets: [
      { name: 'Fotobox-Setup-2.0.0.exe', browser_download_url: SETUP, size: 12 },
      { name: 'Fotobox-Setup-2.0.0.exe.sha256', browser_download_url: SUMME, size: 90 },
    ],
  });
}

describe('Versionen vergleichen', () => {
  it.each([
    ['2.0.0', '1.9.9', 1],
    ['1.10.0', '1.9.0', 1],
    ['v1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.0-beta.2', 1],
    ['1.0.0-beta.10', '1.0.0-beta.2', 1],
    ['1.0', '1.0.1', -1],
  ])('%s gegen %s', (a, b, erwartet) => {
    expect(vergleicheVersionen(a, b)).toBe(erwartet);
  });
});

describe('Nach Updates suchen', () => {
  it('findet eine neuere Version samt Setup-Datei und Prüfsumme', async () => {
    const info = await pruefeAufUpdate('1.0.0', falschesGithub({ [API]: () => release() }));
    expect(info.neuerVerfuegbar).toBe(true);
    expect(info.neueste).toBe('2.0.0');
    expect(info.setup?.url).toBe(SETUP);
    expect(info.pruefsummeUrl).toBe(SUMME);
    expect(info.hinweise).toContain('Neue Filter');
  });

  it('meldet nichts Neues, wenn die installierte Version aktuell ist', async () => {
    const info = await pruefeAufUpdate('2.0.0', falschesGithub({ [API]: () => release() }));
    expect(info.neuerVerfuegbar).toBe(false);
  });

  it('kommt ohne veröffentlichte Version aus', async () => {
    const info = await pruefeAufUpdate('1.0.0', falschesGithub({}));
    expect(info.neueste).toBeNull();
    expect(info.neuerVerfuegbar).toBe(false);
  });

  it('sagt ohne Internet klar, woran es liegt', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(pruefeAufUpdate('1.0.0', offline)).rejects.toThrow(/Internet/);
  });
});

describe('Update installieren', () => {
  const inhalt = Buffer.from('MZ-das-ist-ein-setup');
  const richtig = createHash('sha256').update(inhalt).digest('hex');

  async function info(): Promise<UpdateInfo> {
    return pruefeAufUpdate('1.0.0', falschesGithub({ [API]: () => release() }));
  }

  it('lädt, prüft die Prüfsumme und startet den Installer', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'fotobox-update-'));
    const gestartet: string[] = [];
    const a = new Aktualisierer({
      ordner,
      starten: true,
      abruf: falschesGithub({
        [SETUP]: () => new Response(inhalt),
        [SUMME]: () => new Response(`${richtig}  Fotobox-Setup-2.0.0.exe\n`),
      }),
      starteInstaller: (pfad) => gestartet.push(pfad),
    });
    await a.installiere(await info());
    expect(a.stand.phase).toBe('gestartet');
    expect(a.stand.geladen).toBe(inhalt.length);
    expect(gestartet).toEqual([join(ordner, 'Fotobox-Setup-2.0.0.exe')]);
  });

  it('verwirft eine beschädigte Datei und startet nichts', async () => {
    const ordner = mkdtempSync(join(tmpdir(), 'fotobox-update-'));
    const gestartet: string[] = [];
    const a = new Aktualisierer({
      ordner,
      starten: true,
      abruf: falschesGithub({
        [SETUP]: () => new Response(Buffer.from('manipuliert')),
        [SUMME]: () => new Response(richtig),
      }),
      starteInstaller: (pfad) => gestartet.push(pfad),
    });
    await expect(a.installiere(await info())).rejects.toThrow(/Prüfsumme/);
    expect(a.stand.phase).toBe('fehler');
    expect(gestartet).toHaveLength(0);
    expect(existsSync(join(ordner, 'Fotobox-Setup-2.0.0.exe'))).toBe(false);
  });

  it('installiert keine Version ohne Prüfsumme', async () => {
    const a = new Aktualisierer({ ordner: tmpdir(), starten: false });
    const ohne = { ...(await info()), pruefsummeUrl: null };
    await expect(a.installiere(ohne)).rejects.toThrow(/Prüfsumme/);
  });

  it('liest die Prüfsumme aus beiden üblichen Formaten', () => {
    expect(lesePruefsumme(`${richtig.toUpperCase()}  datei.exe`)).toBe(richtig);
    expect(lesePruefsumme(richtig)).toBe(richtig);
    expect(lesePruefsumme('kaputt')).toBeNull();
  });
});
