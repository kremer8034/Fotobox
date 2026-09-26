import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Software-Update aus der Verwaltung.
 *
 * Bewusst von Hand ausgeloest, nie im Hintergrund: Die Box sucht erst nach
 * einer neuen Version, wenn der Besitzer in der Verwaltung darauf tippt, und
 * installiert erst nach seinem zweiten Tipp und der Windows-Rueckfrage
 * (Benutzerkontensteuerung). Ein Updater, der von selbst loslaeuft, waere ein
 * zusaetzlicher Weg ins System und koennte mitten in einer Feier neu starten.
 *
 * Quelle sind die Releases des GitHub-Repositorys. Dort liegt je Version die
 * Setup-Datei und ihre SHA-256-Pruefsumme; geladen wird nur ueber HTTPS, und
 * vor dem Start wird die Pruefsumme verglichen. Dieselbe Setup-Datei laesst
 * sich auch per USB-Stick von Hand starten - das Update ist nichts anderes als
 * "die neue Version ueber die alte installieren".
 */

export const UPDATE_REPO = process.env.FOTOBOX_UPDATE_REPO ?? 'kremer8034/fotobox';
const SETUP_MUSTER = /^Fotobox-Setup-[\w.-]+\.exe$/;

export interface UpdateInfo {
  aktuell: string;
  neueste: string | null;
  neuerVerfuegbar: boolean;
  titel: string | null;
  hinweise: string | null;
  veroeffentlicht: string | null;
  setup: { name: string; url: string; groesse: number } | null;
  pruefsummeUrl: string | null;
}

/** "1.2.10" > "1.2.9"; eine Vorabversion ("2.0.0-beta.1") zaehlt vor der fertigen. */
export function vergleicheVersionen(a: string, b: string): number {
  const zerlege = (v: string) => {
    const [kern = '', vorab = ''] = v.trim().replace(/^v/i, '').split('-', 2);
    return { teile: kern.split('.').map((t) => Number.parseInt(t, 10) || 0), vorab };
  };
  const x = zerlege(a);
  const y = zerlege(b);
  for (let i = 0; i < Math.max(x.teile.length, y.teile.length, 3); i += 1) {
    const d = (x.teile[i] ?? 0) - (y.teile[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.vorab === y.vorab) return 0;
  if (!x.vorab) return 1;
  if (!y.vorab) return -1;
  return x.vorab.localeCompare(y.vorab, 'en', { numeric: true });
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

type Abruf = typeof fetch;

/** Fragt GitHub nach der neuesten veroeffentlichten Version. */
export async function pruefeAufUpdate(aktuell: string, abruf: Abruf = fetch): Promise<UpdateInfo> {
  let antwort: Response;
  try {
    antwort = await abruf(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Fotobox/${aktuell}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Keine Verbindung zum Internet. Updates lassen sich nur mit Internet suchen.');
  }
  const leer: UpdateInfo = {
    aktuell,
    neueste: null,
    neuerVerfuegbar: false,
    titel: null,
    hinweise: null,
    veroeffentlicht: null,
    setup: null,
    pruefsummeUrl: null,
  };
  // 404: Es gibt noch keine veroeffentlichte Version.
  if (antwort.status === 404) return leer;
  // Ohne Anmeldung erlaubt GitHub 60 Abfragen je Stunde und Internetanschluss.
  if ((antwort.status === 403 || antwort.status === 429) && antwort.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('GitHub bremst gerade (zu viele Abfragen). Bitte in einer Stunde noch einmal suchen.');
  }
  if (!antwort.ok) throw new Error(`GitHub antwortet nicht wie erwartet (HTTP ${antwort.status}).`);

  const release = (await antwort.json()) as GithubRelease;
  const neueste = release.tag_name.replace(/^v/i, '');
  const setup = release.assets.find((a) => SETUP_MUSTER.test(a.name)) ?? null;
  const pruefsumme = setup ? release.assets.find((a) => a.name === `${setup.name}.sha256`) : undefined;
  return {
    aktuell,
    neueste,
    neuerVerfuegbar: vergleicheVersionen(neueste, aktuell) > 0 && setup !== null,
    titel: release.name,
    hinweise: release.body,
    veroeffentlicht: release.published_at,
    setup: setup ? { name: setup.name, url: setup.browser_download_url, groesse: setup.size } : null,
    pruefsummeUrl: pruefsumme?.browser_download_url ?? null,
  };
}

/** Die erste 64-stellige Hex-Zahl aus einer .sha256-Datei ("<hash>  <datei>" oder nur der Hash). */
export function lesePruefsumme(text: string): string | null {
  return /\b[0-9a-f]{64}\b/i.exec(text)?.[0].toLowerCase() ?? null;
}

export type UpdatePhase = 'bereit' | 'laedt' | 'prueft' | 'startet' | 'gestartet' | 'simuliert' | 'fehler';

export interface UpdateStand {
  phase: UpdatePhase;
  version: string | null;
  geladen: number;
  gesamt: number;
  meldung: string | null;
}

/**
 * Laedt die Setup-Datei, prueft sie und startet sie. Der Stand ist fuer die
 * Anzeige in der Verwaltung abrufbar; es laeuft immer nur ein Update.
 */
export class Aktualisierer {
  stand: UpdateStand = { phase: 'bereit', version: null, geladen: 0, gesamt: 0, meldung: null };

  constructor(
    private readonly optionen: {
      /** Wohin die Setup-Datei geladen wird. */
      ordner: string;
      /** false: alles ausser dem Start des Installers (Entwicklung, Tests). */
      starten: boolean;
      abruf?: Abruf;
      /** Startet den Installer; Vorgabe: mit Rueckfrage der Benutzerkontensteuerung. */
      starteInstaller?: (pfad: string, protokoll: string) => void;
    },
  ) {}

  laeuft(): boolean {
    return ['laedt', 'prueft', 'startet'].includes(this.stand.phase);
  }

  async installiere(info: UpdateInfo): Promise<void> {
    if (this.laeuft()) throw new Error('Es läuft schon ein Update.');
    if (!info.setup || !info.neueste) throw new Error('Zu dieser Version gibt es keine Setup-Datei.');
    if (!info.pruefsummeUrl) throw new Error('Zu dieser Version fehlt die Prüfsumme - aus Sicherheitsgründen wird sie nicht installiert.');

    const abruf = this.optionen.abruf ?? fetch;
    const setup = info.setup;
    this.stand = { phase: 'laedt', version: info.neueste, geladen: 0, gesamt: setup.groesse, meldung: null };
    await mkdir(this.optionen.ordner, { recursive: true });
    const ziel = join(this.optionen.ordner, setup.name);

    try {
      const summenAntwort = await abruf(info.pruefsummeUrl, { signal: AbortSignal.timeout(20_000) });
      if (!summenAntwort.ok) throw new Error('Die Prüfsumme ließ sich nicht laden.');
      const erwartet = lesePruefsumme(await summenAntwort.text());
      if (!erwartet) throw new Error('Die Prüfsummen-Datei ist unlesbar.');

      const antwort = await abruf(setup.url, { signal: AbortSignal.timeout(15 * 60_000) });
      if (!antwort.ok || !antwort.body) throw new Error(`Download fehlgeschlagen (HTTP ${antwort.status}).`);
      const hash = createHash('sha256');
      const zaehler = async function* (this: Aktualisierer, quelle: AsyncIterable<Uint8Array>) {
        for await (const stueck of quelle) {
          hash.update(stueck);
          this.stand.geladen += stueck.length;
          yield stueck;
        }
      }.bind(this);
      await pipeline(Readable.fromWeb(antwort.body as never), zaehler, createWriteStream(ziel));

      this.stand.phase = 'prueft';
      if (hash.digest('hex') !== erwartet) {
        await rm(ziel, { force: true });
        throw new Error('Die heruntergeladene Datei ist beschädigt (Prüfsumme stimmt nicht). Bitte noch einmal versuchen.');
      }

      if (!this.optionen.starten) {
        this.stand.phase = 'simuliert';
        this.stand.meldung = `Geladen und geprüft: ${ziel}. Im Entwicklungsbetrieb wird nicht installiert.`;
        return;
      }
      this.stand.phase = 'startet';
      const protokoll = join(this.optionen.ordner, `update-${info.neueste}.log`);
      (this.optionen.starteInstaller ?? starteMitRueckfrage)(ziel, protokoll);
      this.stand.phase = 'gestartet';
      this.stand.meldung =
        'Bitte die Windows-Rückfrage mit „Ja“ bestätigen. Die Fotobox wird danach beendet, aktualisiert und startet von selbst neu.';
    } catch (fehler) {
      this.stand.phase = 'fehler';
      this.stand.meldung = fehler instanceof Error ? fehler.message : String(fehler);
      throw fehler;
    }
  }
}

/**
 * Startet das Setup ueber die Benutzerkontensteuerung. Node selbst kann kein
 * Programm mit Administratorrechten starten (CreateProcess scheitert mit
 * "Vorgang erfordert erhoehte Rechte"); PowerShell mit -Verb RunAs zeigt die
 * uebliche Windows-Rueckfrage.
 *
 * /SILENT: Nur ein Fortschrittsfenster, keine Fragen - die Einstellungen der
 * bisherigen Installation gelten weiter.
 */
function starteMitRueckfrage(pfad: string, protokoll: string): void {
  const text = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const argumente = `/SILENT /SUPPRESSMSGBOXES /NORESTART /LOG="${protokoll}"`;
  spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Start-Process -FilePath ${text(pfad)} -ArgumentList ${text(argumente)} -Verb RunAs`,
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  ).unref();
}
