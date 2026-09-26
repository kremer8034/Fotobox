# Probelauf des fertigen Setups auf dem Windows-Rechner von GitHub Actions:
# installieren, pruefen, Server starten, als Update erneut installieren,
# deinstallieren. Deckt genau das ab, was sonst erst auf der Box auffiele -
# Autostart, Firewall-Regel, Beenden vor dem Update, Datenbanksicherung,
# Aufraeumen bei der Deinstallation.
#
# Aufruf: pwsh -File skripte\installer-probe.ps1 -Setup paket\ausgabe\Fotobox-Setup-1.0.0.exe

param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
$programm = Join-Path $env:ProgramFiles 'Fotobox'
$daten = Join-Path $env:PUBLIC 'Fotobox-Daten'
$fehler = @()

function Pruefe([bool]$ok, [string]$text) {
  if ($ok) { Write-Host "  OK  $text" -ForegroundColor Green }
  else { Write-Host "  X   $text" -ForegroundColor Red; $script:fehler += $text }
}

# Nur auf das Setup selbst warten - nicht mit "Start-Process -Wait": Das
# wartet auch auf alles, was das Setup startet, und nach der Erstinstallation
# oeffnet es gewollt die Verwaltung im Browser, der offen bleibt.
function Starte([string]$datei, [string[]]$argumente) {
  $p = Start-Process -FilePath $datei -PassThru -ArgumentList $argumente
  if (-not $p.WaitForExit(600000)) { $p.Kill(); return -1 }
  return $p.ExitCode
}

function Installiere([string]$protokoll) {
  return Starte (Resolve-Path $Setup).Path @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$protokoll")
}

function ServerAntwortet {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$Port/api/kiosk/start" | Out-Null; return $true }
  catch { return $false }
}

function WarteAufServer([int]$sekunden) {
  for ($i = 0; $i -lt $sekunden; $i++) { if (ServerAntwortet) { return $true }; Start-Sleep 1 }
  return $false
}

Write-Host "`n=== 1. Erstinstallation"
Pruefe ((Installiere (Join-Path $PWD 'installation-1.log')) -eq 0) 'Setup endet ohne Fehler'
Pruefe (Test-Path "$programm\node\node.exe") 'mitgeliefertes Node installiert'
Pruefe (Test-Path "$programm\dist\server\index.js") 'Programm installiert'
Pruefe (Test-Path "$programm\windows\SumatraPDF.exe") 'SumatraPDF mitgeliefert'
Pruefe (Test-Path $daten) 'Datenordner angelegt'
Pruefe ($null -ne (Get-ScheduledTask -TaskName 'Fotobox Server' -ErrorAction SilentlyContinue)) 'Autostart Server eingerichtet'
Pruefe ($null -ne (Get-ScheduledTask -TaskName 'Fotobox Kiosk' -ErrorAction SilentlyContinue)) 'Autostart Kiosk eingerichtet'
$regeln = @(Get-NetFirewallRule -DisplayName 'Fotobox Galerie' -ErrorAction SilentlyContinue)
Pruefe ($regeln.Count -eq 1) "genau eine Firewall-Regel (gefunden: $($regeln.Count))"

Write-Host "`n=== 2. Server wie auf der Box (mit Mock-Hardware)"
# Die Autostart-Aufgabe braucht eine Anmeldung am Bildschirm, die es hier nicht
# gibt - also denselben Befehl von Hand starten, falls er nicht schon laeuft.
if (-not (ServerAntwortet)) {
  $env:FOTOBOX_HARDWARE = 'mock'
  Start-Process -FilePath "$programm\node\node.exe" -ArgumentList 'dist\server\index.js' `
    -WorkingDirectory $programm -WindowStyle Hidden
}
Pruefe (WarteAufServer 60) 'Server antwortet auf Port 8787'
$status = Invoke-RestMethod "http://127.0.0.1:$Port/api/admin/status"
Pruefe ($null -ne $status.version) "meldet Version $($status.version)"
Pruefe (Test-Path "$daten\fotobox.db") 'Datenbank im Datenordner'

Write-Host "`n=== 3. Update ueber die laufende Installation"
Pruefe ((Installiere (Join-Path $PWD 'installation-2.log')) -eq 0) 'Update-Setup endet ohne Fehler'
$sicherungen = @(Get-ChildItem "$daten\sicherungen" -Directory -Filter 'vor-update_*' -ErrorAction SilentlyContinue)
Pruefe ($sicherungen.Count -ge 1) 'Datenbank vor dem Update gesichert'
Pruefe ($sicherungen.Count -ge 1 -and (Test-Path (Join-Path $sicherungen[0].FullName 'fotobox.db'))) 'Sicherung enthaelt fotobox.db'
Pruefe (Test-Path "$programm\node\node.exe") 'Programm nach dem Update vollstaendig'
$regeln = @(Get-NetFirewallRule -DisplayName 'Fotobox Galerie' -ErrorAction SilentlyContinue)
Pruefe ($regeln.Count -eq 1) "nach dem Update weiter genau eine Firewall-Regel (gefunden: $($regeln.Count))"
$log = Get-Content (Join-Path $PWD 'installation-2.log') -Raw
Pruefe ($log -notmatch 'DeleteFile failed|RemoveDirectory failed|Failed to') 'keine gesperrten Dateien beim Austausch'

Write-Host "`n=== 4. Deinstallation"
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$programm*" } | Stop-Process -Force
$deinst = Get-ChildItem $programm -Filter 'unins*.exe' | Select-Object -First 1
Pruefe ((Starte $deinst.FullName @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')) -eq 0) 'Deinstallation endet ohne Fehler'
Start-Sleep 3
Pruefe (-not (Test-Path "$programm\dist")) 'Programm entfernt'
Pruefe ($null -eq (Get-ScheduledTask -TaskName 'Fotobox Server' -ErrorAction SilentlyContinue)) 'Autostart entfernt'
Pruefe (@(Get-NetFirewallRule -DisplayName 'Fotobox Galerie' -ErrorAction SilentlyContinue).Count -eq 0) 'Firewall-Regel entfernt'
Pruefe (Test-Path "$daten\fotobox.db") 'Daten bleiben erhalten'

if ($fehler.Count -gt 0) {
  Write-Host "`nPROBELAUF FEHLGESCHLAGEN:" -ForegroundColor Red
  $fehler | ForEach-Object { Write-Host "  - $_" }
  Write-Host "`n--- Protokoll der Erstinstallation (Ende) ---"
  Get-Content (Join-Path $PWD 'installation-1.log') -Tail 40 -ErrorAction SilentlyContinue
  Write-Host "`n--- Protokoll des Updates (Ende) ---"
  Get-Content (Join-Path $PWD 'installation-2.log') -Tail 40 -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "`nInstaller-Probelauf bestanden." -ForegroundColor Green
