import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { KameraStatus, KameraTreiber } from './kamera.js';

/**
 * Reines Entwicklungs- und Testwerkzeug. Erzeugt farbige Testbilder im Format
 * der 600D, damit die komplette Software und alle automatisierten Tests ohne
 * angeschlossene Kamera laufen. Kein Betriebsmodus fuer Veranstaltungen.
 */
export class MockKamera implements KameraTreiber {
  readonly name = 'Mock-Kamera';
  private zielordner = '';
  private liveView = false;
  private zaehler = 0;

  async pruefe(): Promise<KameraStatus> {
    return { verbunden: true, liveViewLaeuft: this.liveView };
  }

  async starteLiveView(): Promise<void> {
    this.liveView = true;
  }

  async stoppeLiveView(): Promise<void> {
    this.liveView = false;
  }

  async liveBild(): Promise<Buffer | null> {
    if (!this.liveView) return null;
    // Ein langsam wandernder Farbverlauf, damit man im Browser sieht, dass der
    // Strom lebt und nicht ein Standbild haengt.
    const phase = (Date.now() / 3000) % 1;
    const r = Math.round(120 + 80 * Math.sin(phase * Math.PI * 2));
    const g = Math.round(120 + 80 * Math.sin(phase * Math.PI * 2 + 2));
    const b = Math.round(120 + 80 * Math.sin(phase * Math.PI * 2 + 4));
    return sharp({
      create: { width: 960, height: 640, channels: 3, background: { r, g, b } },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
  }

  async ausloesen(): Promise<void> {
    if (!this.zielordner) throw new Error('Kein Zielordner gesetzt.');
    mkdirSync(this.zielordner, { recursive: true });
    this.zaehler += 1;
    const nummer = this.zaehler;
    // 5184x3456 waere die echte 600D-Aufloesung; fuer Tests reicht ein Viertel
    // davon bei gleichem Seitenverhaeltnis 3:2.
    const bild = await sharp({
      create: {
        width: 1296,
        height: 864,
        channels: 3,
        background: { r: (nummer * 60) % 255, g: (nummer * 110) % 255, b: (nummer * 170) % 255 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const datei = join(this.zielordner, `mock_${Date.now()}_${nummer}.jpg`);
    writeFileSync(datei, bild);
  }

  async setzeZielordner(pfad: string): Promise<void> {
    this.zielordner = pfad;
  }

  async setzeBelichtung(): Promise<void> {
    // Der Mock hat keine Belichtung.
  }
}
