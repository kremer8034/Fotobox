#!/bin/bash
# =============================================================================
# Klickglück-Diashow auf dem Raspberry Pi
#
# Macht aus einem Raspberry Pi einen Diashow-Spieler für den zweiten
# Bildschirm (Fernseher, Beamer): Beim Einschalten meldet er sich ohne Passwort
# an, verbindet sich mit dem WLAN der Fotobox und zeigt die Diashow im
# Vollbild. Ist die Fotobox (noch) nicht da, steht „Die Diashow startet gleich“
# auf dem Bildschirm - sobald die Box erreichbar ist, geht es von selbst los.
#
# Einrichten (einmal, auf dem Raspberry Pi):
#     sudo bash fotobox-diashow.sh
#
# Voraussetzung: Raspberry Pi OS mit Desktop (Bookworm oder neuer).
# =============================================================================
set -uo pipefail

NAME=fotobox-diashow
PROGRAMM=/usr/local/bin/$NAME
DATEN=/usr/local/share/$NAME
STANDARD_ADRESSE=http://192.168.254.1/diashow

boot_ordner() { if [ -d /boot/firmware ]; then echo /boot/firmware; else echo /boot; fi; }
# Die Adresse steht auf der Boot-Partition: Die ist auch am Windows-PC lesbar,
# wenn man die Speicherkarte einsteckt ("bootfs").
EINSTELLUNG="$(boot_ordner)/$NAME.txt"

adresse_lesen() {
  local a=""
  if [ -r "$EINSTELLUNG" ]; then
    # Erste Zeile, die kein Kommentar ist; Windows-Zeilenenden und Leerzeichen weg.
    a=$(tr -d '\r' < "$EINSTELLUNG" | grep -v '^[[:space:]]*#' | grep -m1 '[^[:space:]]' | tr -d '[:space:]')
  fi
  a=${a:-$STANDARD_ADRESSE}
  case "$a" in http://* | https://*) ;; *) a="http://$a" ;; esac
  echo "$a"
}

browser_finden() { command -v chromium || command -v chromium-browser || true; }

# =============================================================================
# Teil 1: Diashow zeigen (läuft bei jeder Anmeldung über den Autostart)
# =============================================================================
starten() {
  # Nur einmal laufen, auch wenn der Autostart doppelt auslöst.
  exec 9> "${XDG_RUNTIME_DIR:-/tmp}/$NAME.lock"
  flock -n 9 || exit 0

  local adresse browser profil warteseite pid="" zustand="" fehlversuche=0
  adresse=$(adresse_lesen)
  browser=$(browser_finden)
  profil="$HOME/.cache/$NAME"
  warteseite="file://$DATEN/warten.html#$adresse"
  [ -n "$browser" ] || { echo "Chromium fehlt." >&2; exit 1; }

  # Bildschirmschoner aus, falls der Desktop noch X11 nutzt.
  if [ -n "${DISPLAY:-}" ] && command -v xset > /dev/null; then
    xset s off -dpms s noblank 2> /dev/null || true
  fi

  zeige() {
    if [ -n "$pid" ]; then kill "$pid" 2> /dev/null; wait "$pid" 2> /dev/null; fi
    # Jedes Mal ein frisches Profil: keine "Seiten wiederherstellen?"-Frage
    # nach einem Stromausfall, kein Verlauf, keine Anmeldungen.
    rm -rf "$profil"
    "$browser" --kiosk --noerrdialogs --disable-infobars --no-first-run \
      --disable-session-crashed-bubble --disable-features=Translate,TranslateUI \
      --check-for-update-interval=31536000 --password-store=basic \
      --ozone-platform-hint=auto --autoplay-policy=no-user-gesture-required \
      --user-data-dir="$profil" "$1" > /dev/null 2>&1 &
    pid=$!
  }

  erreichbar() {
    # Jede HTTP-Antwort zählt (auch eine Weiterleitung) - nur "000" heißt: keine Verbindung.
    local code
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$adresse" 2> /dev/null)
    [ -n "$code" ] && [ "$code" != "000" ]
  }

  while true; do
    if erreichbar; then
      fehlversuche=0
      ziel=diashow
    else
      fehlversuche=$((fehlversuche + 1))
      # Kurze Funklöcher nicht gleich mit der Warteseite beantworten:
      # Die Diashow bleibt stehen, bis die Box eine halbe Minute weg ist.
      if [ "$zustand" = diashow ] && [ "$fehlversuche" -lt 3 ]; then ziel=diashow; else ziel=warten; fi
    fi
    # Wechseln, wenn sich etwas geändert hat oder der Browser beendet wurde.
    if [ "$ziel" != "$zustand" ] || ! kill -0 "$pid" 2> /dev/null; then
      if [ "$ziel" = diashow ]; then zeige "$adresse"; else zeige "$warteseite"; fi
      zustand=$ziel
    fi
    sleep 10
  done
}

# =============================================================================
# Teil 2: Einrichten (einmal mit sudo)
# =============================================================================
frage() { # frage "Text" "Vorgabe" -> Antwort
  local antwort
  read -r -p "$1 " antwort < /dev/tty
  echo "${antwort:-$2}"
}

einrichten() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Bitte so starten:  sudo bash $0"
    exit 1
  fi
  local benutzer=${SUDO_USER:-}
  [ -n "$benutzer" ] && [ "$benutzer" != root ] || benutzer=$(id -nu 1000 2> /dev/null || true)
  [ -n "$benutzer" ] || { echo "Kein normaler Benutzer gefunden."; exit 1; }
  local heim
  heim=$(getent passwd "$benutzer" | cut -d: -f6)

  echo
  echo "=== Klickglück-Diashow einrichten ==="
  echo

  # --- Chromium (ist bei "Raspberry Pi OS mit Desktop" schon dabei)
  if [ -z "$(browser_finden)" ]; then
    echo "Chromium fehlt - wird installiert (dafür braucht der Pi Internet) ..."
    apt-get update && { apt-get install -y chromium || apt-get install -y chromium-browser; } || {
      echo "Installation fehlgeschlagen. Bitte den Pi kurz mit dem Internet verbinden und neu starten."
      exit 1
    }
  fi

  # --- WLAN der Fotobox
  local wlan passwort
  echo "1) WLAN der Fotobox"
  echo "   Den Namen findest du in der Verwaltung der Fotobox unter Gerät → WLAN."
  wlan=$(frage "   WLAN-Name (Enter = nicht ändern):" "")
  if [ -n "$wlan" ]; then
    passwort=$(frage "   Passwort (Enter = offenes WLAN, z. B. mit Captive Portal):" "")
    raspi-config nonint do_wifi_country DE > /dev/null 2>&1 || true
    nmcli radio wifi on > /dev/null 2>&1 || true
    nmcli connection delete Fotobox > /dev/null 2>&1 || true
    if [ -n "$passwort" ]; then
      nmcli connection add type wifi ifname wlan0 con-name Fotobox ssid "$wlan" \
        wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$passwort" \
        connection.autoconnect yes connection.autoconnect-priority 100 > /dev/null
    else
      nmcli connection add type wifi ifname wlan0 con-name Fotobox ssid "$wlan" \
        connection.autoconnect yes connection.autoconnect-priority 100 > /dev/null
    fi && echo "   ✓ WLAN „$wlan“ gespeichert - der Pi verbindet sich ab jetzt von selbst."
  fi
  # WLAN-Stromsparen aus: Sonst reißt die Verbindung gern nach ein paar Minuten ab.
  mkdir -p /etc/NetworkManager/conf.d
  printf '[connection]\nwifi.powersave = 2\n' > /etc/NetworkManager/conf.d/$NAME-wlan.conf

  # --- Adresse der Diashow
  echo
  echo "2) Adresse der Diashow"
  echo "   Steht in der Verwaltung der Fotobox bei der Veranstaltung unter „Diashow“."
  echo "   Mit Captive Portal ist es immer: $STANDARD_ADRESSE"
  local adresse
  adresse=$(frage "   Adresse (Enter = $(adresse_lesen)):" "$(adresse_lesen)")
  cat > "$EINSTELLUNG" << EOF
# Adresse der Klickglück-Diashow - die erste Zeile ohne # zählt.
# Lässt sich auch am Windows-PC ändern: Speicherkarte einstecken, im
# Laufwerk "bootfs" diese Datei öffnen, Adresse ändern, speichern.
$adresse
EOF
  echo "   ✓ gespeichert in $EINSTELLUNG"

  # --- Programm, Warteseite, Autostart
  [ "$(readlink -f "$0")" = "$PROGRAMM" ] || install -m 755 "$0" "$PROGRAMM"
  mkdir -p "$DATEN"
  warteseite_schreiben > "$DATEN/warten.html"
  local autostart="$heim/.config/autostart"
  mkdir -p "$autostart"
  cat > "$autostart/$NAME.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Klickglück-Diashow
Exec=$PROGRAMM start
X-GNOME-Autostart-enabled=true
EOF
  # Gibt es schon einen eigenen Autostart für den Desktop (labwc), ersetzt der
  # den des Systems - dann gehört die Diashow auch dort hinein. Doppelt schadet
  # nicht, das Programm läuft trotzdem nur einmal. Neu angelegt wird er nicht.
  local labwc="$heim/.config/labwc/autostart"
  if [ -f "$labwc" ] && ! grep -q "$PROGRAMM" "$labwc"; then echo "$PROGRAMM start &" >> "$labwc"; fi
  chown -R "$benutzer:" "$heim/.config"

  # --- Ohne Passwort zum Desktop, Bildschirm nie abschalten
  raspi-config nonint do_boot_behaviour B4 > /dev/null 2>&1 || echo "   Hinweis: Automatische Anmeldung bitte in raspi-config einschalten."
  raspi-config nonint do_blanking 1 > /dev/null 2>&1 || true

  echo
  echo "=== Fertig! ==="
  echo "Nach dem Neustart zeigt der Pi die Diashow - oder „Die Diashow startet gleich“,"
  echo "bis die Fotobox erreichbar ist."
  echo "Diashow beenden (mit Tastatur): Alt+F4. Neu starten: Pi aus- und einschalten."
  echo
  if [ "$(frage "Jetzt neu starten? [J/n]" j)" != n ]; then reboot; fi
}

warteseite_schreiben() {
  cat << 'HTML'
<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Klickglück-Diashow</title>
<style>
  html, body { margin: 0; height: 100%; cursor: none; overflow: hidden; }
  body {
    display: grid; place-items: center; text-align: center; color: #f5f2fb;
    font-family: system-ui, "Segoe UI", Roboto, sans-serif;
    background:
      radial-gradient(circle at 18% 22%, rgba(255, 212, 71, 0.18), transparent 32%),
      radial-gradient(circle at 82% 78%, rgba(255, 111, 91, 0.16), transparent 34%),
      radial-gradient(circle at 75% 20%, rgba(119, 110, 166, 0.25), transparent 30%),
      #15122b;
  }
  .zeichen { width: 11vw; min-width: 90px; }
  h1 { margin: 3vh 0 1vh; font-size: clamp(32px, 5.2vw, 90px); letter-spacing: -0.02em; }
  h1 span { color: #ffd447; }
  p { margin: 0; font-size: clamp(16px, 1.7vw, 30px); color: #bbb3d8; }
  .punkte span { display: inline-block; width: 1.4vw; height: 1.4vw; min-width: 12px; min-height: 12px; margin: 4vh 0.6vw 0; border-radius: 50%; background: #ffd447; animation: hupf 1.2s infinite ease-in-out; }
  .punkte span:nth-child(2) { background: #ff6f5b; animation-delay: 0.15s; }
  .punkte span:nth-child(3) { background: #b9a8ff; animation-delay: 0.3s; }
  @keyframes hupf { 0%, 80%, 100% { transform: translateY(0); opacity: 0.5; } 40% { transform: translateY(-1.6vh); opacity: 1; } }
  .hilfe { position: fixed; left: 0; right: 0; bottom: 4vh; font-size: clamp(13px, 1.1vw, 20px); color: #8a83a3; line-height: 1.6; }
</style>
</head>
<body>
<main>
  <svg class="zeichen" viewBox="0 0 40 40" aria-hidden="true">
    <rect x="2" y="7" width="36" height="29" rx="8" fill="#ffd447"/>
    <rect x="9" y="3" width="11" height="7" rx="2.5" fill="#ffd447"/>
    <circle cx="20" cy="22" r="9.5" fill="#15122b"/>
    <circle cx="20" cy="22" r="5.2" fill="none" stroke="#ffd447" stroke-width="2"/>
    <path d="M20 19.2c-1.6-1.9-4.6-.6-4.2 1.7.3 1.8 2.6 3.3 4.2 4.4 1.6-1.1 3.9-2.6 4.2-4.4.4-2.3-2.6-3.6-4.2-1.7z" fill="#ff6f5b"/>
    <circle cx="32" cy="13" r="2" fill="#15122b"/>
  </svg>
  <h1>Die Diashow <span>startet gleich</span></h1>
  <p>Sobald die Fotobox erreichbar ist, geht es von selbst los.</p>
  <div class="punkte"><span></span><span></span><span></span></div>
</main>
<div class="hilfe">
  Warte auf die Fotobox unter <b id="adresse"></b><br>
  Läuft die Fotobox? Ist bei der Veranstaltung die Diashow „Auf einem zweiten Bildschirm“ an?
</div>
<script>
  try { document.getElementById('adresse').textContent = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
</script>
</body>
</html>
HTML
}

case "${1:-einrichten}" in
  start) starten ;;
  # Nur zum Ausprobieren ohne Raspberry Pi: zeigt die gelesene Adresse.
  adresse) adresse_lesen ;;
  einrichten) einrichten ;;
  *) echo "Aufruf: sudo bash $0   (einrichten)   oder   $0 start"; exit 1 ;;
esac
