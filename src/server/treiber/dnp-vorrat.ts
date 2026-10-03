import { execFile } from 'node:child_process';
import { existsSync, openSync, readdirSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { lesbarerFehler, OHNE_FORTSCHRITT } from './powershell.js';

const fuehreAus = promisify(execFile);

/**
 * Den echten Papiervorrat direkt aus dem DNP-Drucker lesen.
 *
 * Windows kennt die Restblaetter nicht - der DNP-Treiber gibt sie ueber keine
 * Standard-Schnittstelle heraus. DNPs eigenes Programm "PrinterInfo" fragt den
 * Drucker ueber die Bibliothek CspStat.dll, die es mitbringt. Genau diese
 * Bibliothek nutzt die Fotobox auch: Ist PrinterInfo installiert, steht der
 * Vorrat, den der Drucker selbst zaehlt, in der Fotobox. Mitliefern duerfen
 * wir die DLL nicht - sie gehoert DNP.
 *
 * Belegte Funktionen (aus Programmen, die CspStat.dll bereits nutzen):
 *   GetPrinterPortNum(byte[])  zaehlt die angeschlossenen DNP-Drucker
 *   GetMediaCounter(port)      Restblaetter, negativ bei Fehler
 *   GetInitialMediaCount(port) Blatt einer vollen Rolle (nicht in jeder Fassung)
 *   GetStatus(port)            Zustand als Bitfeld (siehe deuteDnpStatus)
 *
 * Wichtig laut DNP: Waehrend der Drucker druckt, kann eine Abfrage ihn
 * blockieren. Deshalb fragt die Fotobox nur, wenn nichts gedruckt wird
 * (siehe Betrieb.leseDruckerVorrat).
 *
 * Die DLL ist meist 32-Bit, die Fotobox laeuft mit 64-Bit-Node. Deshalb geht
 * die Abfrage ueber die Windows-PowerShell in der passenden Bitbreite.
 */

export interface DnpVorrat {
  /** Restblaetter laut Drucker. */
  rest: number;
  /** Blatt einer vollen Rolle; null, wenn die DLL das nicht kann. */
  gesamt: number | null;
  /** Zustand laut Drucker als Bitfeld; null, wenn nicht lesbar. */
  status: number | null;
  /** Anschlussnummer des Druckers in der DLL. */
  port: number;
}

/** Wo PrinterInfo (und damit CspStat.dll) ueblicherweise liegt. */
function suchorte(): string[] {
  const umg = process.env;
  const orte = ['C:\\DNPIA'];
  for (const basis of [umg['ProgramFiles(x86)'], umg.ProgramFiles, umg.ProgramW6432]) {
    if (!basis || !existsSync(basis)) continue;
    try {
      for (const name of readdirSync(basis)) {
        if (/dnp|printerinfo/i.test(name)) orte.push(join(basis, name));
      }
    } catch {
      // Nicht lesbar - dann eben nicht.
    }
  }
  return orte;
}

/** CspStat.dll suchen: erst im eingetragenen Pfad, dann in den ueblichen Ordnern (drei Ebenen tief). */
export function findeCspStat(orte: string[] = suchorte()): string | null {
  const gesucht = (ordner: string, tiefe: number): string | null => {
    if (tiefe < 0 || !existsSync(ordner)) return null;
    let eintraege: import('node:fs').Dirent[];
    try {
      eintraege = readdirSync(ordner, { withFileTypes: true });
    } catch {
      return null;
    }
    const datei = eintraege.find((e) => e.isFile() && e.name.toLowerCase() === 'cspstat.dll');
    if (datei) return join(ordner, datei.name);
    for (const e of eintraege) {
      if (!e.isDirectory()) continue;
      const treffer = gesucht(join(ordner, e.name), tiefe - 1);
      if (treffer) return treffer;
    }
    return null;
  };
  for (const ort of orte) {
    const treffer = gesucht(ort, 3);
    if (treffer) return treffer;
  }
  return null;
}

/**
 * Bitbreite einer Windows-DLL aus ihrem Dateikopf: Der PE-Kopf nennt den
 * Prozessor (0x14c = 32-Bit x86, 0x8664 = 64-Bit). Eine 32-Bit-DLL laesst sich
 * nur aus einem 32-Bit-Prozess laden.
 */
export function dllBitbreite(pfad: string): 32 | 64 | null {
  let fd: number | null = null;
  try {
    fd = openSync(pfad, 'r');
    const kopf = Buffer.alloc(4096);
    const gelesen = readSync(fd, kopf, 0, kopf.length, 0);
    if (gelesen < 64 || kopf.toString('latin1', 0, 2) !== 'MZ') return null;
    const pe = kopf.readUInt32LE(0x3c);
    if (pe + 6 > gelesen || kopf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
    const maschine = kopf.readUInt16LE(pe + 4);
    if (maschine === 0x14c) return 32;
    if (maschine === 0x8664) return 64;
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Die Windows-PowerShell in der Bitbreite der DLL. Node selbst laeuft als 64-Bit. */
export function powershellFuer(bit: 32 | 64): string {
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  return join(windows, bit === 32 ? 'SysWOW64' : 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * Das Abfrageskript. Gibt eine Zeile aus:
 * "Drucker;Port;Rest;Gesamt;Status" - Drucker ist die Zahl, die
 * GetPrinterPortNum meldet; -1 steht fuer "nicht lesbar".
 */
const ABFRAGE = `
${OHNE_FORTSCHRITT}
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $dll = $env:FOTOBOX_DNP_DLL
  Set-Location -LiteralPath (Split-Path -Parent $dll)
  $quelle = @"
using System;
using System.Runtime.InteropServices;
public static class FotoboxDnp {
  [DllImport(@"$dll", CallingConvention = CallingConvention.StdCall)] public static extern int GetPrinterPortNum(byte[] daten);
  [DllImport(@"$dll", CallingConvention = CallingConvention.StdCall)] public static extern int GetMediaCounter(int port);
  [DllImport(@"$dll", CallingConvention = CallingConvention.StdCall)] public static extern int GetInitialMediaCount(int port);
  [DllImport(@"$dll", CallingConvention = CallingConvention.StdCall)] public static extern int GetStatus(int port);
}
"@
  Add-Type -TypeDefinition $quelle
  $puffer = New-Object byte[] 4096
  $drucker = [FotoboxDnp]::GetPrinterPortNum($puffer)
  $port = -1; $rest = -1
  foreach ($p in 0..3) {
    $r = [FotoboxDnp]::GetMediaCounter($p)
    if ($r -ge 0) { $port = $p; $rest = $r; break }
  }
  if ($port -lt 0) { throw "Kein DNP-Drucker gefunden (GetPrinterPortNum: $drucker). Ist er eingeschaltet und per USB verbunden?" }
  $gesamt = -1
  try { $gesamt = [FotoboxDnp]::GetInitialMediaCount($port) } catch [System.EntryPointNotFoundException] { }
  $status = -1
  try { $status = [FotoboxDnp]::GetStatus($port) } catch [System.EntryPointNotFoundException] { }
  "$drucker;$port;$rest;$gesamt;$status"
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 1
}
`;

/** Die Ausgabezeile der Abfrage deuten. */
export function deuteDnpAntwort(zeile: string): DnpVorrat {
  const teile = zeile.trim().split(';').map((t) => Number(t.trim()));
  if (teile.length < 5 || teile.some((t) => !Number.isFinite(t))) {
    throw new Error(`Unerwartete Antwort von CspStat.dll: "${zeile.trim().slice(0, 120)}"`);
  }
  const [, port, rest, gesamt, status] = teile as [number, number, number, number, number];
  if (rest < 0) throw new Error('Der Drucker hat keinen Vorrat gemeldet.');
  return {
    rest,
    gesamt: gesamt > 0 ? gesamt : null,
    status: status >= 0 ? status : null,
    port,
  };
}

/** Den Vorrat lesen. Wirft mit lesbarer Meldung, wenn es nicht geht. */
export async function leseDnpVorrat(dll: string): Promise<DnpVorrat> {
  const bit = dllBitbreite(dll);
  if (!bit) throw new Error(`${dll} ist keine lesbare Windows-DLL.`);
  try {
    const { stdout } = await fuehreAus(
      powershellFuer(bit),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(ABFRAGE, 'utf16le').toString('base64'),
      ],
      {
        cwd: dirname(dll),
        timeout: 20_000,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, FOTOBOX_DNP_DLL: dll },
      },
    );
    const zeile = stdout.split(/\r?\n/).filter((z) => z.includes(';')).at(-1) ?? '';
    return deuteDnpAntwort(zeile);
  } catch (fehler) {
    const f = fehler as { stderr?: string; killed?: boolean; message?: string };
    if (f?.killed) throw new Error('Der DNP-Drucker hat nicht innerhalb von 20 Sekunden geantwortet.');
    if (typeof f?.stderr === 'string') {
      throw new Error(lesbarerFehler(f.stderr) || f.message || String(fehler));
    }
    throw fehler;
  }
}

/** Was der Zustand laut Drucker bedeutet. Werte aus DNPs Dokumentation zu CspStat. */
export function deuteDnpStatus(status: number | null): string | null {
  if (status === null) return null;
  const gruppe = status & 0xffff0000;
  const einzeln = status & 0xffff;
  if (gruppe === 0x00010000) {
    const normal: Record<number, string> = {
      0x0001: 'bereit',
      0x0002: 'druckt',
      0x0004: 'pausiert',
      0x0008: 'Papier zu Ende',
      0x0010: 'Farbband zu Ende',
      0x0020: 'kühlt ab',
      0x0040: 'Motor kühlt ab',
    };
    return normal[einzeln] ?? `in Ordnung (Code ${status.toString(16)})`;
  }
  if (gruppe === 0x00020000) {
    const einstellung: Record<number, string> = {
      0x0001: 'Klappe offen',
      0x0002: 'Papierstau',
      0x0004: 'Farbband-Fehler',
      0x0008: 'Papier-Fehler',
      0x0010: 'Datenfehler',
      0x0020: 'Schnittrestbehälter voll oder fehlt',
    };
    return einstellung[einzeln] ?? `Bedienfehler (Code ${status.toString(16)})`;
  }
  if (gruppe === 0x00040000) return `Hardware-Fehler (Code ${status.toString(16)})`;
  if (gruppe === 0x00080000) return `Systemfehler (Code ${status.toString(16)})`;
  return `unbekannt (Code ${status.toString(16)})`;
}
