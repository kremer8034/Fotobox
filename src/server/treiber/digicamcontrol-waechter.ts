import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const fuehreAus = promisify(execFile);

/**
 * Haelt digiCamControl am Leben.
 *
 * digiCamControl ist ein eigenes Windows-Programm, und ohne es gibt es weder
 * Live-Bild noch Foto. Bisher musste es von Hand gestartet sein - und stuerzte
 * es ab oder haengte sich auf, blieb die Box mit "Kamera meldet sich nicht"
 * stehen, bis jemand den PC neu startete. Die eigene Doku des Photobooth-
 * Projekts nennt digiCamControl ausdruecklich "not maintained anymore and has
 * many open issues"; darauf muss man vorbereitet sein.
 *
 * Drei Faelle:
 *  - Programm laeuft nicht:            starten.
 *  - Programm laeuft, antwortet nicht: nach zwei Minuten beenden und neu
 *                                      starten - es haengt.
 *  - Programm antwortet, Kamera fehlt: nichts tun. Das ist ein Kabel oder der
 *                                      Kameraschalter; digiCamControl erkennt
 *                                      die Kamera von selbst, sobald sie da ist.
 */

export interface ProzessSteuerung {
  laeuft(): Promise<boolean>;
  starte(): void;
  beende(): Promise<void>;
  jetzt(): number;
}

export type Massnahme = 'nichts' | 'gestartet' | 'neu-gestartet' | 'programm-fehlt';

/** Mindestabstand zwischen zwei Starts: Ein frisch gestartetes digiCamControl
 *  braucht eine Weile, bis sein Webserver antwortet. */
const START_ABSTAND_MS = 60_000;
/** So lange darf ein laufendes digiCamControl schweigen, bevor es als haengend gilt. */
const HAENGT_NACH_MS = 120_000;

export class DigiCamControlWaechter {
  private letzterStart = Number.NEGATIVE_INFINITY;
  private schweigtSeit: number | null = null;

  constructor(
    private readonly steuerung: ProzessSteuerung,
    private readonly programmDa: () => boolean,
  ) {}

  /**
   * Nach jeder Kamerapruefung aufrufen.
   * @param antwortet ob digiCamControls Webserver ueberhaupt geantwortet hat -
   *   unabhaengig davon, ob eine Kamera dranhaengt.
   */
  async pruefe(antwortet: boolean): Promise<Massnahme> {
    const jetzt = this.steuerung.jetzt();
    if (antwortet) {
      this.schweigtSeit = null;
      return 'nichts';
    }
    this.schweigtSeit ??= jetzt;
    if (jetzt - this.letzterStart < START_ABSTAND_MS) return 'nichts';
    if (!this.programmDa()) return 'programm-fehlt';

    if (!(await this.steuerung.laeuft())) {
      this.steuerung.starte();
      this.letzterStart = jetzt;
      this.schweigtSeit = jetzt;
      return 'gestartet';
    }
    if (jetzt - this.schweigtSeit >= HAENGT_NACH_MS) {
      await this.steuerung.beende();
      this.steuerung.starte();
      this.letzterStart = jetzt;
      this.schweigtSeit = jetzt;
      return 'neu-gestartet';
    }
    return 'nichts';
  }
}

/** Pfad zu CameraControl.exe - eingetragen ist mal der Ordner, mal die Datei. */
export function cameraControlExe(eingetragen: string): string {
  return eingetragen.toLowerCase().endsWith('.exe') ? eingetragen : join(eingetragen, 'CameraControl.exe');
}

/** Die echte Steuerung unter Windows. */
export function windowsSteuerung(exe: () => string): ProzessSteuerung {
  return {
    async laeuft() {
      try {
        const { stdout } = await fuehreAus(
          'tasklist',
          ['/FI', 'IMAGENAME eq CameraControl.exe', '/NH'],
          { timeout: 8000, windowsHide: true },
        );
        return stdout.toLowerCase().includes('cameracontrol.exe');
      } catch {
        // Im Zweifel "laeuft" - lieber nicht ein zweites Exemplar starten.
        return true;
      }
    },
    starte() {
      const datei = exe();
      spawn(datei, [], { cwd: dirname(datei), detached: true, stdio: 'ignore' }).unref();
    },
    async beende() {
      await fuehreAus('taskkill', ['/IM', 'CameraControl.exe', '/F'], {
        timeout: 8000,
        windowsHide: true,
      }).catch(() => undefined);
      // Windows gibt den Port erst einen Moment nach dem Beenden frei.
      await new Promise((r) => setTimeout(r, 2000));
    },
    jetzt: () => Date.now(),
  };
}

export function programmVorhanden(exe: () => string): () => boolean {
  return () => existsSync(exe());
}
