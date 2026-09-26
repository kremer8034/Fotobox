# Richtet die Fotobox unter Windows ein.
#
# Zwei Teile mit unterschiedlichen Rechten:
#
#   -Teil Autostart   als der Benutzer, der an der Box angemeldet ist (ohne
#                     Adminrechte): zwei Aufgaben "bei Anmeldung" fuer Server
#                     und Kiosk, Pruefung der Anzeigeskalierung.
#   -Teil System      mit Adminrechten: Firewall-Freigabe fuer die
#                     Handy-Galerie, Energiesparen aus, keine Update-Neustarts
#                     waehrend jemand angemeldet ist.
#   -Teil Entfernen   mit Adminrechten: Aufgaben und Firewall-Regel wieder weg
#                     (fuer die Deinstallation).
#   -Teil Alles       beides nacheinander (Vorgabe, fuer Installieren.bat).
#
# Der Installer ruft "Autostart" bewusst als urspruenglicher Benutzer auf:
# Vorher liefen beide Teile mit erhoehten Rechten, und die Aufgaben gehoerten
# dann dem Administratorkonto - auf einem PC mit getrenntem Admin-Konto
# starteten Server und Kiosk beim Anmelden des Alltagsbenutzers gar nicht.
#
# Aufruf:  powershell -ExecutionPolicy Bypass -File Einrichtung.ps1 [-Teil ...]

param(
  [ValidateSet('Alles', 'Autostart', 'System', 'Entfernen')]
  [string]$Teil = 'Alles',
  [int]$Port = 8787,
  [string]$Projektordner = (Split-Path -Parent $PSScriptRoot)
)

$AUFGABEN = @('Fotobox Server', 'Fotobox Kiosk')
$FIREWALL_NAME = 'Fotobox Galerie'

function Gut($text)     { Write-Host "  OK  $text" -ForegroundColor Green }
function Hinweis($text) { Write-Host "  !   $text" -ForegroundColor Yellow }

function Richte-AutostartEin {
  $benutzer = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $serverBat = Join-Path $Projektordner 'windows\Fotobox starten.bat'
  $kioskBat  = Join-Path $Projektordner 'windows\Kiosk starten.bat'

  foreach ($eintrag in @(
      @{ Name = $AUFGABEN[0]; Datei = $serverBat; Titel = 'Fotobox Server'; Verzoegerung = 'PT5S' },
      @{ Name = $AUFGABEN[1]; Datei = $kioskBat;  Titel = 'Fotobox Kiosk';  Verzoegerung = 'PT20S' })) {
    # Minimiert starten: Das Konsolenfenster des Servers stand sonst offen auf
    # dem Desktop, und wer es schloss, beendete den Server. Die Neustart-
    # Schleife steckt in der .bat selbst.
    $argumente = "/c start `"$($eintrag.Titel)`" /min `"$($eintrag.Datei)`""
    $aktion    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argumente -WorkingDirectory $Projektordner
    $ausloeser = New-ScheduledTaskTrigger -AtLogOn -User $benutzer
    $ausloeser.Delay = $eintrag.Verzoegerung
    $wer       = New-ScheduledTaskPrincipal -UserId $benutzer -LogonType Interactive -RunLevel Limited
    $einst     = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                   -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $eintrag.Name -Action $aktion -Trigger $ausloeser `
        -Principal $wer -Settings $einst -Force | Out-Null
    Gut "Autostart fuer $benutzer eingerichtet: $($eintrag.Name)"
  }

  # Anzeigeskalierung pruefen. Bei 150 % meldet der Browser nur 1280x720, und
  # saemtliche Millimeter-Masse der Oberflaeche verschieben sich. Die
  # Einstellung gehoert dem Benutzer - deshalb in diesem Teil.
  $dpi = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels -ErrorAction SilentlyContinue).LogPixels
  if ($dpi -and $dpi -ne 96) {
    Hinweis "Anzeigeskalierung steht auf $([math]::Round($dpi/96*100))%. Bitte auf 100% stellen."
  } else {
    Gut 'Anzeigeskalierung ist 100%'
  }
}

function Richte-SystemEin {
  # Eng begrenzt: nur dieser eine Port, nur im privaten Netzwerkprofil. Eine
  # vorhandene Regel wird ersetzt - vorher kam bei jedem Lauf eine weitere
  # gleichnamige Regel dazu.
  Get-NetFirewallRule -DisplayName $FIREWALL_NAME -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $FIREWALL_NAME -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort $Port -Profile Private | Out-Null
  Gut "Firewall-Freigabe fuer Port $Port (nur privates Netz)"

  powercfg /change monitor-timeout-ac 0
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  Gut 'Bildschirm, Standby und Ruhezustand abgeschaltet (am Netzteil)'

  # Kein Neustart fuer Updates, solange jemand angemeldet ist - sonst startet
  # Windows mitten in der Feier neu. Wirkt voll unter Windows Pro; Windows Home
  # beachtet es nur teilweise, dort zusaetzlich die Nutzungszeit einstellen.
  $au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
  New-Item -Path $au -Force | Out-Null
  Set-ItemProperty -Path $au -Name NoAutoRebootWithLoggedOnUsers -Type DWord -Value 1
  Gut 'Keine automatischen Update-Neustarts, solange jemand angemeldet ist'
}

function Entferne-Einrichtung {
  foreach ($name in $AUFGABEN) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  }
  Get-NetFirewallRule -DisplayName $FIREWALL_NAME -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Gut 'Autostart und Firewall-Freigabe entfernt'
}

$istAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host "Fotobox einrichten ($Teil)" -ForegroundColor Cyan
Write-Host "Projektordner: $Projektordner"

switch ($Teil) {
  'Autostart' { Richte-AutostartEin }
  'System'    {
    if (-not $istAdmin) { Hinweis 'Fuer diesen Teil sind Administratorrechte noetig.'; exit 1 }
    Richte-SystemEin
  }
  'Entfernen' { Entferne-Einrichtung }
  'Alles'     {
    Richte-AutostartEin
    if ($istAdmin) { Richte-SystemEin }
    else {
      Hinweis 'Ohne Adminrechte fehlen Firewall-Freigabe und Energieeinstellungen.'
      Hinweis 'Dieses Skript einmalig als Administrator ausfuehren.'
    }
  }
}
