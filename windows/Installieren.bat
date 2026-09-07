@echo off
REM Doppelklick-Starter fuer die Erstinstallation.
REM
REM Nimmt dem Nutzer zwei Huerden ab: Windows sperrt PowerShell-Skripte
REM standardmaessig, und die Firewall-Freigabe fuer die Handy-Galerie braucht
REM Administratorrechte. Beides wird hier von selbst erledigt.

title Fotobox installieren

REM Laufen wir schon mit Administratorrechten?
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Fotobox braucht kurz Administratorrechte.
  echo Bitte im naechsten Fenster auf "Ja" klicken.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installieren.ps1"

echo.
echo Fenster kann jetzt geschlossen werden.
pause
