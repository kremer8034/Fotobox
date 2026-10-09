import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OHNE_FORTSCHRITT } from '../treiber/powershell.js';

const fuehreAus = promisify(execFile);

/**
 * Den Kiosk-Browser beenden - nur die Instanz mit dem eigenen Profil
 * "Fotobox-Kiosk", ein anderes offenes Chrome- oder Edge-Fenster bleibt.
 *
 * Bis 1.0.3 lief das in einer "abgeloesten" PowerShell (spawn mit detached).
 * Unter Windows startet die gar nicht erst richtig - dieselbe Falle wie beim
 * Update-Knopf. Das Servicemenue meldete "Kiosk wird geschlossen", und es
 * passierte nichts. Jetzt ein gewoehnlicher Kindprozess, auf dessen Ende der
 * Server wartet; die Pause davor laesst die Antwort noch beim Browser ankommen.
 *
 * @returns wie viele Browser-Prozesse beendet wurden
 */
export async function schliesseKioskBrowser(verzoegerungMs = 800): Promise<number> {
  const skript =
    OHNE_FORTSCHRITT +
    `Start-Sleep -Milliseconds ${Math.max(0, Math.round(verzoegerungMs))};` +
    ' $n = 0;' +
    ' Get-CimInstance Win32_Process |' +
    " Where-Object { $_.CommandLine -like '*Fotobox-Kiosk*' -and ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') } |" +
    ' ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ };' +
    ' $n';
  const { stdout } = await fuehreAus('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', skript], {
    timeout: 30_000,
    windowsHide: true,
  });
  return Number(stdout.trim()) || 0;
}

/** Kennung im Profilordner der Diashow - so findet "Diashow beenden" genau dieses Fenster. */
const DIASHOW_PROFIL = 'Fotobox-Diashow';

export type DiashowFensterErgebnis = 'geoeffnet' | 'kein-zweiter-bildschirm' | 'kein-browser';

/**
 * Die Diashow auf dem zweiten Bildschirm oeffnen - Beamer oder Fernseher am
 * HDMI-Anschluss des Fotobox-PCs. Ein eigener Browser im Vollbild, mit eigenem
 * Profil, damit er weder im Kiosk-Fenster aufgeht noch von "Kiosk schliessen"
 * mit beendet wird.
 *
 * Welcher Bildschirm der zweite ist, weiss nur Windows: Genommen wird der
 * erste, der nicht der Hauptbildschirm ist - am Hauptbildschirm laeuft der Kiosk.
 */
export async function oeffneDiashowFenster(adresse: string): Promise<DiashowFensterErgebnis> {
  await schliesseDiashowFenster();
  const skript =
    OHNE_FORTSCHRITT +
    'Add-Type -AssemblyName System.Windows.Forms;' +
    ' $s = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1;' +
    " if (-not $s) { 'kein-zweiter-bildschirm'; exit };" +
    ' $b = $s.Bounds;' +
    ' $pfade = @("$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe",' +
    ' "${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe",' +
    ' "${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe",' +
    ' "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe");' +
    ' $browser = $pfade | Where-Object { Test-Path $_ } | Select-Object -First 1;' +
    " if (-not $browser) { 'kein-browser'; exit };" +
    ` $profil = Join-Path $env:LOCALAPPDATA '${DIASHOW_PROFIL}';` +
    ` Start-Process -FilePath $browser -ArgumentList @('--kiosk', '${adresse.replace(/'/g, '')}',` +
    ' "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",' +
    ' "--user-data-dir=`"$profil`"", \'--no-first-run\', \'--noerrdialogs\', \'--disable-infobars\',' +
    " '--disable-session-crashed-bubble', '--disable-features=Translate', '--check-for-update-interval=31536000');" +
    " 'geoeffnet'";
  const { stdout } = await fuehreAus('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', skript], {
    timeout: 30_000,
    windowsHide: true,
  });
  const antwort = stdout.trim().split(/\r?\n/).pop() ?? '';
  if (antwort === 'kein-zweiter-bildschirm' || antwort === 'kein-browser') return antwort;
  return 'geoeffnet';
}

/** Das Diashow-Fenster schliessen. @returns wie viele Browser-Prozesse beendet wurden */
export async function schliesseDiashowFenster(): Promise<number> {
  const skript =
    OHNE_FORTSCHRITT +
    ' $n = 0;' +
    ' Get-CimInstance Win32_Process |' +
    ` Where-Object { $_.CommandLine -like '*${DIASHOW_PROFIL}*' -and ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') } |` +
    ' ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $n++ };' +
    ' $n';
  const { stdout } = await fuehreAus('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', skript], {
    timeout: 30_000,
    windowsHide: true,
  });
  return Number(stdout.trim()) || 0;
}
