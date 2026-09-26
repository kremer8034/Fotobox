@echo off
REM Startet den Fotobox-Server. Laeuft bewusst ohne Administratorrechte.
REM
REM Der Server bindet standardmaessig nur auf 127.0.0.1. Die LAN-Adresse kommt
REM ausschliesslich dann dazu, wenn in einer Veranstaltung die Galerie aktiv ist.
REM
REM Stuerzt der Server ab, startet diese Datei ihn nach 5 Sekunden neu. Die Box
REM steht meist allein beim Kunden - ohne diese Schleife waere nach einem
REM einzigen Absturz bis zum naechsten PC-Neustart Schluss. Jeder Schritt steht
REM bereits in der Datenbank, der Neustart verliert also nichts ausser einer
REM gerade laufenden Aufnahme.

setlocal
cd /d "%~dp0.."

REM Ablageort der Daten. Hier landen Datenbank, Vorlagen und alle Event-Ordner.
if not defined FOTOBOX_DATEN set "FOTOBOX_DATEN=%PUBLIC%\Fotobox-Daten"

REM Echte Hardware: digiCamControl und Windows-Silent-Print.
set "FOTOBOX_HARDWARE=echt"
set "FOTOBOX_WEB=dist\web"

REM Portables Node aus dem Unterordner "node", sonst das im System.
if exist "node\node.exe" (
  set "NODE=node\node.exe"
) else (
  set "NODE=node"
)

if not exist "%FOTOBOX_DATEN%" mkdir "%FOTOBOX_DATEN%"
set "NEUSTARTS=%FOTOBOX_DATEN%\neustarts.txt"

:schleife
REM Laeuft schon ein Server (Autostart, oder "Fotobox starten" wurde doppelt
REM angeklickt), nicht einen zweiten daneben starten - der faende seinen Port
REM besetzt und laege dann alle fuenf Sekunden in einer Neustart-Schleife.
where curl.exe >nul 2>&1
if not errorlevel 1 (
  curl.exe -s -o nul --max-time 2 "http://127.0.0.1:8787/api/kiosk/start"
  if not errorlevel 1 (
    echo Die Fotobox laeuft bereits.
    goto ende
  )
)
echo Fotobox startet. Daten liegen unter %FOTOBOX_DATEN%
"%NODE%" dist\server\index.js
set "CODE=%ERRORLEVEL%"

REM Code 0 heisst: bewusst beendet (Strg+C oder Herunterfahren). Dann Schluss.
if "%CODE%"=="0" goto ende

echo %DATE% %TIME%  Server beendet mit Code %CODE%, Neustart >> "%NEUSTARTS%"
echo.
echo Der Server wurde unerwartet beendet (Code %CODE%). Neustart in 5 Sekunden ...
timeout /t 5 /nobreak >nul
goto schleife

:ende
endlocal
