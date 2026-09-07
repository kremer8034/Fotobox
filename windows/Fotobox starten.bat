@echo off
REM Startet den Fotobox-Server. Laeuft bewusst ohne Administratorrechte.
REM
REM Der Server bindet standardmaessig nur auf 127.0.0.1. Die LAN-Adresse kommt
REM ausschliesslich dann dazu, wenn in einer Veranstaltung die Galerie aktiv ist.

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

echo Fotobox startet. Daten liegen unter %FOTOBOX_DATEN%
"%NODE%" dist\server\index.js
