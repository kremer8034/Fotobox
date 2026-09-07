# Richtet die Fotobox unter Windows ein.
#
# Zwei Dinge brauchen einmalig Administratorrechte: die Firewall-Freigabe und
# das Abschalten der Update-Neustarts. Alles andere - auch der Autostart -
# laeuft bewusst ohne erhoehte Rechte.
#
# Aufruf:  powershell -ExecutionPolicy Bypass -File Einrichtung.ps1

param(
  [int]$Port = 8787,
  [string]$Projektordner = (Split-Path -Parent $PSScriptRoot)
)

Write-Host "Fotobox einrichten" -ForegroundColor Cyan
Write-Host "Projektordner: $Projektordner"

# --- Autostart ohne Adminrechte: zwei Aufgaben "bei Anmeldung" -------------
$serverBat = Join-Path $Projektordner 'windows\Fotobox starten.bat'
$kioskBat  = Join-Path $Projektordner 'windows\Kiosk starten.bat'

foreach ($eintrag in @(
    @{ Name = 'Fotobox Server'; Datei = $serverBat; Verzoegerung = 'PT5S' },
    @{ Name = 'Fotobox Kiosk';  Datei = $kioskBat;  Verzoegerung = 'PT20S' })) {
  $aktion  = New-ScheduledTaskAction -Execute $eintrag.Datei
  $ausloes = New-ScheduledTaskTrigger -AtLogOn
  $ausloes.Delay = $eintrag.Verzoegerung
  $einst   = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
                -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $eintrag.Name -Action $aktion -Trigger $ausloes `
      -Settings $einst -Force | Out-Null
  Write-Host "  Autostart eingerichtet: $($eintrag.Name)" -ForegroundColor Green
}

# --- Windows fuer den Eventbetrieb vorbereiten ------------------------------
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
Write-Host "  Bildschirm und Standby abgeschaltet" -ForegroundColor Green

# Anzeigeskalierung pruefen. Bei 150 % meldet der Browser nur 1280x720 und
# saemtliche Millimeter-Masse der Oberflaeche verschieben sich.
Add-Type -AssemblyName System.Windows.Forms
$dpi = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels -ErrorAction SilentlyContinue).LogPixels
if ($dpi -and $dpi -ne 96) {
  Write-Host "  ACHTUNG: Anzeigeskalierung steht auf $([math]::Round($dpi/96*100))%. Bitte auf 100% stellen." -ForegroundColor Yellow
} else {
  Write-Host "  Anzeigeskalierung ist 100%" -ForegroundColor Green
}

# --- Adminrechte noetig -----------------------------------------------------
$istAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if ($istAdmin) {
  # Eng begrenzt: nur dieser eine Port, nur im privaten Netzwerkprofil.
  New-NetFirewallRule -DisplayName "Fotobox Galerie" -Direction Inbound `
      -Action Allow -Protocol TCP -LocalPort $Port -Profile Private `
      -ErrorAction SilentlyContinue | Out-Null
  Write-Host "  Firewall-Freigabe fuer Port $Port (nur privates Netz)" -ForegroundColor Green
} else {
  Write-Host "  Hinweis: Ohne Adminrechte fehlt die Firewall-Freigabe fuer die Galerie." -ForegroundColor Yellow
  Write-Host "  Dieses Skript einmalig als Administrator ausfuehren." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Noch von Hand zu erledigen:" -ForegroundColor Cyan
Write-Host "  - Im DNP-Treiber: randlos, Papierformat 10x15 und das ICC-Farbprofil setzen"
Write-Host "  - digiCamControl installieren und dessen Webserver auf Port 5513 einschalten"
Write-Host "  - SumatraPDF ablegen und den Pfad unter Geraet > Drucker eintragen"
Write-Host "  - Besitzer-PIN vergeben (ohne sie startet keine Veranstaltung)"
Write-Host "  - Benachrichtigungen stummschalten (Fokusassistent)"
