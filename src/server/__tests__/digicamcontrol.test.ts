import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { DigiCamControlKamera } from '../treiber/kamera-digicamcontrol.js';
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

  // So sah es an der echten Box aus: digiCamControl lief, die Kamera war
  // verbunden, aber der Webserver war aus. Die Box beendete das Programm alle
  // zwei Minuten und startete es neu - und jedes Mal sprang es vor den Kiosk.
  it('startet ein Programm, das nach dem eigenen Start nie antwortet, nicht endlos neu', async () => {
    const s = steuerung(false);
    const w = new DigiCamControlWaechter(s, () => true);
    expect(await w.pruefe(false)).toBe('gestartet');
    const massnahmen = new Set<string>();
    for (let t = 3000; t < 900_000; t += 3000) {
      s.uhr = t;
      massnahmen.add(await w.pruefe(false));
    }
    expect(massnahmen).toContain('webserver-aus');
    expect(massnahmen).not.toContain('neu-gestartet');
    expect(s.starts).toBe(1);
    expect(s.beendet).toBe(0);
  });

  it('versucht bei einem schon laufenden, stummen Programm genau einen Neustart', async () => {
    const s = steuerung(true);
    const w = new DigiCamControlWaechter(s, () => true);
    const massnahmen: string[] = [];
    for (let t = 0; t < 900_000; t += 3000) {
      s.uhr = t;
      massnahmen.push(await w.pruefe(false));
    }
    expect(massnahmen.filter((m) => m === 'neu-gestartet')).toHaveLength(1);
    expect(massnahmen.at(-1)).toBe('webserver-aus');
  });

  it('startet neu, wenn ein Programm, das schon geantwortet hat, haengen bleibt', async () => {
    const s = steuerung(false);
    const w = new DigiCamControlWaechter(s, () => true);
    expect(await w.pruefe(false)).toBe('gestartet');
    s.uhr = 20_000;
    expect(await w.pruefe(true)).toBe('nichts');
    let ergebnis = 'nichts';
    for (let t = 23_000; t < 200_000 && ergebnis === 'nichts'; t += 3000) {
      s.uhr = t;
      ergebnis = await w.pruefe(false);
    }
    expect(ergebnis).toBe('neu-gestartet');
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

describe('digiCamControl-Kamera', () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>((fertig) => (server ? server.close(() => fertig()) : fertig())));

  /** Ein nachgebauter digiCamControl-Webserver - wie das Original nur auf IPv4. */
  async function webserver(antwort: (url: string) => { status?: number; text: string }): Promise<string> {
    server = createServer((anfrage, ergebnis) => {
      const a = antwort(anfrage.url ?? '');
      ergebnis.writeHead(a.status ?? 200, { 'content-type': 'text/html' });
      ergebnis.end(a.text);
    });
    await new Promise<void>((bereit) => server!.listen(0, '127.0.0.1', bereit));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('spricht digiCamControl ueber 127.0.0.1 an, nicht ueber localhost', () => {
    expect((new DigiCamControlKamera() as unknown as { basis: string }).basis).toBe('http://127.0.0.1:5513');
  });

  it('erkennt eine verbundene Kamera an ihrer Seriennummer', async () => {
    const kamera = new DigiCamControlKamera(
      await webserver((url) => ({ text: url.includes('slc=list&param1=cameras') ? '083071234567\n' : '' })),
    );
    expect(await kamera.pruefe()).toMatchObject({ verbunden: true, antwortet: true });
  });

  it('unterscheidet "keine Kamera" von "Befehle gesperrt"', async () => {
    const ohneKamera = new DigiCamControlKamera(await webserver(() => ({ text: 'OK' })));
    expect(await ohneKamera.pruefe()).toMatchObject({ verbunden: false, antwortet: true, grund: 'keine-kamera' });
    await new Promise<void>((fertig) => server!.close(() => fertig()));

    const gesperrt = new DigiCamControlKamera(await webserver(() => ({ text: '' })));
    expect(await gesperrt.pruefe()).toMatchObject({ verbunden: false, antwortet: true, grund: 'befehle-gesperrt' });
  });

  it('meldet "antwortet nicht", wenn niemand zuhoert', async () => {
    const basis = await webserver(() => ({ text: '' }));
    await new Promise<void>((fertig) => server!.close(() => fertig()));
    server = null;
    expect(await new DigiCamControlKamera(basis).pruefe()).toMatchObject({ antwortet: false, grund: 'antwortet-nicht' });
  });
});
