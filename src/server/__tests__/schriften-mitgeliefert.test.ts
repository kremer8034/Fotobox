import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listeSchriften, richteSchriftenEin } from '../fach/schriften.js';

describe('Mitgelieferte Hochzeitsschriften', () => {
  it('liegen nach dem Start im Schriftenordner - mit ihrem echten Familiennamen', () => {
    const daten = mkdtempSync(join(tmpdir(), 'fb-mitgeliefert-'));
    richteSchriftenEin(daten);
    const familien = listeSchriften(daten).map((s) => s.familie);
    expect(familien).toEqual(expect.arrayContaining(['Great Vibes', 'Parisienne', 'Pinyon Script']));
  });

  it('eine geloeschte kommt beim naechsten Start nicht zurueck', () => {
    const daten = mkdtempSync(join(tmpdir(), 'fb-mitgeliefert-'));
    const ordner = richteSchriftenEin(daten);
    rmSync(join(ordner, 'Parisienne-Regular.ttf'));
    richteSchriftenEin(daten);
    expect(existsSync(join(ordner, 'Parisienne-Regular.ttf'))).toBe(false);
    expect(existsSync(join(ordner, 'GreatVibes-Regular.ttf'))).toBe(true);
  });

  it('fehlt der Ordner mit den Schriften, startet die Box trotzdem', () => {
    const daten = mkdtempSync(join(tmpdir(), 'fb-mitgeliefert-'));
    expect(() => richteSchriftenEin(daten, join(daten, 'gibt-es-nicht'))).not.toThrow();
    expect(listeSchriften(daten)).toEqual([]);
  });
});
