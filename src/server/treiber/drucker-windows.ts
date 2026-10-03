import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { seitenbildPfad } from '../bild/pdf.js';
import type { DruckerStatus, DruckerTreiber, DruckerZustand } from './drucker.js';

const fuehreAus = promisify(execFile);

/**
 * Der Druckhelfer: Windows druckt das fertige Seitenbild selbst, ueber
 * System.Drawing.Printing aus der Windows-PowerShell - ohne fremdes Programm.
 *
 * - Papier: das, was im Treiber 6 x 4 Zoll am naechsten kommt. Gibt es
 *   keins (etwa "Microsoft Print to PDF"), bleibt das voreingestellte.
 * - Lage: quer, egal wie der Treiber das Papier fuehrt.
 * - Bild: auf das ganze Blatt, bis an die Kante. Der Ursprung der
 *   Zeichenflaeche liegt am bedruckbaren Bereich, deshalb um die harten
 *   Raender zurueckgeschoben. Skaliert wird nichts darueber hinaus - die
 *   Kalibrierung steckt schon im Bild.
 * - Kopien: als Seiten eines Auftrags. Die Kopienzahl im Treiber ueberhoeren
 *   manche Fotodrucker.
 *
 * Kehrt Print() zurueck, liegt der Auftrag in der Windows-Warteschlange.
 * Jeder Fehler (Drucker unbekannt, Zugriff verweigert, Treiber verweigert
 * das Papier) kommt als Ausnahme - und damit als Text bis in die Verwaltung.
 */
const DRUCKHELFER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Drawing
  $name = $env:FOTOBOX_DRUCKER
  $script:kopien = [Math]::Max(1, [int]$env:FOTOBOX_KOPIEN)
  $script:bild = [System.Drawing.Image]::FromFile($env:FOTOBOX_SEITE)
  $doc = New-Object System.Drawing.Printing.PrintDocument
  $doc.PrinterSettings.PrinterName = $name
  if (-not $doc.PrinterSettings.IsValid) { throw "Windows kennt keinen Drucker mit dem Namen '$name'." }
  $doc.DocumentName = 'Fotobox ' + [IO.Path]::GetFileNameWithoutExtension($env:FOTOBOX_SEITE)
  $doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $papier = $null; $abstand = [double]::MaxValue
  foreach ($p in $doc.PrinterSettings.PaperSizes) {
    $d = [Math]::Abs([Math]::Max($p.Width, $p.Height) - 600) + [Math]::Abs([Math]::Min($p.Width, $p.Height) - 400)
    if ($d -lt $abstand) { $abstand = $d; $papier = $p }
  }
  if ($null -ne $papier -and $abstand -le 40) { $doc.DefaultPageSettings.PaperSize = $papier }
  else { $papier = $doc.DefaultPageSettings.PaperSize }
  $doc.DefaultPageSettings.Landscape = ($papier.Width -lt $papier.Height)
  $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $doc.OriginAtMargins = $false
  $script:seiten = 0
  $doc.add_PrintPage({
    param($absender, $e)
    $g = $e.Graphics
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $b = $e.PageBounds
    $ziel = New-Object System.Drawing.RectangleF((-$e.PageSettings.HardMarginX), (-$e.PageSettings.HardMarginY), $b.Width, $b.Height)
    $g.DrawImage($script:bild, $ziel)
    $script:seiten++
    $e.HasMorePages = ($script:seiten -lt $script:kopien)
  })
  $doc.Print()
  "Papier: $($papier.PaperName) ($($papier.Width) x $($papier.Height)), Blatt: $script:seiten"
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.GetBaseException().Message)
  exit 1
}
`;

/** PowerShell nimmt Skripte am sichersten als UTF-16LE in Base64. */
function verpackt(skript: string): string {
  return Buffer.from(skript, 'utf16le').toString('base64');
}

/**
 * Dialogfreier Druck unter Windows.
 *
 * Gedruckt wird das Seitenbild neben dem PDF: dieselbe Seite, 152,4 x 101,6 mm,
 * Kalibrierung eingerechnet (siehe schreibeSeitenbild). Bis 1.0.3 ging das PDF
 * an SumatraPDF - das meldete mit "-silent" aber jeden Fehlschlag als Erfolg.
 * Die Box zeigte "an Windows uebergeben", in der Windows-Warteschlange kam
 * nie etwas an. SumatraPDF bleibt nur fuer Druckdateien ohne Seitenbild.
 *
 * Randlos und ICC-Farbprofil werden einmalig im DNP-Windows-Treiber
 * eingestellt.
 */
export class WindowsDrucker implements DruckerTreiber {
  readonly name = 'Windows-Silent-Print';

  constructor(
    private readonly druckerName: string,
    private readonly sumatraPfad: string,
  ) {}

  async pruefe(): Promise<DruckerStatus> {
    // Ohne Drucker gilt er als nicht erreichbar: Die Auftraege warten dann,
    // bis einer gewaehlt ist. Vorher hiess das "unbekannt", die Schleife
    // schickte trotzdem los, jeder Auftrag scheiterte mit "Kein Drucker
    // ausgewaehlt" - und die Warteschlange blieb danach angehalten. Genau so
    // geschehen direkt nach einem Update, bevor der Drucker eingetragen war.
    if (!this.druckerName) {
      return { zustand: 'offline', meldung: 'Kein Drucker ausgewaehlt.' };
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

  async drucke(pdfPfad: string, kopien: number): Promise<string | void> {
    if (!this.druckerName) throw new Error('Kein Drucker ausgewaehlt.');
    const seite = seitenbildPfad(pdfPfad);
    if (existsSync(seite)) return this.druckeSeitenbild(seite, kopien);
    return this.druckeMitSumatra(pdfPfad, kopien);
  }

  private async druckeSeitenbild(seite: string, kopien: number): Promise<string> {
    try {
      const { stdout } = await fuehreAus(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', verpackt(DRUCKHELFER)],
        {
          timeout: 120_000,
          windowsHide: true,
          encoding: 'utf8',
          env: {
            ...process.env,
            FOTOBOX_DRUCKER: this.druckerName,
            FOTOBOX_SEITE: seite,
            FOTOBOX_KOPIEN: String(kopien),
          },
        },
      );
      return stdout.trim();
    } catch (fehler) {
      throw new Error(`Windows hat den Druck nicht angenommen: ${druckfehlerText(fehler)}`);
    }
  }

  private async druckeMitSumatra(pdfPfad: string, kopien: number): Promise<void> {
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

/** Aus einem gescheiterten Aufruf den Satz machen, den ein Mensch lesen kann. */
export function druckfehlerText(fehler: unknown): string {
  const f = fehler as { stderr?: string; killed?: boolean; message?: string };
  if (f?.killed) return 'Keine Antwort von Windows innerhalb von zwei Minuten.';
  const text = (f?.stderr ?? '').trim();
  if (text) return text.split(/\r?\n/).filter(Boolean).at(-1)!;
  return f?.message ?? String(fehler);
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
