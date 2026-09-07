@echo off
REM Startet den Browser im Kiosk-Vollbild.
REM
REM Die Flags stammen aus der Praxis des Photobooth-Projekts: keine
REM Fehlerdialoge, keine Infoleisten, keine Uebersetzungsabfrage, keine
REM Update-Pruefung, Touch aktiviert.

setlocal
set "ZIEL=http://localhost:8787"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

start "" "%CHROME%" ^
  --kiosk "%ZIEL%" ^
  --noerrdialogs ^
  --disable-infobars ^
  --disable-features=Translate ^
  --no-first-run ^
  --check-for-update-interval=31536000 ^
  --touch-events=enabled ^
  --password-store=basic ^
  --overscroll-history-navigation=0 ^
  --disable-pinch ^
  --user-data-dir="%LOCALAPPDATA%\Fotobox-Kiosk"
