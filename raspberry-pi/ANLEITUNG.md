# Diashow auf dem Raspberry Pi

Ein Raspberry Pi am Fernseher oder Beamer zeigt die Diashow der Fotobox – ohne
Kabel zur Box, über ihr WLAN. Einmal eingerichtet, genügt es, den Pi
einzuschalten: Er meldet sich selbst an, verbindet sich mit dem WLAN der
Fotobox und zeigt die Diashow im Vollbild. Ist die Box noch nicht da, steht
„Die Diashow startet gleich“ auf dem Bildschirm, bis sie erreichbar ist.

## Was du brauchst

- Raspberry Pi 4 oder 5 (ein Pi 3 geht, ist für Vollbild-Fotos aber langsam)
- microSD-Karte ab 16 GB, Netzteil, HDMI-Kabel (Pi 4 und 5: Micro-HDMI)
- für die Einrichtung einmal: Tastatur und Maus am Pi, Windows-PC mit Kartenleser
- die Datei **`fotobox-diashow.sh`** aus diesem Ordner

## Einrichten in drei Schritten

### 1. Speicherkarte beschreiben (am PC)

1. Den **Raspberry Pi Imager** installieren: <https://www.raspberrypi.com/software/>
2. Gerät wählen, als Betriebssystem **„Raspberry Pi OS (64-bit)“** (das mit
   Desktop, ganz oben), dann die Speicherkarte.
3. Bei den Einstellungen (je nach Imager-Version eigene Schritte oder
   „Einstellungen bearbeiten“):
   - Benutzername und Passwort festlegen (z. B. `fotobox`)
   - WLAN-Land: **DE**, Zeitzone: **Europe/Berlin**, Tastatur: **de**
   - WLAN kann leer bleiben – das fragt das Skript in Schritt 3.
4. Schreiben lassen.

### 2. Skript auf die Karte legen (am PC)

Nach dem Schreiben erscheint am PC ein Laufwerk **„bootfs“**. Die Datei
`fotobox-diashow.sh` dorthin kopieren. Karte auswerfen und in den Pi stecken.

### 3. Einmal ausführen (am Pi)

1. Pi an Fernseher, Tastatur und Maus anschließen, einschalten, warten bis der
   Desktop erscheint.
2. Terminal öffnen: **Strg + Alt + T** (oder Himbeer-Menü → Zubehör → Terminal).
3. Eintippen und Enter:

   ```
   sudo bash /boot/firmware/fotobox-diashow.sh
   ```

4. Zwei Fragen beantworten:
   - **WLAN-Name der Fotobox** – steht in der Verwaltung der Fotobox unter
     *Gerät → WLAN*. Danach das Passwort; bei offenem WLAN (Captive Portal)
     einfach Enter.
   - **Adresse der Diashow** – mit Captive Portal einfach Enter
     (`http://192.168.254.1/diashow`).
5. „Jetzt neu starten?“ mit Enter bestätigen. Tastatur und Maus abziehen.

Fertig. Ab jetzt startet die Diashow bei jedem Einschalten von selbst.

## Auf der Fotobox

Bei der Veranstaltung muss die Diashow **„Auf einem zweiten Bildschirm“**
eingeschaltet sein und die **Galerie im WLAN** laufen. Mit Captive Portal
bleibt die Adresse immer `192.168.254.1/diashow` – der Pi muss für neue
Veranstaltungen nicht angefasst werden.

Ohne Captive Portal ändert sich die Adresse mit jeder Veranstaltung (sie steht
in der Verwaltung bei „Diashow“). Dann vor der Feier die Adresse neu eintragen,
siehe unten.

## Später etwas ändern

- **Adresse:** Speicherkarte in den PC stecken, im Laufwerk „bootfs“ die Datei
  `fotobox-diashow.txt` mit dem Editor öffnen, Adresse ändern, speichern.
- **WLAN oder Adresse am Pi:** Terminal öffnen, `sudo fotobox-diashow einrichten`.
- **Diashow beenden:** mit Tastatur **Alt + F4**; sonst einfach ausschalten.

## Gut zu wissen

- **Keine Maus anschließen,** solange die Diashow läuft – sonst steht der
  Mauszeiger im Bild.
- Bricht das WLAN kurz ab, läuft die Diashow weiter. Ist die Box länger als
  eine halbe Minute weg, kommt die Warteseite; danach geht es von selbst weiter.
- Der Bildschirm schaltet sich nicht ab, und nach einem Stromausfall fragt der
  Browser nichts nach – einfach wieder einschalten.

## Wenn es nicht klappt

| Was du siehst | Was hilft |
| --- | --- |
| Dauerhaft „Die Diashow startet gleich“ | Läuft die Box? Ist die Diashow „Auf einem zweiten Bildschirm“ an? Stimmt die Adresse unten auf der Seite? Ist der Pi im WLAN der Box (Symbol oben rechts im Desktop – dafür kurz Alt + F4)? |
| Der Desktop erscheint, aber keine Diashow | Terminal öffnen, `fotobox-diashow start` eintippen – eine Fehlermeldung zeigt, was fehlt. |
| Anmeldebildschirm statt Desktop | Terminal öffnen, `sudo raspi-config` → *System Options* → *Boot / Auto Login* → *Desktop Autologin*. |
