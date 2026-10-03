import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deuteDnpAntwort, deuteDnpStatus, dllBitbreite, findeCspStat } from '../treiber/dnp-vorrat.js';

/** Ein minimaler PE-Kopf, wie ihn jede Windows-DLL traegt. */
function peDatei(maschine: number): Buffer {
  const kopf = Buffer.alloc(512);
  kopf.write('MZ', 0, 'latin1');
  kopf.writeUInt32LE(0x80, 0x3c);
  kopf.write('PE\0\0', 0x80, 'latin1');
  kopf.writeUInt16LE(maschine, 0x84);
  return kopf;
}

describe('CspStat.dll von DNP PrinterInfo', () => {
  it('findet die DLL im PrinterInfo-Ordner, egal wie sie geschrieben ist', () => {
    const wurzel = mkdtempSync(join(tmpdir(), 'fotobox-dnp-'));
    mkdirSync(join(wurzel, 'DNPIA', 'PrinterInfo'), { recursive: true });
    const datei = join(wurzel, 'DNPIA', 'PrinterInfo', 'CSPSTAT.DLL');
    writeFileSync(datei, peDatei(0x14c));
    expect(findeCspStat([join(wurzel, 'gibtesnicht'), join(wurzel, 'DNPIA')])).toBe(datei);
    expect(findeCspStat([join(wurzel, 'gibtesnicht')])).toBeNull();
  });

  it('erkennt 32- und 64-Bit-DLLs am Dateikopf', () => {
    const ordner = mkdtempSync(join(tmpdir(), 'fotobox-pe-'));
    const d32 = join(ordner, 'a.dll');
    const d64 = join(ordner, 'b.dll');
    const kaputt = join(ordner, 'c.dll');
    writeFileSync(d32, peDatei(0x14c));
    writeFileSync(d64, peDatei(0x8664));
    writeFileSync(kaputt, 'keine dll');
    expect(dllBitbreite(d32)).toBe(32);
    expect(dllBitbreite(d64)).toBe(64);
    expect(dllBitbreite(kaputt)).toBeNull();
    expect(dllBitbreite(join(ordner, 'fehlt.dll'))).toBeNull();
  });

  it('deutet die Antwort der Abfrage', () => {
    // So wie auf der Box: ein RX1, 461 von 700 Blatt, bereit.
    expect(deuteDnpAntwort('1;0;461;700;65537\r\n')).toEqual({ rest: 461, gesamt: 700, status: 0x10001, port: 0 });
    // Aeltere DLL ohne GetInitialMediaCount und GetStatus.
    expect(deuteDnpAntwort('1;0;120;-1;-1')).toEqual({ rest: 120, gesamt: null, status: null, port: 0 });
    expect(() => deuteDnpAntwort('1;0;-1;-1;-1')).toThrow(/keinen Vorrat/);
    expect(() => deuteDnpAntwort('Kauderwelsch')).toThrow(/Unerwartete Antwort/);
  });

  it('sagt in Worten, was der Drucker meldet', () => {
    expect(deuteDnpStatus(0x10001)).toBe('bereit');
    expect(deuteDnpStatus(0x10008)).toBe('Papier zu Ende');
    expect(deuteDnpStatus(0x10010)).toBe('Farbband zu Ende');
    expect(deuteDnpStatus(0x20001)).toBe('Klappe offen');
    expect(deuteDnpStatus(0x20002)).toBe('Papierstau');
    expect(deuteDnpStatus(0x40003)).toMatch(/Hardware-Fehler/);
    expect(deuteDnpStatus(null)).toBeNull();
  });
});
