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
