# Fotobox einrichten — Schritt für Schritt

Diese Anleitung setzt keinerlei Computerkenntnisse voraus. Jeder Schritt sagt,
was du tun sollst und was danach zu sehen sein muss. Wenn etwas anders aussieht
als beschrieben, steht am Ende jedes Teils, was dann zu tun ist.

**Zeit:** Für Teil A rechne mit 10 Minuten. Teil B bis D dauern noch
einmal ein bis zwei Stunden. Danach ist die Vorbereitung einer Veranstaltung
eine Sache von zehn Minuten.

**Das brauchst du:**

- den Fotobox-PC mit Windows 10 oder 11
- die Setup-Datei `Fotobox-Setup-….exe` (aus dem Internet oder per USB-Stick)
- die Canon EOS 600D mit USB-Kabel und Netzteil
- den DNP-Drucker mit USB-Kabel
- etwa 20 Blatt Papier zum Testen

---

# Teil A — Die Software auf den PC bringen

## Schritt 1: Die Setup-Datei herunterladen

1. Öffne am Fotobox-PC den Browser (Edge oder Chrome).
2. Gib diese Adresse ein:
   `https://github.com/kremer8034/fotobox/releases`
3. Beim obersten Eintrag (der neuesten Version) steht unten **„Assets“**.
   Klicke dort auf **`Fotobox-Setup-1.0.0.exe`** (die Nummer kann höher sein).
4. Der Browser lädt die Datei in den Ordner **Downloads**. Fragt er nach, ob du
   die Datei behalten willst: **„Behalten“**.

Die Datei ohne Internet an der Box? Lade sie an einem anderen PC herunter und
bring sie per USB-Stick mit — sie enthält alles, was die Box braucht.

## Schritt 2: Die Setup-Datei starten

Doppelklick auf `Fotobox-Setup-1.0.0.exe`. Jetzt kommen zwei Fragen von Windows:

**a) „Der Computer wurde durch Windows geschützt“** (blaues Fenster)
- Klicke auf den kleinen Text **„Weitere Informationen“**.
- Klicke dann auf **„Trotzdem ausführen“**.

Das erscheint, weil die Datei nicht mit einem gekauften Zertifikat signiert
ist — nicht, weil etwas nicht stimmt.

**b) „Möchten Sie zulassen, dass durch diese App Änderungen …“**
- Klicke auf **„Ja“**.

## Schritt 3: Durch den Assistenten klicken

1. **„Weiter“**.
2. Den Ordner vorschlagen lassen (`C:\Program Files\Fotobox`) → **„Weiter“**.
3. Den Haken **„Verknüpfungen auf dem Desktop anlegen“** setzen → **„Weiter“**.
4. **„Installieren“**. Das dauert etwa eine Minute.

## Schritt 4: Fertigstellen

Auf der letzten Seite stehen ein oder zwei Haken:

- **„Fotobox starten und die Verwaltung öffnen“** — angehakt lassen.
- **„digiCamControl herunterladen“** — erscheint nur, wenn das Kameraprogramm
  noch fehlt. Haken setzen, dann öffnet sich gleich die Download-Seite
  (siehe Schritt 5).

Klicke auf **„Fertigstellen“**. Nach ein paar Sekunden öffnet sich der Browser
mit einer dunklen Seite: links oben **„Fotobox“**, darunter Übersicht,
Veranstaltungen, Vorlagen, Filter und Gerät. **Das ist die Verwaltung — die
Software ist installiert.**

## Schritt 5: digiCamControl (für die Kamera)

Die Fotobox braucht ein fremdes Programm, um die Kamera zu steuern. Das Setup
darf es nicht mitbringen, deshalb einmal von Hand:

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

## Schritt 6: SumatraPDF (für den Drucker) — schon erledigt

Das Programm, mit dem die Fotobox ohne Druckdialog druckt, bringt das Setup
selbst mit. In der Verwaltung unter **Gerät → Drucker** steht sein Pfad
(`C:\Program Files\Fotobox\windows\SumatraPDF.exe`) schon eingetragen.

## Schritt 7: Was das Setup sonst noch erledigt hat

Du musst davon nichts tun — nur wissen, dass es passiert ist:

- **Autostart:** Beim Anmelden an Windows starten Fotobox-Server und Kiosk von
  selbst. Das Fenster des Servers liegt klein in der Taskleiste.
- **Energiesparen aus:** Bildschirm und PC schlafen am Netzteil nicht ein.
- **Keine Update-Neustarts**, solange jemand angemeldet ist.
- **Firewall-Freigabe** für die Handy-Galerie (nur im privaten Netzwerk).
- **Desktop:** **„Fotobox starten“** (startet alles, was fehlt, und öffnet den
  Kiosk) und **„Fotobox Verwaltung“**.
- **Startmenü → Fotobox:** dieselben beiden, dazu „Fotobox beenden“,
  „Nur den Server starten“, Datenordner, Anleitungen.

Alle Fotos, Veranstaltungen und Einstellungen liegen in
`C:\Users\Public\Fotobox-Daten` — getrennt vom Programm. Deshalb bleiben
sie bei jedem Update erhalten.

## Schritt 8: Die Besitzer-PIN festlegen — sofort

In der Verwaltung links auf **Gerät**, dann bei **Besitzer-PIN** vier bis acht
Ziffern eintippen und speichern (mehr dazu in Schritt 17).

Das gehört an den Anfang, weil ab dem nächsten Windows-Start der Kiosk im
Vollbild aufgeht. Ohne PIN lässt sich das Schloss nicht öffnen; solange noch
keine PIN existiert, zeigt der Kiosk deshalb einen Knopf **„Einrichtung
fortsetzen“**, der zurück in die Verwaltung führt.

## Wenn in Teil A etwas nicht klappt

| Was du siehst | Was zu tun ist |
|---|---|
| Kein „Trotzdem ausführen“, nur „Nicht ausführen“ | Erst auf „Weitere Informationen“ klicken — dann erscheint der Knopf. |
| „Diese App kann auf dem PC nicht ausgeführt werden“ | Der PC hat ein 32-Bit-Windows oder Windows älter als 10. Die Fotobox braucht Windows 10/11 in 64 Bit. |
| Nach „Fertigstellen“ öffnet sich kein Browser | Startmenü → Fotobox → **„Fotobox Verwaltung“**. Kommt „Seite nicht erreichbar“: einen Moment warten und neu laden. |
| Die Verwaltung bleibt „nicht erreichbar“ | Desktop-Verknüpfung **„Fotobox Verwaltung“** noch einmal doppelklicken — sie startet den Server mit. |
| Beim Setup „Datei wird verwendet“ | Startmenü → Fotobox → „Fotobox beenden“, dann das Setup erneut starten. |

Später auf eine neue Version aktualisieren: siehe
[Installation und Updates](Installation-und-Updates.md) — aus der Verwaltung
mit einem Knopf, oder mit der neuen Setup-Datei per USB-Stick.

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

1. Die Verwaltung öffnen: Desktop-Verknüpfung **„Fotobox Verwaltung“** (oder
   Startmenü → Fotobox). Läuft der Server nicht, startet die Verknüpfung ihn
   mit — das dauert dann ein paar Sekunden länger.
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
   - **Pfad zu SumatraPDF.exe**: steht schon da — das Setup bringt
     SumatraPDF mit
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
2. Desktop-Verknüpfung **„Fotobox starten“** doppelklicken (oder Startmenü →
   Fotobox → „Fotobox starten“).

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
   zurück zum Kiosk, die Verwaltung öffnen oder mit **„Kiosk schließen"** zum
   Windows-Desktop wechseln.

Zurück ins Vollbild kommst du mit einem Doppelklick auf **„Fotobox starten“**
(Desktop oder Startmenü) — oder einfach mit dem nächsten Start des PCs.

## Foto per E-Mail (nur wenn die Box Internet hat)

Die Box kann Gästen ihr Foto per E-Mail schicken — aber nur, wenn sie am Abend
wirklich online ist. Im eigenen Reise-Router-WLAN ohne Internet erscheint der
Knopf gar nicht.

**Einmal einrichten** (Verwaltung → **Gerät** → **E-Mail-Versand**):

1. Lege dir ein **eigenes E-Mail-Konto nur für die Fotobox** an — nicht dein
   privates Postfach.
2. Erzeuge dort ein **App-Passwort** (bei Gmail: Google-Konto → Sicherheit →
   App-Passwörter). Das normale Passwort gehört hier nicht hin: Das
   App-Passwort liegt auf der Box, und wer den PC in der Hand hat, könnte es
   finden.
3. Postausgangsserver, Port (465 oder 587), Benutzername, App-Passwort und
   Absender eintragen, **Speichern**.
4. **Testmail senden** an dich selbst. Kommt sie an, passt alles.

Die Verbindung zum Mailserver ist immer verschlüsselt; ohne Verschlüsselung
verschickt die Box nichts.

**Je Veranstaltung** (Detailseite → Reiter **Ausgabe**): E-Mail einschalten,
Einwilligungstext prüfen und die Frist setzen, nach der die Adressen gelöscht
werden. Die Box löscht sie danach selbst. Darunter stehen alle erfassten
Adressen; bittet ein Gast um Löschung, reicht ein Klick auf **Löschen**.

Damit niemand die Box zum Verschicken von Massenmails missbraucht, gilt: nur das
gerade eben fertig gewordene Foto, höchstens drei Mails je Adresse und Tag,
fünf Versuche je Minute, 200 Mails je Feier und Tag.

## Ein Foto aus der Galerie nehmen

Landet ein Foto in der Galerie, das dort nicht hingehört, kann der Gastgeber es
selbst herausnehmen:

1. Oben rechts in die Ecke tippen und zwei Sekunden halten, Betreuer-PIN
   eingeben.
2. Im Servicemenü auf **„Galerie"** tippen.
3. Das Foto antippen und **„Aus der Galerie nehmen"** wählen.

Es verschwindet sofort von allen Handys und vom Bildschirm der Box. Gelöscht
ist es nicht: Mit **„Wieder zeigen"** kommt es zurück, und bei der Übergabe
liegt es im Ordner.

Die Handy-Galerie ist nur erreichbar, solange die Veranstaltung läuft. Nach dem
Abschließen zeigt der alte Link nichts mehr — auch nicht, wenn ein Gast ihn auf
der nächsten Feier wieder aufruft.

## Wenn etwas ausfällt

Die Box ist dafür gebaut, allein beim Gastgeber zu stehen. Das meiste regelt
sie selbst:

- **Kamera abgesteckt oder ausgeschaltet:** Die Gäste lesen „Die Kamera meldet
  sich gerade nicht". Eine laufende Aufnahme wartet bis zu anderthalb Minuten,
  dass die Kamera zurückkommt, und macht dann einfach weiter.
- **Ein Foto klappt nicht** (etwa weil der Autofokus nicht greift): Die Box sagt
  „Gleich noch einmal!" und wiederholt das Foto — bis zu dreimal.
- **digiCamControl stürzt ab oder hängt:** Die Fotobox startet es selbst neu.
- **Papier leer, Drucker aus:** Die Fotos warten in der Warteschlange. Sobald
  neues Papier drin ist bzw. der Drucker wieder an ist, druckt die Box von
  selbst weiter.
- **Die Fotobox-Software stürzt ab:** `Fotobox starten` startet sie nach fünf
  Sekunden neu. Der Bildschirm zeigt so lange „Kleine Pause".
- **Der Browser wird geschlossen oder stürzt ab:** `Kiosk starten` öffnet ihn
  wieder.

Nur wenn der Druckbefehl selbst scheitert (etwa weil SumatraPDF fehlt), hält
die Warteschlange an. Dann im Servicemenü auf **„Papier gewechselt —
weiterdrucken"** tippen, nachdem die Ursache behoben ist.

Jeden Neustart der Software notiert die Box in `neustarts.txt` im Datenordner.
Was genau passiert ist, steht im Protokoll in der Verwaltung.

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

**Danach von der Box löschen:** Die Fotos gehören jetzt dem Gastgeber, nicht
der Box, die du weiterverleihst. Wenn der Stick geprüft ist: Veranstaltung
auf **„Abschließen"**, dann im Reiter **Übergabe** ganz unten **„Veranstaltung
löschen"**. Zur Sicherheit musst du den Namen der Feier eintippen — gelöscht ist
danach alles: Originale, Layouts und E-Mail-Adressen.

## Eigene Filter (LUTs) hinzufügen

Wer in Lightroom, Photoshop oder DaVinci Resolve einen eigenen Look hat, kann
ihn als **`.cube`-Datei** exportieren und in die Fotobox holen:

1. Verwaltung → **Filter** → **„LUT importieren (.cube)"**.
2. Die Datei wählen. Der neue Filter erscheint mit Vorschau in der Liste.
3. In der Veranstaltung unter **„Vorlagen & Filter"** anhaken — erst dann sehen
   ihn die Gäste.

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
