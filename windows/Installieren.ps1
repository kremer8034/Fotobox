<#
  Erstinstallation der Fotobox auf einem Windows-PC.

  Ein Aufruf statt sechs Handgriffen: prueft Node.js, holt die Abhaengigkeiten,
  baut die Oberflaeche, richtet den Autostart ein und sagt am Ende, was noch
  von Hand fehlt.

  Aufruf (Rechtsklick auf die Datei -> "Mit PowerShell ausfuehren"), oder:
    powershell -ExecutionPolicy Bypass -File windows\Installieren.ps1

  Einmal als Administrator ausgefuehrt, legt es zusaetzlich die
  Firewall-Freigabe fuer die Handy-Galerie an. Ohne Adminrechte laeuft alles
  andere trotzdem durch - die Fotobox selbst braucht keine erhoehten Rechte.
#>

param(
  [int]$Port = 8787,
  [switch]$OhneAutostart
)

$ErrorActionPreference = 'Stop'
$Projekt = Split-Path -Parent $PSScriptRoot
Set-Location $Projekt

function Schritt($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Gut($text)     { Write-Host "  OK  $text" -ForegroundColor Green }
function Hinweis($text) { Write-Host "  !   $text" -ForegroundColor Yellow }
function Fehler($text)  { Write-Host "  X   $text" -ForegroundColor Red }

Write-Host "Fotobox einrichten" -ForegroundColor White
Write-Host "Projektordner: $Projekt"

# --------------------------------------------------------------- Node.js
Schritt "Node.js"
$nodeDa = $false
try {
  $version = (& node --version) 2>$null
  if ($version -match 'v(\d+)\.') {
    $haupt = [int]$Matches[1]
    if ($haupt -ge 22) { Gut "Node $version gefunden"; $nodeDa = $true }
    else { Hinweis "Node $version ist zu alt, gebraucht wird mindestens v22." }
  }
} catch { }

if (-not $nodeDa) {
  Hinweis "Node.js fehlt oder ist zu alt. Versuche die Installation ueber winget."
  try {
    & winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    # winget aendert PATH erst fuer neue Fenster - deshalb hier nachziehen.
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $version = (& node --version) 2>$null
    if ($version) { Gut "Node $version installiert" }
    else { throw "Node ist nach der Installation noch nicht im Pfad." }
  } catch {
    Fehler "Node.js konnte nicht automatisch installiert werden."
    Write-Host "  Bitte von https://nodejs.org (LTS) installieren und dieses Skript erneut starten."
    exit 1
  }
}

# ---------------------------------------------------------- Abhaengigkeiten
Schritt "Abhaengigkeiten holen (braucht einmalig Internet)"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fehler "npm install ist fehlgeschlagen."; exit 1 }
Gut "Abhaengigkeiten installiert"

Schritt "Oberflaeche und Server bauen"
& npm run build
if ($LASTEXITCODE -ne 0) { Fehler "Der Build ist fehlgeschlagen."; exit 1 }
Gut "Gebaut"

Schritt "Kurzer Selbsttest"
& npm test
if ($LASTEXITCODE -ne 0) { Hinweis "Tests sind nicht durchgelaufen - bitte die Ausgabe oben ansehen." }
else { Gut "Alle Tests bestanden" }

# ------------------------------------------------------------- Datenordner
Schritt "Datenordner"
$daten = if ($env:FOTOBOX_DATEN) { $env:FOTOBOX_DATEN } else { Join-Path $env:PUBLIC 'Fotobox-Daten' }
New-Item -ItemType Directory -Force -Path $daten | Out-Null
Gut "Daten liegen unter $daten"

# ------------------------------------------------------------ Zusatzsoftware
Schritt "Zusatzprogramme"

$dcc = @(
  "$env:ProgramFiles\digiCamControl\CameraControl.exe",
  "${env:ProgramFiles(x86)}\digiCamControl\CameraControl.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($dcc) {
  Gut "digiCamControl gefunden: $dcc"
  Hinweis "Bitte einmal starten und unter Einstellungen den Webserver auf Port 5513 einschalten."
} else {
  Hinweis "digiCamControl fehlt. Ohne das Programm loest die Kamera nicht aus."
  Write-Host "  Download: https://digicamcontrol.com/download"
}

$sumatra = @(
  "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe",
  "${env:ProgramFiles(x86)}\SumatraPDF\SumatraPDF.exe",
  "$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe",
  (Join-Path $Projekt 'windows\SumatraPDF.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($sumatra) {
  Gut "SumatraPDF gefunden: $sumatra"
  Write-Host "  Diesen Pfad spaeter unter Geraet > Drucker eintragen."
} else {
  Hinweis "SumatraPDF fehlt. Ohne das Programm kann Windows nicht dialogfrei drucken."
  Write-Host "  Download: https://www.sumatrapdfreader.org/download-free-pdf-viewer"
  Write-Host "  Die portable Fassung reicht - einfach nach windows\SumatraPDF.exe legen."
}

# ------------------------------------------------------------- Drucker
Schritt "Drucker"
$drucker = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue |
           Where-Object { $_.Name -match 'DNP|DS-RX|RX1' }
if ($drucker) {
  foreach ($d in $drucker) { Gut "Gefunden: $($d.Name)" }
  Write-Host "  Diesen Namen unter Geraet > Drucker eintragen."
  Write-Host "  Im Treiber pruefen: randlos, Papierformat 10x15, ICC-Farbprofil."
} else {
  Hinweis "Kein DNP-Drucker gefunden. Ist er eingeschaltet und der Treiber installiert?"
}

# ------------------------------------------------------------- Einrichtung
if (-not $OhneAutostart) {
  Schritt "Autostart und Windows-Einstellungen"
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Einrichtung.ps1') -Port $Port -Projektordner $Projekt
}

# ------------------------------------------------------------- Abschluss
Write-Host "`n============================================" -ForegroundColor White
Write-Host " Fertig. So geht es weiter:" -ForegroundColor White
Write-Host "============================================" -ForegroundColor White
Write-Host ""
Write-Host " 1. Server starten:   windows\Fotobox starten.bat"
Write-Host " 2. Verwaltung oeffnen: http://127.0.0.1:$Port/admin"
Write-Host " 3. Unter Geraet eintragen: Besitzer-PIN, Druckername, SumatraPDF-Pfad"
Write-Host " 4. Kalibrier-Testbild drucken und die Werte eintragen"
Write-Host " 5. Erste Veranstaltung anlegen und den Startbereit-Check laufen lassen"
Write-Host ""
Write-Host " Ausfuehrlich in docs\Inbetriebnahme.md" -ForegroundColor Cyan
Write-Host ""
