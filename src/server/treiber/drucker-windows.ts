import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import type { DruckerStatus, DruckerTreiber, DruckerZustand } from './drucker.js';

const fuehreAus = promisify(execFile);

/**
 * Dialogfreier Druck unter Windows.
 *
 * Der Weg ist bewusst deterministisch: Wir schicken ein PDF, dessen Seite exakt
 * dem Papier entspricht (152,4 x 101,6 mm), und drucken mit "noscale". Jede
 * Skalierung durch den Treiber wuerde die Druckkalibrierung wirkungslos machen.
 *
 * Randlos, Papierformat und ICC-Farbprofil werden einmalig im DNP-Windows-
 * Treiber eingestellt; die Software schickt nur eine exakt bemasste Seite.
 */
export class WindowsDrucker implements DruckerTreiber {
  readonly name = 'Windows-Silent-Print';

  constructor(
    private readonly druckerName: string,
    private readonly sumatraPfad: string,
  ) {}

  async pruefe(): Promise<DruckerStatus> {
    if (!this.druckerName) {
      return { zustand: 'unbekannt', meldung: 'Kein Drucker ausgewaehlt.' };
    }
    try {
      // PrinterStatus und DetectedErrorState aus WMI, dazu die Auftraege, die
      // schon bei Windows liegen, und der Zustand des vordersten. Die
      // Zahlenwerte sind in der Win32_Printer-Dokumentation festgelegt.
      const name = this.druckerName.replace(/'/g, "''");
      const { stdout } = await fuehreAus(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = Get-CimInstance Win32_Printer -Filter "Name='${name}'";` +
            'if ($null -eq $p) { "fehlt" } else {' +
            ` $muster = [WildcardPattern]::Escape('${name}') + ', *';` +
            ' $j = @(Get-CimInstance Win32_PrintJob | Where-Object { $_.Name -like $muster });' +
            ' $erster = if ($j.Count -gt 0) { $j[0].JobStatus } else { "" };' +
            ' "$($p.PrinterStatus);$($p.DetectedErrorState);$($p.WorkOffline);$($j.Count);$erster" }',
        ],
        { timeout: 8000, windowsHide: true },
      );
      return deuteStatus(stdout.trim());
    } catch (fehler) {
      return {
        zustand: 'unbekannt',
        meldung: fehler instanceof Error ? fehler.message : String(fehler),
      };
    }
  }

  async drucke(pdfPfad: string, kopien: number): Promise<void> {
    if (!this.druckerName) throw new Error('Kein Drucker ausgewaehlt.');
    if (!this.sumatraPfad || !existsSync(this.sumatraPfad)) {
      throw new Error(
        'SumatraPDF wurde nicht gefunden. Pfad unter Geraet > Drucker eintragen.',
      );
    }
    // SumatraPDF druckt ohne Dialog. "noscale" ist entscheidend: Jede Skalierung
    // durch den Treiber wuerde die Druckkalibrierung wirkungslos machen.
    const argumente = [
      '-print-to',
      this.druckerName,
      '-print-settings',
      `noscale,${kopien}x`,
      '-silent',
      '-exit-when-done',
      pdfPfad,
    ];
    await fuehreAus(this.sumatraPfad, argumente, { timeout: 120_000, windowsHide: true });
  }
}

/**
 * Die Antwort der PowerShell-Abfrage deuten:
 * "PrinterStatus;DetectedErrorState;WorkOffline;Auftraege bei Windows;Zustand des vordersten".
 */
export function deuteStatus(roh: string): DruckerStatus {
  if (roh === 'fehlt') {
    return { zustand: 'offline', meldung: 'Drucker ist in Windows nicht vorhanden.' };
  }
  const [statusText, fehlerText, offlineText, anzahlText, auftragText = ''] = roh.split(';');
  const auftraegeBeimSystem = Number(anzahlText) || 0;
  const mit = (status: DruckerStatus): DruckerStatus => ({ ...status, auftraegeBeimSystem });

  if (offlineText?.trim().toLowerCase() === 'true') {
    return mit({ zustand: 'offline', meldung: 'Drucker ist offline.' });
  }
  const fehler = Number(fehlerText);
  // Win32_Printer.DetectedErrorState: 4 = Paper Jam, 5 = Paper Out,
  // 6 = Manual Feed, 9 = Door Open, 10 = Offline.
  const nachFehler: Record<number, DruckerZustand> = {
    4: 'klappe',
    5: 'papier-leer',
    6: 'papier-leer',
    9: 'klappe',
    10: 'offline',
  };
  const zustand = nachFehler[fehler];
  if (zustand) return mit({ zustand, meldung: `Windows meldet Fehlerzustand ${fehler}.` });

  // Viele Treiber melden eine leere Rolle nicht am Drucker, sondern nur am
  // haengenden Auftrag ("Error - Paper Out", "Offline").
  if (/paper ?out/i.test(auftragText)) return mit({ zustand: 'papier-leer', meldung: auftragText });
  if (/offline/i.test(auftragText)) return mit({ zustand: 'offline', meldung: auftragText });
  if (/error|fehler|blocked|user intervention/i.test(auftragText)) {
    return mit({ zustand: 'klappe', meldung: auftragText });
  }

  // PrinterStatus 3 = Idle, 4 = Printing, 5 = Warmup gelten alle als bereit;
  // 7 = Offline meldet Windows etwa, wenn das USB-Kabel ab ist.
  const status = Number(statusText);
  if ([3, 4, 5].includes(status)) return mit({ zustand: 'bereit' });
  if (status === 7) return mit({ zustand: 'offline', meldung: 'Windows meldet den Drucker als offline.' });
  return mit({ zustand: 'unbekannt', meldung: `Windows meldet Status ${statusText}.` });
}

/** Ein Drucker, wie Windows ihn kennt. */
export interface GefundenerDrucker {
  name: string;
  treiber: string;
  anschluss: string;
  offline: boolean;
  /** Sieht nach dem DNP-Fotodrucker aus. */
  dnp: boolean;
}

/**
 * Alle Drucker, die Windows kennt - fuer die Auswahl in der Verwaltung.
 * Vorher musste der Name von Hand eingetragen werden, und ein Zeichen daneben
 * hiess: "Der Drucker meldet sich gerade nicht", obwohl er bereitstand.
 */
export async function listeWindowsDrucker(): Promise<GefundenerDrucker[]> {
  const { stdout } = await fuehreAus(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8;' +
        ' @(Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName, WorkOffline)' +
        ' | ConvertTo-Json -Compress',
    ],
    { timeout: 15_000, windowsHide: true },
  );
  return deuteDruckerliste(stdout);
}

/** Die JSON-Antwort von PowerShell deuten - ein einzelner Drucker kommt als Objekt, mehrere als Liste. */
export function deuteDruckerliste(json: string): GefundenerDrucker[] {
  const text = json.trim();
  if (!text) return [];
  const roh: unknown = JSON.parse(text);
  const liste = (Array.isArray(roh) ? roh : [roh]) as Record<string, unknown>[];
  return liste
    .filter((d) => typeof d?.Name === 'string' && d.Name !== '')
    .map((d) => {
      const name = String(d.Name);
      const treiber = typeof d.DriverName === 'string' ? d.DriverName : '';
      return {
        name,
        treiber,
        anschluss: typeof d.PortName === 'string' ? d.PortName : '',
        offline: d.WorkOffline === true,
        dnp: istDnp(name, treiber),
      };
    })
    .sort((a, b) => Number(b.dnp) - Number(a.dnp) || a.name.localeCompare(b.name, 'de'));
}

export function istDnp(name: string, treiber: string): boolean {
  return /\bDNP\b|DS-?RX1|DS-?40|DS-?80|DS620|QW410/i.test(`${name} ${treiber}`);
}

/**
 * Den passenden Drucker vorschlagen: Ist der eingetragene in Windows nicht
 * (mehr) vorhanden und gibt es genau einen DNP-Drucker, dann den.
 */
export function druckerVorschlag(eingetragen: string, gefunden: GefundenerDrucker[]): string | null {
  if (gefunden.some((d) => d.name === eingetragen)) return null;
  const dnp = gefunden.filter((d) => d.dnp);
  return dnp.length === 1 ? dnp[0]!.name : null;
}
