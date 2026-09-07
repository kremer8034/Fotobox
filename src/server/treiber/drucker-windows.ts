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
      // PrinterStatus und DetectedErrorState aus WMI. Die Zahlenwerte sind in
      // der Win32_Printer-Dokumentation festgelegt.
      const { stdout } = await fuehreAus(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p = Get-CimInstance Win32_Printer -Filter "Name='${this.druckerName.replace(/'/g, "''")}'";` +
            'if ($null -eq $p) { "fehlt" } else { "$($p.PrinterStatus);$($p.DetectedErrorState);$($p.WorkOffline)" }',
        ],
        { timeout: 8000, windowsHide: true },
      );
      return this.deuteStatus(stdout.trim());
    } catch (fehler) {
      return {
        zustand: 'unbekannt',
        meldung: fehler instanceof Error ? fehler.message : String(fehler),
      };
    }
  }

  private deuteStatus(roh: string): DruckerStatus {
    if (roh === 'fehlt') {
      return { zustand: 'offline', meldung: 'Drucker ist in Windows nicht vorhanden.' };
    }
    const [statusText, fehlerText, offlineText] = roh.split(';');
    if (offlineText?.trim().toLowerCase() === 'true') {
      return { zustand: 'offline', meldung: 'Drucker ist offline.' };
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
    if (zustand) return { zustand, meldung: `Windows meldet Fehlerzustand ${fehler}.` };
    // PrinterStatus 3 = Idle, 4 = Printing, 5 = Warmup gelten alle als bereit.
    const status = Number(statusText);
    if ([3, 4, 5].includes(status)) return { zustand: 'bereit' };
    return { zustand: 'unbekannt', meldung: `Windows meldet Status ${statusText}.` };
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
