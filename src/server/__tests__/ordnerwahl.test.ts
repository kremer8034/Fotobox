import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deuteLaufwerke, gueltigerOrdnername, legeOrdnerAn, listeOrdner } from '../fach/ordnerwahl.js';
import { galerieBlockiert } from '../netzwerk.js';

describe('Ordnerauswahl fuer die Uebergabe', () => {
  it('zeigt USB-Sticks zuerst und benennt sie verstaendlich', () => {
    const json = JSON.stringify([
      { DeviceID: 'C:', VolumeName: 'Windows', DriveType: 3, FreeSpace: 120 * 1024 ** 3 },
      { DeviceID: 'E:', VolumeName: 'SANDISK', DriveType: 2, FreeSpace: 30 * 1024 ** 3 },
    ]);
    const liste = deuteLaufwerke(json);
    expect(liste[0]).toMatchObject({ pfad: 'E:\\', wechsel: true, freiGb: 30 });
    expect(liste[0]!.name).toBe('USB-Stick / Wechseldatenträger (E:) – SANDISK');
    expect(liste[1]!.name).toBe('Festplatte (C:) – Windows');
    // Ein einzelnes Laufwerk kommt von PowerShell als Objekt, nicht als Liste.
    expect(deuteLaufwerke(JSON.stringify({ DeviceID: 'D:', DriveType: 3 }))).toHaveLength(1);
  });

  it('listet Unterordner ohne versteckte und Systemordner', async () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'fotobox-ordner-'));
    for (const n of ['Fotos', '.versteckt', '$RECYCLE.BIN', 'System Volume Information', 'alt']) {
      mkdirSync(join(wurzel, n));
    }
    const liste = await listeOrdner(wurzel);
    expect(liste.ordner.map((o) => o.name)).toEqual(['alt', 'Fotos']);
    expect(liste.oben).not.toBeNull();
  });

  it('legt einen neuen Ordner an und lehnt unbrauchbare Namen ab', async () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'fotobox-neu-'));
    const neu = await legeOrdnerAn(wurzel, 'Hochzeit Mueller');
    expect(existsSync(neu)).toBe(true);
    // Gibt es ihn schon, ist das kein Fehler.
    await expect(legeOrdnerAn(wurzel, 'Hochzeit Mueller')).resolves.toBe(neu);
    expect(gueltigerOrdnername('a/b')).toBe(false);
    expect(gueltigerOrdnername('Fotos?')).toBe(false);
    expect(gueltigerOrdnername('endet mit Punkt.')).toBe(false);
    expect(gueltigerOrdnername('  ')).toBe(false);
    await expect(legeOrdnerAn(wurzel, 'x:y')).rejects.toThrow(/Ordnername/);
  });
});

describe('Galerie hinter der Windows-Firewall', () => {
  const basis = { netz: 'Fotobox-WLAN', adapter: 'WLAN', regel: true };

  it('erkennt: oeffentliches Netz, Freigabe nur privat - die Handys kommen nicht durch', () => {
    const text = galerieBlockiert({ ...basis, kategorie: 'Public', regelProfile: 'Private' });
    expect(text).toMatch(/öffentlich/);
    expect(text).toMatch(/Fotobox-WLAN/);
  });

  it('laesst durch, wenn die Freigabe fuer alle Profile gilt oder das Netz privat ist', () => {
    expect(galerieBlockiert({ ...basis, kategorie: 'Public', regelProfile: 'Any' })).toBeNull();
    expect(galerieBlockiert({ ...basis, kategorie: 'Private', regelProfile: 'Private' })).toBeNull();
  });

  it('meldet eine fehlende Freigabe', () => {
    expect(galerieBlockiert({ ...basis, regel: false, kategorie: 'Private', regelProfile: null })).toMatch(/fehlt/);
  });
});
