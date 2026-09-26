# Installation und Updates

Die Fotobox wird mit **einer Setup-Datei** installiert und mit **derselben Art
Setup-Datei** aktualisiert: `Fotobox-Setup-1.0.0.exe`, später
`Fotobox-Setup-2.0.0.exe` und so weiter. Auf dem Box-PC braucht es dafür kein
Node.js, kein Git, kein Bauen und keine Kommandozeile.

---

## Woher die Setup-Datei kommt

Jede Version liegt als „Release“ auf GitHub:

**https://github.com/kremer8034/fotobox/releases**

Beim neuesten Release unter „Assets“ die Datei `Fotobox-Setup-<Version>.exe`
herunterladen. Die zweite Datei daneben (`….exe.sha256`) ist die Prüfsumme; die
braucht nur die Update-Funktion der Verwaltung.

Gebaut wird die Setup-Datei automatisch von GitHub (siehe
[Eine neue Version veröffentlichen](#eine-neue-version-veröffentlichen)) – auf
einem echten Windows-Rechner und mit einem Probestart des fertigen Programms,
bevor sie veröffentlicht wird.

---

## Erstinstallation

1. `Fotobox-Setup-1.0.0.exe` auf dem Box-PC doppelklicken.
2. **„Der Computer wurde durch Windows geschützt“:** auf „Weitere
   Informationen“, dann „Trotzdem ausführen“. Das kommt, weil die Datei nicht
   mit einem gekauften Zertifikat signiert ist – nicht, weil etwas faul ist.
3. **„Möchten Sie zulassen, dass …“:** „Ja“. Administratorrechte braucht das
   Setup für den Programmordner, die Firewall-Freigabe der Handy-Galerie und
   die Energieeinstellungen.
4. Im Assistenten: Weiter → (Haken „Verknüpfungen auf dem Desktop“) →
   Installieren. Das dauert etwa eine Minute.
5. Auf der letzten Seite den Haken **„Fotobox starten und die Verwaltung
   öffnen“** lassen. Fehlt digiCamControl noch, steht dort ein zweiter Haken
   zum Herunterladen.

Danach öffnet sich die Verwaltung im Browser. Als Erstes unter **Gerät** die
**Besitzer-PIN** festlegen. Die restliche Einrichtung (Kamera, Drucker,
Kalibrierung) steht in der
[Schritt-für-Schritt-Anleitung](Anleitung-Schritt-fuer-Schritt.md) ab Teil B.

### Was das Setup einrichtet

| | |
|---|---|
| Programm | `C:\Program Files\Fotobox` – mit eigenem Node.js und SumatraPDF |
| Daten | `C:\Users\Public\Fotobox-Daten` – Veranstaltungen, Fotos, Vorlagen, Einstellungen |
| Autostart | Server und Kiosk starten beim Anmelden des Benutzers, der das Setup gestartet hat |
| Firewall | eine Freigabe für Port 8787, nur im privaten Netzwerk (für die Handy-Galerie) |
| Windows | Bildschirm, Standby und Ruhezustand am Netzteil aus; keine Update-Neustarts, solange jemand angemeldet ist |
| Startmenü | „Fotobox Verwaltung“, „Kiosk starten“, „Fotobox-Server starten“, „Fotobox beenden“, Datenordner, Anleitungen |

Programm und Daten sind getrennt. Deshalb kann ein Update das Programm
komplett austauschen, ohne ein einziges Foto anzufassen.

> **Frisch installiert, noch keine PIN, und der Kiosk ist im Vollbild?**
> Solange keine Besitzer-PIN existiert, zeigt der Kiosk den Knopf
> **„Einrichtung fortsetzen“**, der direkt in die Verwaltung führt.

---

## Update auf eine neue Version

Drei Wege, alle mit demselben Ergebnis. Vorher immer: **Keine Veranstaltung
läuft gerade** – das Update beendet Kiosk und Server für etwa eine Minute.

### Weg 1: Aus der Verwaltung (mit Internet)

1. Box mit dem Internet verbinden (zu Hause per WLAN oder Kabel).
2. Verwaltung → **Gerät** → Karte **Software** → **„Nach Updates suchen“**.
3. Gibt es eine neue Version, stehen dort Nummer, Datum und was sich geändert
   hat. **„Jetzt installieren“** antippen.
4. Die Box lädt die Setup-Datei, **prüft die Prüfsumme** (eine beschädigte oder
   veränderte Datei wird verworfen) und startet sie.
5. Windows fragt einmal nach Administratorrechten → **„Ja“**.
6. Ein Fortschrittsfenster erscheint, Kiosk und Server gehen kurz aus und
   starten danach von selbst wieder. Die Verwaltung meldet
   „Fertig – die Fotobox läuft jetzt mit Version …“.

Die Box sucht **nie von selbst** nach Updates und installiert nie ohne dich.
Ein Updater, der von allein loslegt, könnte mitten in einer Feier neu starten –
und wäre ein zusätzlicher Weg ins System.

### Weg 2: Setup-Datei per USB-Stick (ohne Internet an der Box)

1. Am eigenen PC die neue `Fotobox-Setup-<Version>.exe` von der Releases-Seite
   laden und auf einen USB-Stick kopieren.
2. An der Box die Datei vom Stick doppelklicken, „Ja“ bei der Windows-Rückfrage.
3. Der Assistent erkennt die vorhandene Installation: kein Ordner zu wählen,
   nur „Installieren“. Danach startet die Fotobox wieder.

### Weg 3: Setup-Datei direkt an der Box laden

Wie Weg 2, nur ohne Stick: an der Box im Browser die Releases-Seite öffnen,
Setup laden, doppelklicken.

### Was bei jedem Update passiert

1. Kiosk und Server werden beendet – in der richtigen Reihenfolge, damit die
   Neustart-Schleifen sie nicht gleich wieder öffnen.
2. **Die Datenbank wird gesichert** nach
   `C:\Users\Public\Fotobox-Daten\sicherungen\vor-update_<Datum>` (die letzten
   fünf bleiben erhalten).
3. Die alten Programmdateien werden entfernt, die neuen kopiert.
4. Autostart und Windows-Einstellungen werden erneuert.
5. Server und Kiosk starten wieder. Beim ersten Start ergänzt die neue Version
   die Datenbank um das, was sie zusätzlich braucht – vorhandene Daten bleiben
   unverändert.

**Nie angefasst werden:** Veranstaltungen, Fotos, Layouts, Druckzähler,
Vorlagen, eigene Filter und Schriften, Gerät-Einstellungen, PINs,
Druckkalibrierung, Mailzugang.

### Zurück auf die alte Version

Falls eine neue Version Ärger macht: die Setup-Datei der **alten** Version
starten (alle Versionen bleiben auf der Releases-Seite). Sie installiert sich
über die neue. Hat die neue Version die Datenbank schon erweitert, stört das die
alte nicht.

Im Notfall lässt sich außerdem die gesicherte Datenbank zurückholen:

1. Startmenü → Fotobox → **„Fotobox beenden“**.
2. Aus `C:\Users\Public\Fotobox-Daten\sicherungen\vor-update_<Datum>` die
   Dateien `fotobox.db` (und, falls vorhanden, `fotobox.db-wal`) nach
   `C:\Users\Public\Fotobox-Daten` kopieren und ersetzen.
3. Startmenü → Fotobox → **„Fotobox-Server starten“** (oder den PC neu starten).

---

## Eine neue Version veröffentlichen

So kommt eine neue Version – etwa das, woran wir gemeinsam weiterarbeiten – als
Setup-Datei zu dir:

1. **Versionsnummer erhöhen** in `package.json` (z. B. `1.0.0` → `1.1.0` für
   Neues, `1.0.1` für reine Fehlerbehebungen, `2.0.0` für große Umbauten).
2. **Abschnitt in `docs/Aenderungen.md`** anlegen: `## 1.1.0` und darunter in
   Alltagssprache, was neu ist. Genau dieser Text erscheint beim Update in der
   Verwaltung.
3. **Veröffentlichen** – einer von zwei Wegen:
   - auf GitHub unter **Actions → „Windows-Setup“ → „Run workflow“** den Haken
     **„veroeffentlichen“** setzen und starten (geht, sobald der Stand im
     Hauptzweig `main` liegt), **oder**
   - ein Git-Tag `v1.1.0` auf den Stand setzen und hochladen.
4. Nach etwa 10 bis 15 Minuten liegt das Release mit Setup-Datei und
   Prüfsumme auf der Releases-Seite. Ab dann findet „Nach Updates suchen“ es.

Den Teil mit Versionsnummer, Änderungsliste und Veröffentlichung kann Claude
übernehmen – einfach sagen „Veröffentliche das als Version 1.1.0“.

Bei jedem Pull Request baut GitHub die Setup-Datei ebenfalls, veröffentlicht
sie aber nicht: Sie liegt dann beim Lauf unter „Artifacts“ zum Ausprobieren auf
einem Test-PC.

---

## Deinstallieren

Startmenü → Fotobox → **„Fotobox deinstallieren“** (oder Windows-Einstellungen →
Apps). Entfernt werden Programm, Autostart und Firewall-Freigabe. **Der
Datenordner `C:\Users\Public\Fotobox-Daten` bleibt stehen** – wer ihn nicht
mehr braucht, löscht ihn von Hand.

---

## Für Entwickler: Installation aus dem Quelltext

`windows\Installieren.bat` installiert weiterhin direkt aus einem ausgecheckten
Quelltext (Node.js über winget, `npm install`, Build, Tests, Autostart). Für die
Box selbst ist die Setup-Datei der bessere Weg: kein Internet an der Box nötig,
kein Bauen auf dem N100, und genau das, was vorher in GitHub geprüft wurde.
Wer vom Quelltext auf die Setup-Datei umsteigt, installiert einfach das Setup;
es beendet den alten Server und übernimmt den Autostart.
