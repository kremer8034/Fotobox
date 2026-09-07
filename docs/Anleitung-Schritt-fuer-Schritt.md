# Fotobox einrichten — Schritt für Schritt

Diese Anleitung setzt keinerlei Computerkenntnisse voraus. Jeder Schritt sagt,
was du tun sollst und was danach zu sehen sein muss. Wenn etwas anders aussieht
als beschrieben, steht am Ende jedes Teils, was dann zu tun ist.

**Zeit:** Für Teil A rechne mit 20 bis 30 Minuten. Teil B bis D dauern noch
einmal ein bis zwei Stunden. Danach ist die Vorbereitung einer Veranstaltung
eine Sache von zehn Minuten.

**Das brauchst du:**

- den Fotobox-PC mit Windows 10 oder 11
- eine Internetverbindung — **nur für die Installation**, danach nie wieder
- die Canon EOS 600D mit USB-Kabel und Netzteil
- den DNP-Drucker mit USB-Kabel
- etwa 20 Blatt Papier zum Testen

---

# Teil A — Die Software auf den PC bringen

## Schritt 1: Die Dateien herunterladen

1. Öffne am Fotobox-PC den Browser (Edge oder Chrome).
2. Gib diese Adresse ein:
   `https://github.com/kremer8034/Fotobox`
3. Oben rechts über der Dateiliste ist ein grüner Knopf **„Code"**. Klicke ihn an.
4. Im aufklappenden Menü klickst du auf **„Download ZIP"**.
5. Der Browser lädt eine Datei namens `Fotobox-main.zip` herunter, meist in den
   Ordner **Downloads**.

> **Wichtig, sonst geht es später schief:** Der Branch mit der fertigen
> Software heißt `claude/fotobox-software-plan-naq4i6`. Wenn oben links über
> der Dateiliste ein Knopf mit einem anderen Namen steht (z. B. `main`),
> klicke ihn an und wähle den Branch mit `fotobox-software-plan` im Namen aus.
> **Erst danach** auf „Code → Download ZIP".

## Schritt 2: Die Sperre von Windows aufheben

Windows markiert alles, was aus dem Internet kommt, als „gesperrt". Wenn du das
nicht aufhebst, verweigert der Rechner später den Start.

1. Öffne den Ordner **Downloads**.
2. Klicke die Datei `Fotobox-main.zip` mit der **rechten** Maustaste an.
3. Wähle ganz unten **„Eigenschaften"**.
4. Unten im Fenster steht eventuell ein Kästchen **„Zulassen"** oder
   **„Blockierung aufheben"**. Setze dort einen Haken.
5. Klicke auf **„OK"**.

Steht dort kein solches Kästchen, ist alles in Ordnung — weiter.

## Schritt 3: Auspacken

1. Klicke die ZIP-Datei mit der **rechten** Maustaste an.
2. Wähle **„Alle extrahieren…"**.
3. Klicke auf **„Extrahieren"**.
4. Es öffnet sich ein Ordner. Darin liegt ein weiterer Ordner, der ebenfalls
   „Fotobox" heißt (mit einem Zusatz). **Öffne ihn mit einem Doppelklick.**

Du bist am richtigen Ort, wenn du hier unter anderem Folgendes siehst:
`README.md`, `package.json` und einen Ordner namens `windows`.

## Schritt 4: Den Ordner an einen guten Platz legen

Der Ordner sollte nicht in „Downloads" bleiben.

1. Gehe einen Ordner zurück, bis du den Fotobox-Ordner als Ganzes siehst.
2. Klicke ihn an und drücke **Strg + X** (ausschneiden).
3. Öffne im linken Bereich **„Dieser PC"** und dort das Laufwerk **C:**.
4. Drücke **Strg + V** (einfügen).

Der Ordner liegt jetzt unter `C:\Fotobox-main` oder ähnlich. Öffne ihn.

## Schritt 5: Die Installation starten

1. Öffne im Fotobox-Ordner den Unterordner **`windows`**.
2. Mache einen **Doppelklick** auf die Datei **`Installieren`**
   (sie hat ein Zahnrad-Symbol und ist vom Typ „Windows-Batchdatei").

Jetzt passieren nacheinander drei Dinge:

**a) Windows warnt vor unbekannter Software.**
Es erscheint ein blaues Fenster: *„Der Computer wurde durch Windows geschützt"*.
- Klicke auf den kleinen Text **„Weitere Informationen"**.
- Klicke dann auf **„Trotzdem ausführen"**.

**b) Windows fragt nach Administratorrechten.**
Es erscheint ein Fenster mit der Frage, ob Änderungen zugelassen werden sollen.
- Klicke auf **„Ja"**.

**c) Ein schwarzes Fenster öffnet sich und arbeitet.**
Das ist normal. Es lädt Bausteine aus dem Internet, das dauert je nach
Verbindung **5 bis 15 Minuten**. Zwischendurch sieht es aus, als würde nichts
passieren — bitte einfach warten und das Fenster nicht schließen.

## Schritt 6: Das Ergebnis lesen

Wenn das schwarze Fenster fertig ist, steht am Ende ein Kasten:

```
============================================
 Fertig. So geht es weiter:
============================================
```

Scrolle im Fenster **nach oben** und suche nach gelben Zeilen. Gelb heißt:
„Das fehlt noch." Grün heißt: „Alles gut."

Wahrscheinlich stehen dort zwei gelbe Hinweise — die beiden Zusatzprogramme aus
dem nächsten Schritt. Das ist normal.

Drücke eine Taste, um das Fenster zu schließen.

## Schritt 7: Die zwei Zusatzprogramme

Die Fotobox braucht zwei fremde Programme. Ohne sie löst die Kamera nicht aus
und der Drucker druckt nicht.

### digiCamControl (für die Kamera)

1. Öffne im Browser: `https://digicamcontrol.com/download`
2. Lade die normale Version herunter (der große Knopf **„Download"**).
3. Doppelklick auf die heruntergeladene Datei, dann immer auf **„Weiter"** bzw.
   **„Next"** und am Ende **„Install"**.
4. **Wichtig:** Starte digiCamControl einmal.
   - Klicke oben auf **„File"**, dann **„Settings"**.
   - Suche links den Punkt **„Webserver"**.
   - Setze einen Haken bei **„Enable"** (oder „Webserver aktivieren").
   - Der Port muss **5513** sein.
   - Schließe digiCamControl und starte es noch einmal neu.

### SumatraPDF (für den Drucker)

1. Öffne im Browser: `https://www.sumatrapdfreader.org/download-free-pdf-viewer`
2. Lade die **portable** Fassung herunter (64-bit).
3. Du bekommst eine einzelne Datei namens `SumatraPDF-…-64.exe`.
4. Benenne sie um in genau **`SumatraPDF.exe`**:
   Rechtsklick → **„Umbenennen"**.
5. Verschiebe diese Datei in deinen Fotobox-Ordner, dort in den Unterordner
   **`windows`**.

Die Fotobox findet sie dort von allein.

## Schritt 8: Zum ersten Mal starten

1. Gehe in den Ordner **`windows`** deines Fotobox-Ordners.
2. Doppelklick auf **`Fotobox starten`**.

Ein schwarzes Fenster öffnet sich und bleibt offen. Darin steht eine Zeile wie:

```
[info] server: Kiosk und Admin laufen auf http://127.0.0.1:8787
```

**Dieses Fenster muss offen bleiben.** Es ist die Fotobox. Schließt du es, ist
die Fotobox aus.

3. Doppelklick auf **`Verwaltung oeffnen`**.

Der Browser öffnet sich und zeigt eine dunkle Seite mit dem Wort **„Fotobox"**
links oben und den Punkten Übersicht, Veranstaltungen, Vorlagen und Gerät.

**Wenn du das siehst, ist die Software fertig installiert.**

## Wenn in Teil A etwas nicht klappt

| Was du siehst | Was zu tun ist |
|---|---|
| Das schwarze Fenster schließt sich sofort wieder | Schritt 2 vergessen — ZIP-Datei war gesperrt. Noch einmal von vorn ab Schritt 1. |
| „node wird nicht als Befehl erkannt" | Den PC einmal neu starten und `Installieren` erneut doppelklicken. |
| Rote Zeilen mit „npm install ist fehlgeschlagen" | Keine Internetverbindung. Verbindung prüfen und erneut starten. |
| Der Browser zeigt „Diese Seite kann nicht angezeigt werden" | Das Fenster von `Fotobox starten` ist zu. Noch einmal doppelklicken und 10 Sekunden warten. |
| Weiße leere Seite im Browser | Die Installation ist nicht durchgelaufen. `Installieren` erneut doppelklicken. |

---

# Teil B — Die Kamera anschließen

Das ist die Stelle, an der am ehesten etwas hakt. Deshalb prüfen wir sie
einzeln, bevor die Fotobox ins Spiel kommt.

## Schritt 9: Kamera vorbereiten

1. **Netzteil einsetzen**, nicht den Akku. Der Akku wäre nach etwa einer Stunde
   leer, weil das Livebild dauerhaft läuft.
2. Am Objektiv den kleinen Schalter von **AF** auf **MF** stellen (manueller
   Fokus).
3. Stelle dich dorthin, wo später die Gäste stehen, und drehe am Objektivring,
   bis das Bild scharf ist.
4. Am Kameradrehrad **M** einstellen.
5. Die SD-Karte in der Kamera lassen — sie ist die zweite Sicherung.
6. USB-Kabel in die Kamera und in einen Anschluss **auf der Rückseite** des PCs
   (nicht vorne, nicht in einen Verteiler).
7. Kamera einschalten.

## Schritt 10: Prüfen, ob digiCamControl die Kamera sieht

1. Starte **digiCamControl**.
2. Links oben muss deine Kamera auftauchen, meist als „Canon EOS 600D".

**Wenn dort nichts steht:**
- Kamera aus- und wieder einschalten.
- Anderes USB-Kabel probieren.
- Prüfen, ob Canons Programm **„EOS Utility"** läuft — es streitet sich mit
  digiCamControl um die Kamera. Rechtsklick auf das Symbol unten rechts neben
  der Uhr → beenden.

## Schritt 11: Livebild und Auslösen prüfen

Diese drei Adressen gibst du nacheinander im Browser ein. digiCamControl muss
dabei laufen.

**Erste Adresse** — schaltet das Livebild ein:
```
http://localhost:5513/?CMD=LiveViewWnd_Show
```
An der Kamera muss der Spiegel hochklappen (es klackt), und in digiCamControl
öffnet sich ein Fenster mit dem Livebild.

**Zweite Adresse** — holt ein Einzelbild:
```
http://localhost:5513/liveview.jpg
```
Im Browser muss ein Foto von dem erscheinen, was die Kamera gerade sieht.

**Dritte Adresse** — löst aus:
```
http://localhost:5513/?CMD=Capture
```
Die Kamera muss auslösen.

**Wenn eine dieser Adressen nicht funktioniert**, liegt es an der Kamera oder an
digiCamControl — nicht an der Fotobox-Software. Gehe zurück zu Schritt 7 und
prüfe, ob der Webserver in digiCamControl wirklich eingeschaltet und der Port
5513 eingetragen ist, und ob du das Programm danach neu gestartet hast.

## Schritt 12: Die Fotobox sieht die Kamera

1. `Fotobox starten` doppelklicken (falls das Fenster zu ist).
2. `Verwaltung oeffnen` doppelklicken.
3. Links auf **„Gerät"** klicken.

Oben steht der Zustand. Die Kamera muss als **bereit** gemeldet sein.

---

# Teil C — Den Drucker einrichten

## Schritt 13: Den Windows-Treiber einstellen

1. Drucker einschalten und per USB anschließen.
2. Windows-Startknopf → **Einstellungen** (Zahnrad) → **Bluetooth und Geräte**
   → **Drucker und Scanner**.
3. Klicke deinen DNP-Drucker an, dann auf **„Druckeinstellungen"**.
4. Stelle dort ein:
   - Papierformat **10 × 15** (heißt manchmal 4 × 6)
   - **randlos** (englisch „borderless")
   - falls vorhanden: das **ICC-Farbprofil von DNP** auswählen
5. Notiere dir den **genauen Namen** des Druckers, wie er in der Liste steht.

Das Farbprofil ist keine Kleinigkeit: Ohne es treffen diese Drucker Hauttöne und
Rot spürbar daneben.

## Schritt 14: Den Drucker in der Fotobox eintragen

1. In der Verwaltung links auf **„Gerät"**.
2. Unter **Drucker** eintragen:
   - **Windows-Druckername**: genau der Name aus Schritt 13
   - **Pfad zu SumatraPDF.exe**: falls du die Datei wie beschrieben in den
     `windows`-Ordner gelegt hast, steht der Pfad schon da
3. Klicke einmal irgendwo daneben — es speichert von selbst.

## Schritt 15: Trocken testen (ohne Papier zu verbrauchen)

Bevor echtes Papier durchläuft, prüfen wir den Weg:

1. Trage als Druckernamen vorübergehend **`Microsoft Print to PDF`** ein.
2. Klicke auf **„Kalibrier-Testbild drucken"**.
3. Es öffnet sich ein Fenster, das nach einem Speicherort fragt. Speichere die
   Datei irgendwo und öffne sie.

Siehst du ein Bild mit Millimeterskalen an allen vier Rändern und einem roten
Rahmen, funktioniert der Druckweg. Trage jetzt wieder den echten DNP-Namen ein.

## Schritt 16: Kalibrieren — der einzige nötige Testdruck

Randloser Druck schneidet immer ein wenig vom Rand ab. Wie viel, ist bei jedem
Drucker anders. Das messen wir jetzt aus.

1. Klicke auf **„Kalibrier-Testbild drucken"**.
2. Nimm den Ausdruck und schau dir die vier Ränder an. Auf dem Bild ist ein
   **roter Rahmen** — das ist die Sollkante — und daneben eine
   Millimeter-Skala.
3. Lies ab: Wie viele Millimeter fehlen an jeder Seite?
4. Trage die Werte unter **Druckkalibrierung** ein:
   - Fehlt links mehr als rechts, verschiebe mit **Versatz waagerecht** nach
     rechts (positive Zahl).
   - Fehlt oben mehr als unten, verschiebe mit **Versatz senkrecht** nach unten.
   - Fehlt rundum gleich viel, erhöhe die **Skalierung** leicht.
5. Drucke das Testbild noch einmal. Jetzt muss der rote Rahmen rundum
   gleichmäßig sitzen.

Zwei bis drei Anläufe sind normal. Danach ist das für immer erledigt.

---

# Teil D — Die erste Veranstaltung

## Schritt 17: Deine PIN festlegen

1. In der Verwaltung links auf **„Gerät"**.
2. Ganz unten bei **Besitzer-PIN** eine vier- bis achtstellige Zahl eingeben.
3. Auf **„PIN setzen"** klicken.

**Merke dir diese Zahl.** Sie ist dein Zugang, wenn die Fotobox im gesperrten
Vollbild läuft. Ohne sie lässt sich keine Veranstaltung starten — eine
voreingestellte PIN gibt es aus gutem Grund nicht.

## Schritt 18: Veranstaltung anlegen

1. Links auf **„Veranstaltungen"**.
2. Namen eingeben (z. B. „Hochzeit Müller") und das Datum wählen.
3. Auf **„Anlegen"** klicken.

Du landest automatisch auf der Detailseite.

## Schritt 19: Einstellen, was die Gäste dürfen

Scrolle auf der Detailseite nach unten und setze Haken bei den Vorlagen, die zur
Auswahl stehen sollen. Fünf Standardvorlagen sind bereits dabei.

Weiter unten:
- **Betreuer-PIN** setzen — die bekommt der Gastgeber. Sie öffnet nur die
  Handgriffe des Alltags, nicht die Verwaltung.
- Bei **Ausgabe** einstellen, ob gedruckt werden darf und wie viele Kopien
  höchstens.

## Schritt 20: Der Startbereit-Check

1. Auf der Detailseite auf **„Jetzt prüfen"** klicken.

Es erscheint eine Liste. Jede Zeile hat ein Zeichen:
- **grünes ✓** — alles gut
- **gelbes !** — nur ein Hinweis, hält nicht auf
- **rotes ✗** — muss behoben werden

Arbeite die roten Zeilen ab. Der Text daneben sagt, was fehlt.

## Schritt 21: Losgehen

1. Auf der Detailseite oben auf **„startbereit"** klicken, dann auf **„aktiv"**.
2. Im Ordner `windows` auf **`Kiosk starten`** doppelklicken.

Der Bildschirm wird zum Vollbild und zeigt „Fotobox" mit einem großen Knopf
**„Foto starten"**. Das sehen deine Gäste.

## Schritt 22: Probelauf vor der echten Feier

Bevor die ersten Gäste kommen, mache drei oder vier komplette Durchgänge zur
Probe — mit echtem Druck, damit du Licht und Layout beurteilen kannst.

Damit diese Testbilder nicht mitgezählt werden:

1. In der Verwaltung auf die Detailseite der Veranstaltung.
2. Auf **„Probelauf ein"** klicken.
3. Deine Testdurchgänge machen.
4. Danach auf **„Probelauf aus"** klicken.

Alles aus dem Probelauf zählt weder in die Abrechnung noch in die Gästegalerie.

## Wie du wieder aus dem Vollbild herauskommst

Im Vollbild gibt es kein sichtbares Menü — das ist Absicht, damit Gäste nichts
verstellen.

1. Tippe **oben rechts in die äußerste Ecke** des Bildschirms und **halte zwei
   Sekunden gedrückt**. Kurzes Antippen tut nichts.
2. Ein Zahlenfeld erscheint. Gib deine Besitzer-PIN ein und tippe auf **OK**.
3. Du landest im Servicemenü, nicht auf dem Windows-Desktop. Dort kannst du
   zurück zum Kiosk, die Verwaltung öffnen oder das Vollbild verlassen.

Auf dem Zahlenfeld gibt es außerdem den Knopf **„Was ist los?"**. Der braucht
keine PIN und zeigt in normalen Worten, was die Fotobox gerade meldet. Den darf
auch der Gastgeber benutzen.

---

# Nach der Veranstaltung

## Die Bilder dem Gastgeber geben

1. USB-Stick anstecken.
2. In der Verwaltung auf die Detailseite der Veranstaltung.
3. Bei **Übergabe an den Gastgeber** den Laufwerksbuchstaben eintragen
   (z. B. `E:\`).
4. Auf **„Jetzt übergeben"** klicken.

Die Fotobox kopiert alles und prüft danach nach, ob wirklich alles angekommen
ist. Erst dann meldet sie Vollzug.

Auf dem Stick liegt unter anderem eine Datei **`galerie.html`**. Der Gastgeber
kann sie doppelklicken und bekommt alle Bilder als Übersicht — ohne irgendetwas
zu installieren.

## Was du bekommen hast

Auf derselben Seite steht unter **Auslagenersatz**, wie viele Ausdrucke gemacht
wurden und welcher Betrag sich daraus ergibt. Mit **„CSV herunterladen"**
bekommst du eine Datei, die sich mit Excel öffnen lässt.

---

# Häufige Fragen

**Muss der PC ins Internet?**
Nur einmal bei der Installation. Danach läuft die Fotobox vollständig ohne
Internet — Fotografieren, Filter und Drucken brauchen keine Verbindung.

**Alles ist winzig oder riesig auf dem Bildschirm.**
Windows-Startknopf → Einstellungen → System → Bildschirm → **Skalierung auf
100 %** stellen. Danach den Kiosk neu starten.

**Die Fotobox startet nach dem Einschalten des PCs nicht von allein.**
Das Installationsskript richtet das ein. Prüfe, ob du dich am PC anmelden musst
— der Autostart greift erst nach der Anmeldung. Am besten die automatische
Anmeldung in Windows einschalten.

**Der Drucker hat mitten in der Feier kein Papier mehr.**
Neue Rolle einlegen. Dann oben rechts lange drücken, PIN eingeben und
**„Papier gewechselt — weiter drucken"** wählen. Bei einer ganz neuen Rolle
zusätzlich **„Neue Rolle eingelegt"**. Kein einziges Foto geht dabei verloren —
die wartenden Ausdrucke laufen danach durch.

**Kann ich die Fotobox ohne mich verleihen?**
Ja, dafür ist sie gebaut. Erzeuge auf der Detailseite unter **Unterlagen** die
Kurzanleitung — sie enthält die Betreuer-PIN und kommt in die Box. Der
Gastgeber kann damit Papier wechseln und nachdrucken, aber nichts verstellen.
