import { describe, expect, it } from 'vitest';
import { deuteStatus } from '../treiber/drucker-windows.js';

/**
 * Die Windows-Abfrage selbst laeuft nur unter Windows; ihre Antwort zu deuten
 * laesst sich ueberall pruefen - und dort steckt die eigentliche Logik.
 */
describe('Windows-Druckerstatus', () => {
  it('ruhiger Drucker ohne Auftraege ist bereit', () => {
    expect(deuteStatus('3;0;False;0;')).toEqual({ zustand: 'bereit', auftraegeBeimSystem: 0 });
  });

  it('erkennt leeres Papier am Drucker', () => {
    expect(deuteStatus('1;5;False;0;').zustand).toBe('papier-leer');
  });

  it('erkennt leeres Papier am haengenden Auftrag, wenn der Drucker selbst nichts meldet', () => {
    const s = deuteStatus('4;0;False;2;Error | Paper Out');
    expect(s.zustand).toBe('papier-leer');
    expect(s.auftraegeBeimSystem).toBe(2);
  });

  it('abgestecktes Kabel: offline', () => {
    expect(deuteStatus('7;0;False;1;').zustand).toBe('offline');
    expect(deuteStatus('3;0;True;0;').zustand).toBe('offline');
    expect(deuteStatus('fehlt').zustand).toBe('offline');
  });

  it('ein Auftrag im Fehlerzustand heisst: am Drucker klemmt etwas', () => {
    expect(deuteStatus('4;0;False;1;Error - Printing').zustand).toBe('klappe');
  });

  it('zaehlt die Auftraege bei Windows, waehrend gedruckt wird', () => {
    expect(deuteStatus('4;0;False;1;Printing')).toEqual({ zustand: 'bereit', auftraegeBeimSystem: 1 });
  });

  it('versteht auch die alte Antwort ohne Auftragsspalten', () => {
    expect(deuteStatus('3;0;False')).toEqual({ zustand: 'bereit', auftraegeBeimSystem: 0 });
  });
});
