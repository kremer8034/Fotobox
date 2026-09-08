# Fotobox

Offline-fähige Fotobox-Software für einen Windows-PC mit Canon EOS 600D und
DNP DS-RX1HS. Vorlage wählen, Fotos mit Countdown aufnehmen, Filter anwenden,
Layout zusammensetzen, drucken — und alles sauber pro Veranstaltung ablegen.

Der reine Fotobox-Betrieb läuft **vollständig ohne Internet**. Online-Funktionen
(Handy-Galerie, E-Mail) sind pro Veranstaltung zuschaltbar und standardmäßig aus.

## Was die Software kann

- **Kiosk-Ablauf**: Vorlage wählen → Bereitmachen mit Live-Bild → Countdown über
  dem Live-Bild → Aufnahmen → Filter → Ergebnis und Ausgabe auf einer Seite.
- **Vorlagen als freier Ebenenstapel** aus Bild-, Foto- und Textebenen. Ein
  Zierrahmen kann über einem Foto und gleichzeitig unter dem Logo liegen.
  Textebenen kennen die Platzhalter `{veranstaltung}`, `{datum}`, `{uhrzeit}`
  und `{nummer}` — dieselbe Vorlage passt damit auf jede Feier. Die Schriftart
  ist je Textebene wählbar; eigene TTF- oder OTF-Dateien lassen sich
  hinzufügen und gelten dann auch für den Ausdruck.
- **Filter** als Presets, dazu Import eigener `.cube`-LUTs. Angewendet wird
  ausschließlich auf die Fotos, nie auf Bild- und Textebenen der Vorlage.
- **Druckweg mit exakter Größe**: Layout als JPEG in 1800 × 1200 px, verpackt
  in ein PDF mit exakt 152,4 × 101,6 mm, gedruckt ohne Dialog mit `noscale`.
- **Druckkalibrierung** mit Millimeter-Testbild gegen den Beschnitt des
  randlosen Drucks.
- **Veranstaltungen** mit Lebenszyklus, Probelauf-Modus, Startbereit-Check,
  Auslagenersatz und Materialzähler.
- **Kiosk-Sperre** mit verstecktem Schloss, zwei PIN-Ebenen und Servicemenü.
- **Übergabe** des Event-Ordners auf einen USB-Stick, mit Prüfmarker und einer
  eigenständigen `galerie.html` zum Doppelklicken.

## Schnellstart zur Entwicklung

Ohne Kamera und Drucker, mit Mock-Treibern:

```bash
npm install
npm run build
FOTOBOX_HARDWARE=mock FOTOBOX_DATEN=./daten npm start
```

Dann `http://127.0.0.1:8787` öffnen. Für die Entwicklung mit Neuladen:

```bash
npm run dev          # Server und Weboberfläche parallel
npm test             # 41 Tests, alle ohne Hardware
npm run typecheck
```

Umgebungsvariablen:

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `FOTOBOX_DATEN` | Ablage für Datenbank, Vorlagen und Events | `%PUBLIC%\Fotobox-Daten` |
| `FOTOBOX_HARDWARE` | `echt` (digiCamControl + Windows-Druck) oder `mock` | unter Windows `echt` |
| `FOTOBOX_PORT` | Port für Kiosk und Verwaltung auf 127.0.0.1 | `8787` |
| `FOTOBOX_WEB` | Ordner der gebauten Oberfläche | `dist/web` |

## Installation auf der Fotobox

**Ohne IT-Vorkenntnisse:
[docs/Anleitung-Schritt-fuer-Schritt.md](docs/Anleitung-Schritt-fuer-Schritt.md)**
— 22 nummerierte Schritte vom Herunterladen bis zum ersten Ausdruck, jeder
Klick einzeln beschrieben, mit den Windows-Warnmeldungen, die unterwegs
auftauchen, und was dann zu tun ist. Das ist der empfohlene Weg.

Die Kurzfassung für alle, die Windows kennen: Doppelklick auf
`windows\Installieren.bat`. Die Datei holt sich selbst die nötigen Rechte und
startet `Installieren.ps1` — kein Rechtsklick, keine Ausführungsrichtlinie.

Das Skript erledigt alles in einem Zug: Node.js prüfen und bei Bedarf über
winget installieren, Abhängigkeiten holen, Oberfläche bauen, Tests laufen
lassen, Datenordner anlegen, digiCamControl, SumatraPDF und den DNP-Drucker
suchen, Autostart einrichten, Bildschirmabschaltung und Standby abschalten und
die Anzeigeskalierung prüfen. Als Administrator legt es zusätzlich die
Firewall-Freigabe an — eng begrenzt auf den einen Port und das private
Netzwerkprofil.

Dafür braucht der PC **einmalig Internet**. Danach nie wieder.

Anschließend:

```
windows\Fotobox starten.bat        Server starten
windows\Verwaltung oeffnen.bat     Verwaltung im Browser öffnen
windows\Kiosk starten.bat          Browser im Kiosk-Vollbild
```

**Der technische Weg von der leeren Festplatte bis zur einsatzbereiten Box
steht in [docs/Inbetriebnahme.md](docs/Inbetriebnahme.md)** — mit Kamera- und
Druckertest einzeln, Kalibrierung und dem Störungstest.

### Checkliste von Hand

1. **Anzeigeskalierung auf 100 %.** Bei 150 % meldet der Browser nur 1280 × 720
   und sämtliche Millimeter-Maße der Oberfläche verschieben sich.
2. **DNP-Treiber**: randlos, Papierformat 10 × 15 und das **ICC-Farbprofil**
   setzen. Ohne Profil treffen Thermosublimationsdrucker Hauttöne und Rot
   spürbar daneben.
3. **digiCamControl** installieren, dessen Webserver auf Port 5513 einschalten
   und das Programm einmal starten.
4. **SumatraPDF** installieren oder als `SumatraPDF.exe` in den Ordner
   `windows\` legen — der Server findet es beim Start selbst und trägt den
   Pfad unter *Gerät → Drucker* ein.
5. **Besitzer-PIN vergeben.** Ohne sie lässt sich keine Veranstaltung starten;
   eine ausgelieferte Standard-PIN gibt es bewusst nicht.
6. **Kamera**: Netzteil mit Dummy-Akku verwenden, LED-Dauerlicht aufstellen,
   M-Modus mit festen Werten für ISO, Blende und Zeit.
7. **Druckkalibrierung**: unter *Gerät → Drucker* das Testbild drucken, an den
   Millimeterskalen ablesen und die Werte eintragen.

## Vor jeder Veranstaltung

1. Veranstaltung anlegen, Vorlagen und Filter freigeben, Zeiten prüfen.
2. Betreuer-PIN setzen — sie bekommt der Gastgeber.
3. Unterlagen erzeugen: die Kurzanleitung kommt in die Box, der QR-Aushang
   außen dran.
4. **Startbereit-Check** laufen lassen und erst dann auf *aktiv* schalten.
5. Optional **Probelauf** einschalten: Testsitzungen zählen weder in den
   Auslagenersatz noch in die Galerie und landen in `_probelauf/`.

## Ordnerstruktur der Daten

```
Fotobox-Daten/
  fotobox.db
  vorlagen/                     Vorlagen-Definitionen und ihre Bilddateien
  schriften/                    eigene Schriftdateien (TTF/OTF)
  luts/                         eigene .cube-Dateien
  events/
    2026-05-16_Hochzeit-Mueller/
      event.json                Kopie der Konfiguration, macht den Ordner portabel
      01_originale/             unveränderte Kameradateien
      02_bearbeitet/            Fotos mit angewendetem Filter
      03_layouts/               fertige Layouts — der Galerie-Inhalt
      04_druck/                 Druck-PDFs 152,4 × 101,6 mm
      _probelauf/               Sitzungen aus dem Probelauf
      .cache/                   Thumbnails, Testdrucke, Unterlagen
      auslagen.csv
      galerie.html              eigenständige Offline-Galerie für den Gastgeber
```

## Sicherheit

Der realistische Angreifer ist der neugierige Gast mit Smartphone im selben
WLAN — darauf ist das Konzept zugeschnitten:

- Der Server bindet **standardmäßig nur auf `127.0.0.1`**. Die LAN-Adresse kommt
  ausschließlich dann dazu, wenn eine Veranstaltung die Galerie eingeschaltet
  hat, und dort läuft eine **zweite Instanz, die nur Galerie und Status kennt**.
  Kiosk und Verwaltung sind über das Netz nicht bloß versteckt, sondern gar
  nicht erst erreichbar.
- **Kein Dateipfad kommt je aus der URL.** Bilder werden über Ausgabe-IDs
  angefordert; den Pfad baut der Server und prüft ihn gegen den Ordner des
  freigegebenen Events.
- **Galerie-Zugang über ein Zufallstoken** mit 128 Bit, jederzeit erneuerbar.
- **PINs nur als scrypt-Hash**, Drosselung nach drei Fehlversuchen.
- **EXIF wird entfernt** aus allem, was über die Galerie herausgeht.

Ehrlich zur Grenze: Ein Browser-Kiosk ist nur so sicher wie Windows darunter.
Das Konzept schützt zuverlässig gegen neugierige Gäste und versehentliches
Kaputtmachen — nicht gegen jemanden mit Schraubenzieher und Zeit.

## Architektur

```
src/shared/     Domänentypen und Vorgabewerte, von Server und Oberfläche genutzt
src/server/
  db/           SQLite-Schema und Geräteeinstellungen
  treiber/      Kamera (digiCamControl, Mock) und Drucker (Windows, Mock)
  bild/         Filter, 3D-LUT, Layout-Compositing, Druck-PDF, Testbilder
  fach/         Events, Sitzungen, Druckwarteschlange, Auslagen, Übergabe
  routen/       Kiosk, Verwaltung, öffentliche Galerie, Medien, Live-View
src/web/
  kiosk/        Gästeoberfläche
  admin/        Verwaltung
  galerie/      Handy-Ansicht
```

Die Hardware liegt hinter zwei Schnittstellen (`KameraTreiber`,
`DruckerTreiber`). digiCamControl ist mit der 600D erprobt, wird aber nicht mehr
gepflegt — falls es eines Tages an einem Windows-Update scheitert, ist der
Ersatz ein austauschbares Stück und kein Umbau der ganzen Software.

Einen Webcam-Notbetrieb gibt es bewusst nicht: Die Box läuft mit der 600D oder
gar nicht.
