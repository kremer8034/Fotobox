@echo off
REM Oeffnet die Verwaltung im Standardbrowser.
REM Nur auf diesem Rechner erreichbar - vom Netz aus ist die Adresse tot.
REM
REM Laeuft der Server nicht, wird er mitgestartet - sonst zeigte der Browser
REM nur "Die Website ist nicht erreichbar".

setlocal
set "ZIEL=http://127.0.0.1:8787"

where curl.exe >nul 2>&1
if errorlevel 1 goto oeffnen

curl.exe -s -o nul --max-time 2 "%ZIEL%/api/kiosk/start"
if not errorlevel 1 goto oeffnen

echo Der Fotobox-Server laeuft nicht - er wird gestartet.
start "Fotobox Server" /min "%~dp0Fotobox starten.bat"
set /a VERSUCHE=0
:warten
set /a VERSUCHE+=1
if %VERSUCHE% gtr 30 goto oeffnen
timeout /t 1 /nobreak >nul
curl.exe -s -o nul --max-time 2 "%ZIEL%/api/kiosk/start"
if errorlevel 1 goto warten

:oeffnen
start "" "%ZIEL%/admin"
endlocal
