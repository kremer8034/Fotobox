# Fotobox

Fotobox-Software für einen Windows-PC mit Touchscreen, einer **Canon EOS 600D**
und dem Fotodrucker **DNP DS-RX1HS**. Gäste tippen auf „Foto starten“, lächeln
in die Kamera, wählen einen Filter und halten Sekunden später ihren Ausdruck in
der Hand. Jede Veranstaltung landet sauber in einem eigenen Ordner.

**Die Box braucht kein Internet.** Galerie fürs Handy und Foto per E-Mail sind
je Veranstaltung zuschaltbar und standardmäßig aus.

**Aktuelle Version: 1.0.9.** Die Setup-Datei liegt auf der
[Releases-Seite](https://github.com/kremer8034/Fotobox/releases/latest). Was sich
in jeder Version geändert hat, steht in [docs/Aenderungen.md](docs/Aenderungen.md).

---

## Inhalt

- [Für Gäste: so läuft ein Foto](#für-gäste-so-läuft-ein-foto)
- [Für Betreiber: was die Software kann](#für-betreiber-was-die-software-kann)
- [Hardware](#hardware)
- [Installation und Updates](#installation-und-updates)
- [Einrichten der Box](#einrichten-der-box)
- [Vor jeder Veranstaltung](#vor-jeder-veranstaltung)
- [Galerie aufs Handy, mit einem Scan](#galerie-aufs-handy-mit-einem-scan)
- [Wo die Daten liegen](#wo-die-daten-liegen)
- [Datenschutz und Sicherheit](#datenschutz-und-sicherheit)
- [Entwicklung](#entwicklung)
- [Aufbau des Quelltexts](#aufbau-des-quelltexts)
- [Dokumentation](#dokumentation)

---

## Für Gäste: so läuft ein Foto

1. **Foto starten** und eine Vorlage wählen, etwa ein Foto oder vier.
2. **Countdown über dem Live-Bild.** Ein Pfeil zeigt zur Kamera, „Bitte
   lächeln!“ füllt den ganzen Bildschirm, bis das Foto da ist.
3. **Filter wählen.** Jede Kachel zeigt das eigene Foto in der Vorschau.
   „Abbrechen“ verwirft die Aufnahme vollständig.
4. **Ergebnis:**
   - **Drucken**
   - **Per E-Mail** schicken
   - **Löschen**: Das Foto ist dann endgültig weg, für niemanden mehr abrufbar.
5. **Galerie** am Touchscreen: alle Fotos der Feier ansehen, nachdrucken oder
   per E-Mail verschicken.

Die Bedienung ist auf den Finger ausgelegt. Knöpfe sind in Millimetern
bemessen, Hinweise bei Störungen stehen in Alltagssprache („Der Drucker braucht
Papier“), nicht als Fehlercode.

## Für Betreiber: was die Software kann

**Veranstaltungen**
- Eigener Ordner je Feier, Lebenszyklus von *Entwurf* über *startbereit*,
  *aktiv* und *pausiert* bis *abgeschlossen* und *archiviert*.
- **Startbereit-Check** vor dem Start: Kamera, Drucker, Papier, Speicherplatz,
  Vorlagen, E-Mail, Galerie im Netz, PINs, Probelauf.
- **Probelauf**: Testfotos zählen weder in den Auslagenersatz noch in die
  Galerie. Der Besitzer schaltet ihn direkt im Servicemenü ein und aus.
- **Duplizieren** und **Voreinstellungen**: Die nächste Feier entsteht aus der
  letzten in einer Minute.
- **Auslagenersatz** als Übersicht und CSV.
- **Unterlagen** auf Knopfdruck: Kurzanleitung mit Betreuer-PIN für die Box und
  QR-Aushang für die Gäste (je A4).
- **Übergabe** an den Gastgeber: ganzer Ordner auf einen USB-Stick, mit
  Prüfmarker und einer `galerie.html` zum Doppelklicken, ohne Server und ohne
  Internet.

**Vorlagen und Filter**
- **Vorlagen-Editor** mit freiem Ebenenstapel aus Bild-, Foto- und
  Textebenen. Ein Rahmen kann über dem Foto und unter dem Logo liegen.
- **Text** mit eigener Schrift (TTF/OTF), **fett** und *kursiv* und den
  Platzhaltern `{veranstaltung}`, `{datum}`, `{uhrzeit}`, `{nummer}`.
  Dieselbe Vorlage passt damit auf jede Feier.
- **Filter**: über 20 eingebaute, von Schwarzweiß bis Pop-Art, dazu eigene
  `.cube`-LUTs. Filter wirken nur auf die Fotos, nie auf Rahmen und Text.

**Drucken**
- Direkt über Windows, ohne Zusatzprogramm: Papier 6 × 4 Zoll (10 × 15 cm),
  randlos, ohne Druckdialog.
- **Druckkalibrierung** mit Millimeter-Testbild gegen den Beschnitt des
  randlosen Drucks. Einmal eingestellt, gilt sie für alle Vorlagen.
- **Druckwarteschlange**, die nichts verliert: Fällt der Drucker aus, wartet
  der Auftrag. Nach „Papier gewechselt“ druckt die Box von selbst weiter.
- **Papiervorrat** direkt aus dem DNP-Drucker, sichtbar im Servicemenü.

**Kiosk und Servicemenü**
- **Kiosk-Sperre**: versteckter Kreis oben rechts, eine Sekunde halten, PIN.
- **Zwei PIN-Ebenen:**
  - Betreuer (Gastgeber): Pause, Papier gewechselt, neue Rolle, Galerie
  - Besitzer: zusätzlich Verwaltung öffnen, Probelauf, Veranstaltung
    abschließen, Kiosk schließen, PC herunterfahren
- **Galerie pflegen**: Ein Foto lässt sich sofort aus der Galerie nehmen und
  wieder zeigen.

**Verwaltung** (nur am Fotobox-PC selbst erreichbar)
- *Übersicht* · *Veranstaltungen* · *Vorlagen* · *Filter* · *WLAN & Portal*
  · *Gerät*
- **Updates** auf Knopfdruck unter *Gerät → Software*. Es wird nie automatisch
  aktualisiert, schon gar nicht mitten in einer Feier.

## Hardware

| Teil | Modell | Hinweis |
|---|---|---|
| PC | Windows 11, z. B. Intel N100 | Anzeigeskalierung **100 %** |
| Bildschirm | 14″-Touchscreen, 1920 × 1080 | |
| Kamera | Canon EOS 600D über **digiCamControl** | Netzteil mit Dummy-Akku, M-Modus |
| Drucker | DNP DS-RX1HS | Treiber mit ICC-Farbprofil |
| WLAN (optional) | Vonets VAP11N-300 oder Reise-Router | nur für Handy-Galerie und E-Mail |

Einen Webcam-Notbetrieb gibt es bewusst nicht: Die Box läuft mit der 600D oder
gar nicht.

## Installation und Updates

**Erstinstallation:**
1. `Fotobox-Setup-<Version>.exe` von der
   [Releases-Seite](https://github.com/kremer8034/Fotobox/releases/latest) laden.
2. Doppelklicken und „Installieren“ wählen.

Die Setup-Datei bringt alles mit (eigenes Node.js, fertiges Programm) und
richtet Autostart, Firewall-Freigabe und Energieeinstellungen ein. An der Box
braucht es dafür weder Internet noch Kommandozeile. Auf dem Desktop landen
**„Fotobox starten“** und **„Fotobox Verwaltung“**.

**Update:**
- In der Verwaltung unter *Gerät → Software* „Nach Updates suchen“,
- oder die neue Setup-Datei per USB-Stick starten.

Fotos, Veranstaltungen und Einstellungen bleiben erhalten. Die Datenbank wird
vor jedem Update gesichert.

**Deinstallation** entfernt das Programm, die Daten bleiben liegen.

## Einrichten der Box

Einmalig, Schritt für Schritt in
[docs/Anleitung-Schritt-fuer-Schritt.md](docs/Anleitung-Schritt-fuer-Schritt.md):

1. **Anzeigeskalierung auf 100 %.** Sonst stimmen die Millimeter-Maße der
   Oberfläche nicht.
2. **DNP-Treiber:** randlos, 10 × 15, **ICC-Farbprofil** setzen. Ohne Profil
   treffen Thermosublimationsdrucker Hauttöne und Rot spürbar daneben.
3. **digiCamControl** installieren, dessen Webserver (Port 5513) einschalten,
   einmal starten.
4. **Drucker wählen** unter *Gerät → Drucker*. Der DNP steht mit ★ oben.
5. **Besitzer-PIN vergeben.** Eine Standard-PIN gibt es bewusst nicht.
6. **Kamera:** feste Werte für ISO, Blende und Zeit, LED-Dauerlicht.
7. **Druckkalibrierung:** Testbild drucken, an den Skalen ablesen, eintragen.

## Vor jeder Veranstaltung

1. **Veranstaltung anlegen**: leer, aus einer Voreinstellung oder als Duplikat.
   Vorlagen und Filter freigeben.
2. **Betreuer-PIN** setzen. Die bekommt der Gastgeber.
3. **Unterlagen** erzeugen: Kurzanleitung in die Box, QR-Aushang außen dran.
4. **Startbereit-Check**, dann auf *aktiv* schalten.
5. Optional **Probelauf** für den Aufbau-Test.

## Galerie aufs Handy, mit einem Scan

Ist die Galerie für eine Veranstaltung an, öffnen Gäste sie im WLAN der Box per
QR-Code. Die Seite ist schreibgeschützt; zum Speichern hält man das Foto
gedrückt und wählt „Sichern“ oder „Teilen“.

**Captive Portal (Test, ab 1.0.8):** Normalerweise sind es zwei Scans, erst
das WLAN, dann die Galerie. Mit dem Portal geht es ohne Code: Das WLAN der
Fotobox ist offen, die Gäste tippen es in ihren WLAN-Einstellungen an, und die
Galerie öffnet sich von selbst, wie die Anmeldeseite im Hotel. Das Handy bleibt
dabei über seine mobilen Daten online.

- Eigener Menüpunkt **„WLAN & Portal“** mit Schalter An/Aus. **Standardmäßig
  aus**; dann läuft die Box genau wie bisher.
- Startbildschirm, Galerie am Touchscreen und Aushang zeigen statt eines
  QR-Codes eine kurze Anleitung mit dem Namen des WLANs.
- Die **Selbstdiagnose** prüft Kabel, Adresse, Vonets, einen zweiten
  Adressverteiler, Firewall und freie Anschlüsse und nennt jeweils den nächsten
  Handgriff.
- „Netzwerk für das Portal einrichten“ stellt den Netzwerkanschluss mit einer
  Windows-Rückfrage um. „Zurücksetzen (wie vorher)“ macht es rückgängig.
- Am Vonets: DHCP-Server aus, WLAN ohne Passwort. Adressen und
  Namensauflösung übernimmt dann die Box selbst.
- Offenes WLAN heißt: Wer in Funkreichweite ist, kann die Galerie öffnen. Ins
  Internet kommt darüber niemand.

## Wo die Daten liegen

Alle Daten liegen getrennt vom Programm unter `C:\Users\Public\Fotobox-Daten`.
Ein Update tauscht das Programm aus, ohne ein Foto anzufassen.

```
Fotobox-Daten/
  fotobox.db                    Datenbank
  sicherungen/                  Datenbank-Sicherung vor jedem Update (die letzten fünf)
  vorlagen/                     Vorlagen und ihre Bilddateien
  schriften/                    eigene Schriften (TTF/OTF)
  luts/                         eigene .cube-Filter
  events/
    2026-05-16_Hochzeit-Mueller/
      event.json                Konfiguration, macht den Ordner portabel
      01_originale/             unveränderte Kameradateien
      02_bearbeitet/            Fotos mit Filter
      03_layouts/               fertige Layouts, der Inhalt der Galerie
      04_druck/                 Druckdateien 152,4 × 101,6 mm
      _probelauf/               Testfotos (gehen nicht in die Übergabe)
      .cache/                   Vorschaubilder, Testdrucke, Unterlagen
      auslagen.csv
      galerie.html              Offline-Galerie für den Gastgeber
```

## Datenschutz und Sicherheit

Der realistische Angreifer ist der neugierige Gast mit Smartphone im selben
WLAN. Darauf ist das Konzept zugeschnitten.

- **Kiosk und Verwaltung sind aus dem Netz nicht erreichbar.** Der Server
  bindet nur an `127.0.0.1`. Ist die Galerie an, kommt im WLAN eine zweite
  Instanz dazu, die ausschließlich Galerie und Statusseite kennt.
- **Galerie-Zugang über ein Zufallstoken** (128 Bit), jederzeit erneuerbar. Es
  gilt nur, solange seine Veranstaltung läuft. Der Link der letzten Hochzeit
  zeigt auf dem nächsten Geburtstag nichts.
- **Kein Dateipfad kommt aus der URL.** Bilder werden über IDs angefordert und
  gegen den Ordner der Veranstaltung geprüft.
- **Löschen ist endgültig.** Löscht ein Gast sein Foto, werden Dateien und
  Datenbankeinträge entfernt, auch für Betreiber und Übergabe.
- **Probelauf- und herausgenommene Fotos** sind über die Galerie nicht
  abrufbar.
- **Strenge Kopfzeilen** im WLAN (Content-Security-Policy, kein Einbetten,
  kein Referrer, kein Caching) und begrenzte Last, damit viele Handys den
  Kiosk nicht ausbremsen.
- **Schutz der Verwaltung gegen fremde Webseiten** (DNS-Rebinding,
  untergeschobene Formulare), falls auf dem PC auch gesurft wird.
- **PINs nur als scrypt-Hash**, Sperre nach Fehlversuchen.
- **EXIF-Daten werden entfernt** aus allem, was die Box verlässt.
- **E-Mail:**
  - immer verschlüsselt, das Mailpasswort verlässt den Server nie
  - höchstens drei Mails je Adresse und Tag
  - Adressen werden nach der Frist aus dem Einwilligungstext automatisch
    gelöscht
- **Captive Portal:** Port 80 kennt nur die Weiterleitung zur Galerie. Die
  Netzdienste laufen nur am eigens eingerichteten Anschluss und nur, wenn der
  Schalter an ist.

Ehrlich zur Grenze: Ein Browser-Kiosk ist nur so sicher wie Windows darunter.
Er schützt gegen neugierige Gäste und versehentliches Kaputtmachen, nicht gegen
jemanden mit Schraubenzieher und Zeit.

## Entwicklung

Voraussetzung ist **Node.js 24**. Ohne Kamera und Drucker läuft alles mit
Mock-Treibern:

```bash
npm install
npm run build
FOTOBOX_HARDWARE=mock FOTOBOX_DATEN=./daten npm start
```

Dann `http://127.0.0.1:8787` öffnen (Kiosk). Die Verwaltung liegt unter
`/admin`.

```bash
npm run dev          # Server und Oberfläche mit Neuladen
npm test             # alle Tests, ohne Hardware
npm run typecheck
```

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `FOTOBOX_DATEN` | Ablage für Datenbank, Vorlagen und Veranstaltungen | `%PUBLIC%\Fotobox-Daten` |
| `FOTOBOX_HARDWARE` | `echt` (digiCamControl + Windows-Druck) oder `mock` | unter Windows `echt` |
| `FOTOBOX_PORT` | Port für Kiosk und Verwaltung auf 127.0.0.1 | `8787` |
| `FOTOBOX_PORT_OEFFENTLICH` | Port der Galerie im WLAN | `8787` |
| `FOTOBOX_WEB` | Ordner der gebauten Oberfläche | `dist/web` |

**Setup-Datei bauen:** Das übernimmt GitHub Actions auf einem Windows-Rechner
([`.github/workflows/windows-setup.yml`](.github/workflows/windows-setup.yml)),
in dieser Reihenfolge:
1. Tests und Build
2. Paket mit [`skripte/paket-bauen.mjs`](skripte/paket-bauen.mjs)
3. Rauchtest mit dem mitgelieferten Node
4. Inno Setup ([`windows/installer/Fotobox.iss`](windows/installer/Fotobox.iss))
5. Probelauf des fertigen Setups ([`skripte/installer-probe.ps1`](skripte/installer-probe.ps1)):
   - Installation, Druck bis in die Windows-Warteschlange
   - Portal-Dienste
   - Update und Deinstallation

Veröffentlicht wird über denselben Workflow mit `veroeffentlichen: true`.

Für Entwickler bleibt `windows\Installieren.bat`: Installation direkt aus dem
Quelltext.

## Aufbau des Quelltexts

TypeScript durchgehend:
- **Server:** Node.js 24 mit Fastify, SQLite über better-sqlite3
- **Bilder und Druckdateien:** sharp (libvips), pdfkit
- **Oberfläche:** React und Vite
- **Hardware:** Gedruckt wird über System.Drawing.Printing aus der
  Windows-PowerShell, die Kamera läuft über digiCamControl.

```
src/shared/       Domänentypen und Vorgabewerte für Server und Oberfläche
src/server/
  db/             SQLite-Schema und Geräteeinstellungen
  treiber/        Kamera (digiCamControl, Mock), Drucker (Windows, Mock), DNP-Papiervorrat
  bild/           Filter, 3D-LUT, Layout, Druckdatei, Vorschaubilder, Testbilder
  fach/           Veranstaltungen, Sitzungen, Druckwarteschlange, Auslagen, E-Mail, Übergabe
  portal/         Captive Portal: DHCP, DNS, Weiterleitung, Selbstdiagnose
  routen/         Kiosk, Verwaltung, öffentliche Galerie, Medien, Live-Bild
src/web/
  kiosk/          Gästeoberfläche und Servicemenü
  admin/          Verwaltung mit Vorlagen-Editor
  galerie/        Handy-Galerie
windows/          Start- und Einrichtungsskripte, Inno-Setup-Skript
skripte/          Paket bauen, Rauchtest, Installer-Probe
docs/             Anleitungen und Änderungen
```

Die Hardware liegt hinter zwei Schnittstellen (`KameraTreiber`,
`DruckerTreiber`). digiCamControl ist mit der 600D erprobt, wird aber nicht mehr
gepflegt. Scheitert es eines Tages an einem Windows-Update, ist der Ersatz ein
austauschbares Stück und kein Umbau der ganzen Software.

## Dokumentation

| Dokument | Für wen |
|---|---|
| [Anleitung Schritt für Schritt](docs/Anleitung-Schritt-fuer-Schritt.md) | Betrieb ohne IT-Vorkenntnisse |
| [Inbetriebnahme](docs/Inbetriebnahme.md) | Erste Einrichtung mit Kamera-, Druck- und Störungstest |
| [Installation und Updates](docs/Installation-und-Updates.md) | Setup, Updates, neue Version veröffentlichen |
| [Änderungen](docs/Aenderungen.md) | Neuerungen je Version |

Lizenz: siehe [LICENSE](LICENSE).
