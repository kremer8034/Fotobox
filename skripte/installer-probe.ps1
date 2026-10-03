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
Pruefe (Test-Path $daten) 'Datenordner angelegt'
Pruefe ($null -ne (Get-ScheduledTask -TaskName 'Fotobox Server' -ErrorAction SilentlyContinue)) 'Autostart Server eingerichtet'
Pruefe ($null -ne (Get-ScheduledTask -TaskName 'Fotobox Kiosk' -ErrorAction SilentlyContinue)) 'Autostart Kiosk eingerichtet'
$regeln = @(Get-NetFirewallRule -DisplayName 'Fotobox Galerie' -ErrorAction SilentlyContinue)
Pruefe ($regeln.Count -eq 1) "genau eine Firewall-Regel (gefunden: $($regeln.Count))"
# Bis 1.0.4 nur "Privat" - Windows 11 stuft neue WLANs aber als "Oeffentlich" ein.
Pruefe ($regeln.Count -eq 1 -and "$($regeln[0].Profile)" -eq 'Any') "Firewall-Regel gilt fuer alle Netzwerkprofile (ist: $($regeln[0].Profile))"

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

Write-Host "`n=== 2b. Druck bis in die Windows-Warteschlange"
# Genau der Weg der Box: Seitenbild erzeugen und ueber den Druckhelfer an
# einen Windows-Drucker schicken. Bis 1.0.3 meldete der Druck auf der Box
# "erledigt", ohne dass in der Windows-Druckerwarteschlange je ein Auftrag
# ankam. Deshalb prueft der Test genau dort: Der Probedrucker wird
# angehalten, der Auftrag muss dann in seiner Warteschlange stehen.
$druckOrdner = 'C:\fotobox-druckprobe'
New-Item -ItemType Directory -Force $druckOrdner | Out-Null
$ausgabe = Join-Path $druckOrdner 'gedruckt.pdf'
$probeDrucker = 'Fotobox Druckprobe'
$druckerDa = $false
try {
  Start-Service Spooler -ErrorAction SilentlyContinue
  Add-PrinterPort -Name $ausgabe
  Add-Printer -Name $probeDrucker -DriverName 'Microsoft Print To PDF' -PortName $ausgabe
  Get-CimInstance Win32_Printer -Filter "Name='$probeDrucker'" | Invoke-CimMethod -MethodName Pause | Out-Null
  $druckerDa = $true
} catch { Write-Host "  Probedrucker nicht angelegt: $($_.Exception.Message)" }
Pruefe $druckerDa 'Probedrucker angelegt und angehalten'
if ($druckerDa) {
  $env:PROBE_PROGRAMM = $programm
  $env:PROBE_ORDNER = $druckOrdner
  $druckSkript = @'
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const p = process.env.PROBE_PROGRAMM, o = process.env.PROBE_ORDNER;
const lade = (...teile) => import(pathToFileURL(join(p, 'dist', ...teile)).href);
const { schreibeDruckPdf } = await lade('server', 'bild', 'pdf.js');
const { kalibrierTestbild } = await lade('server', 'bild', 'testbilder.js');
const { CANVAS_PRESETS, KALIBRIERUNG_VORGABE } = await lade('shared', 'typen.js');
const { WindowsDrucker } = await lade('server', 'treiber', 'drucker-windows.js');
const canvas = CANVAS_PRESETS['10x15-quer'];
const pdf = join(o, 'probe.pdf');
await schreibeDruckPdf(await kalibrierTestbild(canvas), pdf, { canvas, kalibrierung: KALIBRIERUNG_VORGABE });
console.log('Druckhelfer: ' + (await new WindowsDrucker('Fotobox Druckprobe').drucke(pdf, 2)));
try {
  await new WindowsDrucker('Gibt es nicht').drucke(pdf, 1);
  console.error('Ein unbekannter Drucker galt als gedruckt.');
  process.exit(2);
} catch (f) {
  console.log('Unbekannter Drucker: ' + f.message);
  if (!/kennt keinen Drucker/.test(f.message)) process.exit(3);
}
'@
  & "$programm\node\node.exe" --input-type=module -e $druckSkript
  Pruefe ($LASTEXITCODE -eq 0) "Druckhelfer druckt und meldet Fehler im Klartext (Code $LASTEXITCODE)"
  $auftraege = @(Get-PrintJob -PrinterName $probeDrucker -ErrorAction SilentlyContinue)
  $auftraege | ForEach-Object { Write-Host "  Warteschlange: $($_.DocumentName), $($_.TotalPages) Seite(n), $($_.JobStatus)" }
  Pruefe ($auftraege.Count -ge 1 -and $auftraege[0].DocumentName -like 'Fotobox*') 'Auftrag liegt in der Windows-Druckerwarteschlange'
  # Weiterlaufen lassen - ob die Datei ankommt, haengt am Testrechner, nicht an
  # der Fotobox. Deshalb nur zur Information.
  Get-CimInstance Win32_Printer -Filter "Name='$probeDrucker'" | Invoke-CimMethod -MethodName Resume | Out-Null
  $angekommen = $false
  for ($i = 0; $i -lt 30 -and -not $angekommen; $i++) {
    Start-Sleep 1
    $angekommen = (Test-Path $ausgabe) -and ((Get-Item $ausgabe).Length -gt 1000)
  }
  Write-Host "  Info: Ausgabedatei des Probedruckers $(if ($angekommen) { 'geschrieben' } else { 'nicht geschrieben' })"
  Remove-Printer -Name $probeDrucker -ErrorAction SilentlyContinue
}

Write-Host "`n=== 2c. Kiosk schliessen beendet den Kiosk-Browser"
# Der Knopf im Servicemenue meldete auf der Box "Kiosk wird geschlossen",
# der Browser blieb aber offen. Hier ein echter Chrome mit dem Kiosk-Profil.
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
function KioskBrowser {
  return @(Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -like '*Fotobox-Kiosk*' -and ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe')
    })
}
if (-not $browser) {
  Pruefe $false 'Chrome oder Edge fuer den Test vorhanden'
} else {
  $profil = Join-Path $env:TEMP 'Fotobox-Kiosk'
  Start-Process $browser -ArgumentList @('--headless=new', '--remote-debugging-port=9333', '--no-first-run', "--user-data-dir=$profil", 'about:blank') | Out-Null
  $laeuft = $false
  for ($i = 0; $i -lt 30 -and -not $laeuft; $i++) { Start-Sleep 1; $laeuft = (KioskBrowser).Count -gt 0 }
  Pruefe $laeuft 'Kiosk-Browser fuer den Test gestartet'
  $modul = 'file:///' + ("$programm\dist\server\fach\kiosk-browser.js" -replace '\\', '/')
  $skript = "import('$modul').then((m) => m.schliesseKioskBrowser(0)).then((n) => { console.log('beendet: ' + n); process.exit(n > 0 ? 0 : 1); }, (f) => { console.error(f.message); process.exit(1); })"
  & "$programm\node\node.exe" --input-type=module -e $skript
  Pruefe ($LASTEXITCODE -eq 0) 'Kiosk schliessen findet den Browser'
  $weg = $false
  for ($i = 0; $i -lt 10 -and -not $weg; $i++) { Start-Sleep 1; $weg = (KioskBrowser).Count -eq 0 }
  Pruefe $weg 'Kiosk-Browser ist zu'
}

Write-Host "`n=== 2d. Papiervorrat: Abfrageweg ueber CspStat.dll"
# Einen DNP-Drucker gibt es hier nicht. Geprueft wird der ganze Weg bis zur
# DLL: richtige PowerShell (32/64 Bit), C#-Teil uebersetzt, DLL geladen. Eine
# Windows-DLL ohne die DNP-Funktionen muss mit lesbarer Meldung scheitern.
$vorratSkript = @'
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const m = await import(pathToFileURL(join(process.env.PROBE_PROGRAMM, 'dist', 'server', 'treiber', 'dnp-vorrat.js')).href);
let fehler = 0;
for (const ordner of ['SysWOW64', 'System32']) {
  const dll = join(process.env.SystemRoot, ordner, 'kernel32.dll');
  try {
    await m.leseDnpVorrat(dll);
    console.error(ordner + ': galt als DNP-Drucker');
    fehler++;
  } catch (f) {
    console.log(ordner + ' (' + m.dllBitbreite(dll) + ' Bit): ' + f.message);
    if (!/GetPrinterPortNum/.test(f.message)) fehler++;
  }
}
process.exit(fehler);
'@
$env:PROBE_PROGRAMM = $programm
& "$programm\node\node.exe" --input-type=module -e $vorratSkript
Pruefe ($LASTEXITCODE -eq 0) "Vorrat-Abfrage laedt DLLs in 32 und 64 Bit und meldet Fehler lesbar (Code $LASTEXITCODE)"

Write-Host "`n=== 2e. Netzdiagnose der Galerie und Ordnerdialog fuer die Uebergabe"
$netzSkript = @'
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const lade = (...t) => import(pathToFileURL(join(process.env.PROBE_PROGRAMM, 'dist', 'server', ...t)).href);
const netz = await lade('netzwerk.js');
const dialog = await lade('fach', 'ordnerdialog.js');
await netz.aktualisiereRoutenAdresse();
const adresse = netz.lanAdresse();
const d = adresse ? await netz.netzDiagnose(adresse) : null;
console.log('Adresse: ' + adresse + ' / Diagnose: ' + JSON.stringify(d) + ' / blockiert: ' + (d && netz.galerieBlockiert(d)));
// Den Dialog nur uebersetzen, nicht zeigen - auf dem Testrechner klickt niemand.
let dialogOk = false;
try { dialogOk = (await dialog.waehleOrdner('Probe', '', true)) === null; } catch (f) { console.error('Ordnerdialog: ' + f.message); }
console.log('Ordnerdialog uebersetzt: ' + dialogOk);
let fehler = 0;
if (!adresse || !d || !d.regel || d.regelProfile !== 'Any') fehler++;
if (!dialogOk) fehler++;
process.exit(fehler);
'@
$env:PROBE_PROGRAMM = $programm
& "$programm\node\node.exe" --input-type=module -e $netzSkript
Pruefe ($LASTEXITCODE -eq 0) "Netzdiagnose findet die Firewall-Freigabe, Ordnerdialog laesst sich uebersetzen (Code $LASTEXITCODE)"

Write-Host "`n=== 2f. Captive Portal: Diagnose, Dienste, Einrichtungs-Skripte"
# Haelt ein Windows-Webdienst Anschluss 80 (auf dem Testrechner moeglich, auf
# der Box auch), muss die Selbstdiagnose ihn mit Namen nennen.
$l80 = @(Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '0.0.0.0' })
Write-Host "Anschluss 80 vorher: $(if ($l80) { ($l80 | ForEach-Object { "$($_.LocalAddress) Prozess $($_.OwningProcess)" }) -join '; ' } else { 'frei' })"
$env:PROBE_P80 = if ($l80) { '1' } else { '0' }
$portalSkript = @'
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const lade = (...t) => import(pathToFileURL(join(process.env.PROBE_PROGRAMM, 'dist', 'server', 'portal', ...t)).href);
const diagnose = await lade('diagnose.js');
const { DnsDienst } = await lade('dns.js');
const { DhcpDienst } = await lade('dhcp.js');
const { PortalDienst } = await lade('http.js');
let fehler = 0;
// Die Selbstdiagnose liest Windows aus - der PowerShell-Teil muss laufen und sich deuten lassen.
try {
  const roh = await diagnose.leseRohdiagnose();
  const d = diagnose.bewerte(roh, { vonets: null, anschluesse: [], zustand: null, schalter: false });
  console.log('Diagnose: ' + roh.adapter.length + ' Kabel-Anschluss/-Anschluesse, ' + d.zeilen.length + ' Zeilen, Anschluss 80: ' + (roh.port80 ?? 'frei'));
  if (process.env.PROBE_P80 === '1' && !roh.port80) { console.error('Diagnose: Anschluss 80 ist belegt, die Diagnose sieht es nicht'); fehler++; }
} catch (f) { console.error('Diagnose: ' + f.message); fehler++; }
if (process.env.PROBE_NUR_DIAGNOSE === '1') process.exit(fehler);
// Die Dienste muessen sich unter Windows an ihre echten Anschluesse binden lassen.
for (const [name, dienst] of [
  ['DHCP 67', new DhcpDienst('127.0.0.1', 67)],
  ['DNS 53', new DnsDienst('127.0.0.1', 53)],
  ['Portal 80', new PortalDienst(() => 'http://127.0.0.1/', '127.0.0.1', 80)],
]) {
  try { await dienst.starte(); await dienst.stoppe(); console.log(name + ': ok'); }
  catch (f) { console.error(name + ': ' + f.message); fehler++; }
}
// Die Einrichtungs-Skripte nur auf Syntax pruefen - ausfuehren wuerde dem Testrechner das Netz umstellen.
const { writeFileSync } = await import('node:fs');
writeFileSync(join(process.env.TEMP, 'portal-ein.ps1'), diagnose.einrichtenSkript(1));
writeFileSync(join(process.env.TEMP, 'portal-aus.ps1'), diagnose.zuruecksetzenSkript(1));
process.exit(fehler);
'@
$env:PROBE_PROGRAMM = $programm
$env:PROBE_NUR_DIAGNOSE = '1'
& "$programm\node\node.exe" --input-type=module -e $portalSkript
Pruefe ($LASTEXITCODE -eq 0) "Portal: Selbstdiagnose liest Windows und erkennt einen belegten Anschluss 80 (Code $LASTEXITCODE)"
# Dann Anschluss 80 freimachen - so, wie es die Diagnose auf der Box empfiehlt.
foreach ($dienst in 'W3SVC', 'WAS', 'PeerDistSvc', 'MsDepSvc') {
  if ((Get-Service $dienst -ErrorAction SilentlyContinue).Status -eq 'Running') {
    Stop-Service $dienst -Force -ErrorAction SilentlyContinue
    Write-Host "Dienst angehalten: $dienst"
  }
}
$env:PROBE_NUR_DIAGNOSE = '0'
& "$programm\node\node.exe" --input-type=module -e $portalSkript
if ($LASTEXITCODE -ne 0) {
  Write-Host "Anschluss 80 nachher:"
  Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | Format-Table LocalAddress, OwningProcess | Out-String | Write-Host
  netsh http show servicestate view=requestq verbose=no | Select-String -Pattern ':80[/:]' -Context 3, 0 | Out-String | Write-Host
}
Pruefe ($LASTEXITCODE -eq 0) "Portal: Dienste binden 53/67/80 (Code $LASTEXITCODE)"
foreach ($datei in 'portal-ein.ps1', 'portal-aus.ps1') {
  $syntax = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $env:TEMP $datei), [ref]$null, [ref]$syntax) | Out-Null
  Pruefe ($syntax.Count -eq 0) "Portal: $datei ist gueltiges PowerShell ($($syntax | ForEach-Object { $_.Message }))"
}

Write-Host "`n=== 3. Update ueber die laufende Installation - so, wie es die Verwaltung startet"
# Genau der Weg aus der Verwaltung ("Jetzt installieren"): starteMitRueckfrage
# aus dem installierten Programm, mit dem mitgelieferten Node. Vorher war
# dieser Weg nur unter Linux getestet - auf der Box kam die Rueckfrage nie.
$log2 = Join-Path $PWD 'installation-2.log'
$env:PROBE_SETUP = (Resolve-Path $Setup).Path
$env:PROBE_LOG = $log2
$modul = 'file:///' + ("$programm\dist\server\fach\aktualisierung.js" -replace '\\', '/')
$skript = "import('$modul').then((m) => m.starteMitRueckfrage(process.env.PROBE_SETUP, process.env.PROBE_LOG)).then(() => console.log('Setup gestartet'), (f) => { console.error(f.message); process.exit(1); })"
& "$programm\node\node.exe" --input-type=module -e $skript
Pruefe ($LASTEXITCODE -eq 0) 'Update-Setup ueber die Verwaltung gestartet'
$fertig = $false
for ($i = 0; $i -lt 300 -and -not $fertig; $i++) {
  Start-Sleep 1
  if (Test-Path $log2) { $fertig = [bool]((Get-Content $log2 -Raw -ErrorAction SilentlyContinue) -match 'Log closed') }
}
if (-not $fertig) {
  # Was laeuft da noch - und hat das Setup ueberhaupt ein Protokoll angelegt?
  Write-Host "`n--- Prozesse rund um das Setup ---"
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -like '*Setup*' -or $_.Name -like 'is-*' -or $_.Name -like '*.tmp' -or $_.CommandLine -like '*Fotobox-Setup*'
  } | ForEach-Object { Write-Host "  $($_.ProcessId) $($_.Name): $($_.CommandLine)" }
  Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { Write-Host "  Fenster: $($_.ProcessName) - $($_.MainWindowTitle)" }
  $temp = Get-ChildItem $env:TEMP -Filter 'Setup Log*.txt' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($temp) { Write-Host "`n--- $($temp.FullName) ---"; Get-Content $temp.FullName -Tail 40 }
}
Pruefe $fertig 'Update-Setup ist durchgelaufen'
Pruefe ([bool]((Get-Content $log2 -Raw -ErrorAction SilentlyContinue) -match 'Installation process succeeded')) 'Update-Setup meldet Erfolg'
$sicherungen = @(Get-ChildItem "$daten\sicherungen" -Directory -Filter 'vor-update_*' -ErrorAction SilentlyContinue)
Pruefe ($sicherungen.Count -ge 1) 'Datenbank vor dem Update gesichert'
Pruefe ($sicherungen.Count -ge 1 -and (Test-Path (Join-Path $sicherungen[0].FullName 'fotobox.db'))) 'Sicherung enthaelt fotobox.db'
Pruefe (Test-Path "$programm\node\node.exe") 'Programm nach dem Update vollstaendig'
$regeln = @(Get-NetFirewallRule -DisplayName 'Fotobox Galerie' -ErrorAction SilentlyContinue)
Pruefe ($regeln.Count -eq 1) "nach dem Update weiter genau eine Firewall-Regel (gefunden: $($regeln.Count))"
$log = Get-Content (Join-Path $PWD 'installation-2.log') -Raw -ErrorAction SilentlyContinue
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
