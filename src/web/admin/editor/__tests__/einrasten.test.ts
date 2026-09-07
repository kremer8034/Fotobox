import { describe, expect, it } from 'vitest';
import { begrenze, raste, richteAus, verteile, type Rechteck } from '../einrasten.js';

const TOLERANZ = 0.02;

describe('Einrasten', () => {
  it('rastet die linke Kante an der Leinwand ein', () => {
    const ergebnis = raste({ x: 0.008, y: 0.4, w: 0.3, h: 0.2 }, [], TOLERANZ);
    expect(ergebnis.x).toBeCloseTo(0, 5);
    expect(ergebnis.hilfslinienX).toContain(0);
  });

  it('rastet die Mitte an der Leinwandmitte ein', () => {
    // Mitte laege bei 0.34 + 0.16 = 0.50 - das soll greifen.
    const ergebnis = raste({ x: 0.345, y: 0.1, w: 0.32, h: 0.2 }, [], TOLERANZ);
    expect(ergebnis.x + 0.16).toBeCloseTo(0.5, 3);
  });

  it('rastet an der Kante einer anderen Ebene ein', () => {
    const andere: Rechteck[] = [{ x: 0.2, y: 0.1, w: 0.3, h: 0.2 }];
    // Linke Kante bei 0.205 soll auf 0.2 der anderen Ebene springen.
    const ergebnis = raste({ x: 0.205, y: 0.5, w: 0.25, h: 0.2 }, andere, TOLERANZ);
    expect(ergebnis.x).toBeCloseTo(0.2, 5);
  });

  it('laesst weit entfernte Werte in Ruhe', () => {
    const ergebnis = raste({ x: 0.31, y: 0.37, w: 0.2, h: 0.2 }, [], 0.005);
    expect(ergebnis.x).toBeCloseTo(0.31, 5);
    expect(ergebnis.hilfslinienX).toHaveLength(0);
  });
});

describe('Grenzen', () => {
  it('haelt eine Mindestgroesse ein, damit nichts unsichtbar wird', () => {
    const r = begrenze({ x: 0.5, y: 0.5, w: -0.4, h: 0 });
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });

  it('laesst bewusstes Ueberstehen zu, ohne alles einzusperren', () => {
    // Ein Hintergrundbild darf ueber den Rand hinausragen - randloser Druck
    // beschneidet ohnehin.
    const r = begrenze({ x: -0.1, y: -0.1, w: 1.2, h: 1.2 });
    expect(r.x).toBeCloseTo(-0.1, 5);
    expect(r.w).toBeCloseTo(1.2, 5);
  });
});

describe('Ausrichten', () => {
  it('zentriert waagerecht auf der Leinwand', () => {
    const r = richteAus({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, 'mitte-x');
    expect(r.x).toBeCloseTo(0.3, 5);
    expect(r.y).toBeCloseTo(0.2, 5);
  });

  it('setzt an die untere Kante', () => {
    const r = richteAus({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, 'unten');
    expect(r.y + r.h).toBeCloseTo(1, 5);
  });
});

describe('Verteilen', () => {
  it('setzt gleiche Abstaende zwischen drei Ebenen', () => {
    const ebenen = [
      { id: 'a', x: 0, y: 0, w: 0.2, h: 0.2 },
      { id: 'b', x: 0.5, y: 0, w: 0.2, h: 0.2 },
      { id: 'c', x: 0.8, y: 0, w: 0.2, h: 0.2 },
    ];
    const verteilt = verteile(ebenen, 'x');
    const luecke1 = verteilt[1]!.x - (verteilt[0]!.x + verteilt[0]!.w);
    const luecke2 = verteilt[2]!.x - (verteilt[1]!.x + verteilt[1]!.w);
    expect(luecke1).toBeCloseTo(luecke2, 6);
    // Aussenkanten bleiben, wo sie waren.
    expect(verteilt[0]!.x).toBeCloseTo(0, 5);
    expect(verteilt[2]!.x + verteilt[2]!.w).toBeCloseTo(1, 5);
  });

  it('laesst weniger als drei Ebenen unveraendert', () => {
    const ebenen = [
      { id: 'a', x: 0, y: 0, w: 0.2, h: 0.2 },
      { id: 'b', x: 0.7, y: 0, w: 0.2, h: 0.2 },
    ];
    expect(verteile(ebenen, 'x')).toEqual(ebenen);
  });
});
