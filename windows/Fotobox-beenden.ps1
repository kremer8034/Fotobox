# Beendet Server und Kiosk der Fotobox - vor einem Update und bei der
# Deinstallation. Auf Wunsch wird danach die Datenbank gesichert.
#
# Reihenfolge ist wichtig: Erst die beiden Neustart-Schleifen ("Fotobox
# starten.bat" und "Kiosk starten.bat"), dann Server und Browser. Andersherum
# oeffnet die Schleife den Browser drei Sekunden spaeter wieder und startet
# den Server mitten in den Dateiaustausch hinein.
#
# Aufruf: powershell -ExecutionPolicy Bypass -File Fotobox-beenden.ps1
#           -Projektordner "C:\Program Files\Fotobox" [-Sicherung]

param(
  [string]$Projektordner = (Split-Path -Parent $PSScriptRoot),
  [string]$Datenordner = $(if ($env:FOTOBOX_DATEN) { $env:FOTOBOX_DATEN } else { Join-Path $env:PUBLIC 'Fotobox-Daten' }),
  [switch]$Sicherung,
  [int]$Port = 8787,
  [int]$SicherungenBehalten = 5
)

$ErrorActionPreference = 'Continue'

function Beende($prozesse) {
  foreach ($p in $prozesse) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

foreach ($name in @('Fotobox Server', 'Fotobox Kiosk')) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
}

$alle = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)

# 1. Die Neustart-Schleifen
Beende ($alle | Where-Object {
  $_.Name -eq 'cmd.exe' -and $_.CommandLine -and
  ($_.CommandLine -like '*Fotobox starten.bat*' -or $_.CommandLine -like '*Kiosk starten.bat*')
})

# 2. Der Server: das mitgelieferte Node aus dem Programmordner
$ordner = [System.IO.Path]::GetFullPath($Projektordner).TrimEnd('\') + '\'
$server = @($alle | Where-Object {
  $_.Name -eq 'node.exe' -and $_.ExecutablePath -and
  $_.ExecutablePath.StartsWith($ordner, [System.StringComparison]::OrdinalIgnoreCase)
})
# Dazu jedes Node, das den Port der Fotobox belegt - etwa aus einer frueheren
# Installation aus dem Quelltext, die das Node des Systems benutzte. Liefe es
# weiter, faende der neue Server seinen Port besetzt.
$belegt = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
$server += @($alle | Where-Object { $_.Name -eq 'node.exe' -and $belegt -contains $_.ProcessId })
Beende $server

# 3. Der Kiosk-Browser - nur die Instanz mit dem Fotobox-Profil
Beende ($alle | Where-Object {
  ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -like '*Fotobox-Kiosk*'
})

# Warten, bis der Server wirklich weg ist - vorher sind seine Dateien gesperrt.
for ($i = 0; $i -lt 20; $i++) {
  $noch = @($server | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
  if ($noch.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
Write-Host "Fotobox beendet."

# 4. Sicherung der Datenbank. Nach dem Beenden sind Hauptdatei und
# Write-Ahead-Log in sich stimmig; beide zusammen ergeben den vollen Stand.
if ($Sicherung) {
  $db = Join-Path $Datenordner 'fotobox.db'
  if (Test-Path $db) {
    $wurzel = Join-Path $Datenordner 'sicherungen'
    $ziel = Join-Path $wurzel ('vor-update_' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'))
    New-Item -ItemType Directory -Force -Path $ziel | Out-Null
    foreach ($endung in @('', '-wal', '-shm')) {
      $datei = "$db$endung"
      if (Test-Path $datei) { Copy-Item $datei $ziel -Force }
    }
    Write-Host "Datenbank gesichert nach $ziel"

    # Nur die letzten Sicherungen behalten - die Fotos selbst werden nicht
    # angefasst, eine Datenbank ist wenige Megabyte gross.
    Get-ChildItem $wurzel -Directory -Filter 'vor-update_*' |
      Sort-Object Name -Descending |
      Select-Object -Skip $SicherungenBehalten |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }
}
exit 0
