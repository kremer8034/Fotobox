import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { promisify } from 'node:util';
import { OHNE_FORTSCHRITT } from '../treiber/powershell.js';

const fuehreAus = promisify(execFile);

/**
 * Ordner auswaehlen, ohne den Pfad zu tippen - fuer die Uebergabe auf einen
 * USB-Stick. Statt eines Windows-Dialogs (der im Vollbild-Kiosk hinter dem
 * Browser aufginge und mit dem Finger schwer zu treffen ist) liefert der
 * Server die Laufwerke und Unterordner, die Verwaltung zeigt sie als Liste.
 *
 * Nur lesend bis auf "Neuer Ordner" - und nur ueber die lokale Verwaltung
 * erreichbar, nie ueber das Netz.
 */

export interface Laufwerk {
  pfad: string;
  name: string;
  /** Wechseldatentraeger (USB-Stick, Speicherkarte). */
  wechsel: boolean;
  freiGb: number | null;
}

export interface Ordnerliste {
  pfad: string;
  oben: string | null;
  ordner: { name: string; pfad: string }[];
}

/** Ordner, die niemand als Ziel will und die Windows ohnehin schuetzt. */
const AUSGEBLENDET = /^(\$|\.|System Volume Information$|Recovery$|Config\.Msi$|Windows$|ProgramData$|Program Files|PerfLogs$|Documents and Settings$|node_modules$)/i;

export async function laufwerke(): Promise<Laufwerk[]> {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await fuehreAus(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          OHNE_FORTSCHRITT +
            '[Console]::OutputEncoding = [Text.Encoding]::UTF8;' +
            ' @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 } |' +
            ' Select-Object DeviceID, VolumeName, DriveType, FreeSpace) | ConvertTo-Json -Compress',
        ],
        { timeout: 15_000, windowsHide: true, encoding: 'utf8' },
      );
      return deuteLaufwerke(stdout);
    } catch {
      // Notfalls die Buchstaben durchprobieren.
      return 'CDEFGHIJKLMNOPQRSTUVWXYZ'
        .split('')
        .map((b) => `${b}:\\`)
        .filter((p) => existsSync(p))
        .map((p) => ({ pfad: p, name: p, wechsel: false, freiGb: null }));
    }
  }
  const orte = ['/', homedir(), '/media', '/mnt'].filter((p) => existsSync(p));
  return orte.map((p) => ({ pfad: p, name: p, wechsel: p.startsWith('/media') || p.startsWith('/mnt'), freiGb: null }));
}

/** Antwort von Win32_LogicalDisk deuten - ein Laufwerk kommt als Objekt, mehrere als Liste. */
export function deuteLaufwerke(json: string): Laufwerk[] {
  const text = json.trim();
  if (!text) return [];
  const roh = JSON.parse(text) as unknown;
  const liste = (Array.isArray(roh) ? roh : [roh]) as Record<string, unknown>[];
  return liste
    .filter((l) => typeof l?.DeviceID === 'string')
    .map((l) => {
      const buchstabe = String(l.DeviceID);
      const wechsel = Number(l.DriveType) === 2;
      const name = typeof l.VolumeName === 'string' && l.VolumeName.trim() ? l.VolumeName.trim() : '';
      const frei = Number(l.FreeSpace);
      return {
        pfad: `${buchstabe}\\`,
        name: `${wechsel ? 'USB-Stick / Wechseldatenträger' : 'Festplatte'} (${buchstabe})${name ? ` – ${name}` : ''}`,
        wechsel,
        freiGb: Number.isFinite(frei) && frei > 0 ? Math.round((frei / 1024 ** 3) * 10) / 10 : null,
      };
    })
    // USB-Sticks zuerst: Sie sind das uebliche Ziel der Uebergabe.
    .sort((a, b) => Number(b.wechsel) - Number(a.wechsel) || a.pfad.localeCompare(b.pfad));
}

export async function listeOrdner(pfad: string): Promise<Ordnerliste> {
  const voll = resolve(pfad);
  const eintraege = await readdir(voll, { withFileTypes: true });
  const ordner = eintraege
    .filter((e) => e.isDirectory() && !AUSGEBLENDET.test(e.name))
    .map((e) => ({ name: e.name, pfad: join(voll, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  const istWurzel = parse(voll).root === voll;
  return { pfad: voll, oben: istWurzel ? null : dirname(voll), ordner };
}

/** Ein Ordnername, den Windows annimmt. */
export function gueltigerOrdnername(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 80 && !/[\\/:*?"<>|]/.test(n) && !/^\.+$/.test(n) && !/[. ]$/.test(n);
}

export async function legeOrdnerAn(elternPfad: string, name: string): Promise<string> {
  if (!gueltigerOrdnername(name)) {
    throw new Error('Dieser Ordnername geht nicht. Nicht erlaubt sind \\ / : * ? " < > | und ein Punkt am Ende.');
  }
  const ziel = join(resolve(elternPfad), name.trim());
  await mkdir(ziel, { recursive: false }).catch((f: NodeJS.ErrnoException) => {
    if (f.code !== 'EEXIST') throw f;
  });
  return ziel;
}
