import { describe, expect, it } from 'vitest';
import { deuteStatus, deuteDruckerliste, druckerVorschlag, WindowsDrucker } from '../treiber/drucker-windows.js';
import { druckerBlockiert } from '../treiber/drucker.js';

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

describe('Druckerauswahl', () => {
  // So liefert PowerShell die Liste: mehrere Drucker als Feld, einer als Objekt.
  const windows = JSON.stringify([
    { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', WorkOffline: false },
    { Name: 'DS-RX1HS', DriverName: 'DS-RX1HS', PortName: 'USB001', WorkOffline: false },
    { Name: 'OneNote (Desktop)', DriverName: 'Send to Microsoft OneNote 16 Driver', PortName: 'nul:', WorkOffline: false },
  ]);

  it('listet alle Drucker, den DNP zuerst und markiert', () => {
    const liste = deuteDruckerliste(windows);
    expect(liste.map((d) => d.name)).toEqual(['DS-RX1HS', 'Microsoft Print to PDF', 'OneNote (Desktop)']);
    expect(liste[0]).toMatchObject({ dnp: true, anschluss: 'USB001' });
    expect(liste.filter((d) => d.dnp)).toHaveLength(1);
  });

  it('versteht auch einen einzelnen Drucker und eine leere Antwort', () => {
    expect(deuteDruckerliste(JSON.stringify({ Name: 'DS-RX1', DriverName: 'DNP DS-RX1', WorkOffline: true }))).toEqual([
      { name: 'DS-RX1', treiber: 'DNP DS-RX1', anschluss: '', offline: true, dnp: true },
    ]);
    expect(deuteDruckerliste('')).toEqual([]);
  });

  it('schlaegt den DNP vor, wenn der eingetragene Name in Windows nicht existiert', () => {
    const liste = deuteDruckerliste(windows);
    expect(druckerVorschlag('DS-RX1', liste)).toBe('DS-RX1HS');
    expect(druckerVorschlag('', liste)).toBe('DS-RX1HS');
    // Ein vorhandener, bewusst gewaehlter Drucker bleibt.
    expect(druckerVorschlag('Microsoft Print to PDF', liste)).toBeNull();
  });

  it('raet nicht, wenn es keinen oder mehrere DNP-Drucker gibt', () => {
    const ohne = deuteDruckerliste(JSON.stringify([{ Name: 'Microsoft Print to PDF', DriverName: 'x' }]));
    expect(druckerVorschlag('DS-RX1', ohne)).toBeNull();
    const zwei = deuteDruckerliste(
      JSON.stringify([
        { Name: 'DS-RX1HS', DriverName: 'DS-RX1HS' },
        { Name: 'DS-RX1HS (Kopie 1)', DriverName: 'DS-RX1HS' },
      ]),
    );
    expect(druckerVorschlag('DS-RX1', zwei)).toBeNull();
  });
});

describe('Ohne gewaehlten Drucker', () => {
  // An der Box direkt nach einem Update: Der Server lief schon, der Drucker
  // war noch nicht eingetragen. Die Auftraege scheiterten und die Warteschlange
  // blieb angehalten. Jetzt warten sie, bis ein Drucker da ist.
  it('gilt als blockiert, damit Auftraege warten statt zu scheitern', async () => {
    const status = await new WindowsDrucker('', '').pruefe();
    expect(druckerBlockiert(status.zustand)).toBe(true);
  });
});
