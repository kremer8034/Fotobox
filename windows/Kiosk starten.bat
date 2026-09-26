@echo off
REM Startet den Browser im Kiosk-Vollbild.
REM
REM Die Flags stammen aus der Praxis des Photobooth-Projekts: keine
REM Fehlerdialoge, keine Infoleisten, keine Uebersetzungsabfrage, keine
REM Update-Pruefung, Touch aktiviert.
REM
REM Zwei Dinge macht diese Datei, damit die Box ohne Betreuer durchhaelt:
REM  1. Sie wartet, bis der Server antwortet. Sonst oeffnet der Browser beim
REM     Hochfahren eine Fehlerseite ("Die Website ist nicht erreichbar") und
REM     bleibt dort stehen - der Server war nur noch nicht so weit.
REM  2. Schliesst sich der Browser, oeffnet sie ihn wieder. Nur wenn der
REM     Besitzer im Servicemenue "Kiosk schliessen" waehlt, bleibt er zu.

setlocal
set "ZIEL=http://localhost:8787"
if not defined FOTOBOX_DATEN set "FOTOBOX_DATEN=%PUBLIC%\Fotobox-Daten"
set "AUS=%FOTOBOX_DATEN%\kiosk-aus.txt"

REM Wer diese Datei von Hand startet, will den Kiosk - eine alte Markierung
REM "bleibt zu" gilt dann nicht mehr.
if exist "%AUS%" del "%AUS%"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

:warten
REM curl gehoert seit Windows 10 (1803) zum System. Fehlt es doch, einfach
REM 15 Sekunden Vorsprung fuer den Server geben.
where curl.exe >nul 2>&1
if errorlevel 1 (
  timeout /t 15 /nobreak >nul
  goto oeffnen
)
curl.exe -s -o nul --max-time 2 "%ZIEL%/api/kiosk/start"
if errorlevel 1 (
  echo Warte auf den Fotobox-Server ...
  timeout /t 2 /nobreak >nul
  goto warten
)

:oeffnen
REM /wait: Die Datei wartet, bis der Browser geschlossen ist. Das eigene
REM Profil (user-data-dir) sorgt dafuer, dass es eine eigene Browser-Instanz
REM ist und nicht in einem offenen Chrome-Fenster aufgeht.
start "" /wait "%CHROME%" ^
  --kiosk "%ZIEL%" ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-features=Translate ^
  --no-first-run ^
  --check-for-update-interval=31536000 ^
  --touch-events=enabled ^
  --password-store=basic ^
  --overscroll-history-navigation=0 ^
  --disable-pinch ^
  --user-data-dir="%LOCALAPPDATA%\Fotobox-Kiosk"

if exist "%AUS%" goto ende
echo Browser wurde geschlossen - wird neu geoeffnet.
timeout /t 3 /nobreak >nul
goto warten

:ende
del "%AUS%" >nul 2>&1
endlocal
