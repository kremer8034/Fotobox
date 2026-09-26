import { describe, expect, it } from 'vitest';
import { cameraControlExe, DigiCamControlWaechter, type ProzessSteuerung } from '../treiber/digicamcontrol-waechter.js';

function steuerung(laeuftAnfangs: boolean) {
  const s = {
    uhr: 0,
    laeuftJetzt: laeuftAnfangs,
    starts: 0,
    beendet: 0,
    async laeuft() {
      return s.laeuftJetzt;
    },
    starte() {
      s.starts += 1;
      s.laeuftJetzt = true;
    },
    async beende() {
      s.beendet += 1;
      s.laeuftJetzt = false;
    },
    jetzt: () => s.uhr,
  };
  return s satisfies ProzessSteuerung & Record<string, unknown>;
}

describe('digiCamControl-Waechter', () => {
  it('startet das Programm, wenn es nicht laeuft - aber nicht im Sekundentakt', async () => {
    const s = steuerung(false);
    const w = new DigiCamControlWaechter(s, () => true);
    expect(await w.pruefe(false)).toBe('gestartet');
    s.laeuftJetzt = false; // stuerzt gleich wieder ab
    s.uhr += 3000;
    expect(await w.pruefe(false)).toBe('nichts');
    s.uhr += 60_000;
    expect(await w.pruefe(false)).toBe('gestartet');
    expect(s.starts).toBe(2);
  });

  it('startet ein haengendes Programm nach zwei Minuten neu', async () => {
    const s = steuerung(true);
    const w = new DigiCamControlWaechter(s, () => true);
    for (let t = 0; t < 119_000; t += 3000) {
      s.uhr = t;
      expect(await w.pruefe(false)).toBe('nichts');
    }
    s.uhr = 121_000;
    expect(await w.pruefe(false)).toBe('neu-gestartet');
    expect(s.beendet).toBe(1);
  });

  it('laesst ein antwortendes Programm in Ruhe, auch wenn die Kamera fehlt', async () => {
    const s = steuerung(true);
    const w = new DigiCamControlWaechter(s, () => true);
    for (let t = 0; t < 600_000; t += 3000) {
      s.uhr = t;
      expect(await w.pruefe(true)).toBe('nichts');
    }
    expect(s.starts + s.beendet).toBe(0);
  });

  it('meldet, wenn das Programm gar nicht installiert ist', async () => {
    const w = new DigiCamControlWaechter(steuerung(false), () => false);
    expect(await w.pruefe(false)).toBe('programm-fehlt');
  });

  it('versteht Ordner und Datei als Pfadangabe', () => {
    expect(cameraControlExe('C:\\Programme\\digiCamControl')).toMatch(/digiCamControl[\\/]CameraControl\.exe$/);
    expect(cameraControlExe('C:\\Programme\\digiCamControl\\CameraControl.exe')).toBe(
      'C:\\Programme\\digiCamControl\\CameraControl.exe',
    );
  });
});
