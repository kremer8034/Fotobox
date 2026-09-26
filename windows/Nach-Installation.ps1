# Startet die Fotobox nach der Installation - als der Benutzer, der an der
# Box angemeldet ist (der Installer ruft es mit "runasoriginaluser" auf).
#
#   -Modus Erstinstallation   Nur den Server starten und die Verwaltung im
#                             normalen Browser oeffnen. Der Kiosk wuerde sonst
#                             im Vollbild aufgehen, bevor eine Besitzer-PIN
#                             existiert - und ohne PIN kommt man aus dem
#                             Kiosk nicht mehr heraus.
#   -Modus Update             Server und Kiosk wieder starten, so wie die Box
#                             vor dem Update lief.

param(
  [ValidateSet('Erstinstallation', 'Update')]
  [string]$Modus = 'Update',
  [int]$Port = 8787
)

Start-ScheduledTask -TaskName 'Fotobox Server' -ErrorAction SilentlyContinue

if ($Modus -eq 'Update') {
  # Der Kiosk wartet selbst, bis der Server antwortet.
  Start-ScheduledTask -TaskName 'Fotobox Kiosk' -ErrorAction SilentlyContinue
  exit 0
}

# Erstinstallation: warten, bis der Server antwortet, dann die Verwaltung.
$adresse = "http://127.0.0.1:$Port"
for ($i = 0; $i -lt 60; $i++) {
  try {
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$adresse/api/kiosk/start" | Out-Null
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
Start-Process "$adresse/admin"
