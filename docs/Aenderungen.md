# Änderungen

Was sich von Version zu Version ändert. Der Abschnitt einer Version erscheint
beim Update in der Verwaltung unter „Software“ – also so schreiben, dass du
ihn auf der Box verstehst.

## 1.0.6

- **14 neue, kräftige Filter:** Pop-Art, Warhol, Comic, Neon-Nacht, Wärmebild,
  Glitch, Pink & Blau, Gold, Alien, Infrarot, Solar, Lomo, 70er und Film Noir.
  Sie verändern das Foto deutlich – Farbflächen wie im Siebdruck,
  Wärmekamera-Farben, verschobene Farbkanäle, Filmkorn, grüne Alien-Haut.
  Damit sie die Gäste sehen, in der Veranstaltung unter „Vorlagen & Filter“
  anhaken.
- **Foto am Ergebnis löschen:** Neben „Fertig“ gibt es „Löschen“ (mit
  Rückfrage). Das Foto wird nicht gedruckt – ein schon angestoßener Druck,
  der noch wartet, wird verworfen – und erscheint in keiner Galerie. Löschen
  lässt sich nur das gerade entstandene Foto; in der Galerie gibt es den
  Knopf bewusst nicht. Wer sich vertan hat: Im Servicemenü unter „Galerie“
  lässt es sich zurückholen.
- **Handy-Galerie: „Teilen“:** Neben „Aufs Handy laden“ ein Teilen-Knopf.
  Weil die Galerie ohne Internet im WLAN der Box läuft, lassen Handys das
  direkte Teilen aus der Seite meist nicht zu; dann erklärt der Knopf den
  Weg: Foto gedrückt halten und „Teilen“ wählen – das öffnet WhatsApp,
  OneDrive & Co.
- **E-Mail ohne Mailserver:** Ist E-Mail in der Veranstaltung an, aber unter
  Gerät kein Mailserver eingetragen, erscheint der Knopf „Per E-Mail
  schicken“ nicht. Das steht jetzt unter „Ausgabe“ und im Startbereit-Check,
  statt still zu passieren.
- **E-Mail aus der Galerie:** In der Galerie am Touchscreen hat jedes Foto
  jetzt auch „Per E-Mail schicken“ – nicht nur das gerade entstandene auf der
  Ergebnisseite. Es gelten dieselben Grenzen (Einwilligung, höchstens drei
  Mails je Adresse und Tag, Tageslimit); Fotos, die der Gastgeber aus der
  Galerie genommen hat, lassen sich nicht verschicken.
- **Absender in der Mail:** Stand unter „Absender“ nur ein Name wie
  „Fotobox“, kam die Mail ohne lesbaren Absender an. Ist der Benutzername
  eine Mailadresse, wird daraus jetzt „Fotobox <adresse>“. Ein Name ohne
  jede Adresse lässt sich nicht mehr speichern.

## 1.0.5

- **Papiervorrat vom Drucker – jetzt auch mit PrinterInfo unter C:\DNPPIA:**
  Die Fotobox suchte DNPs Programm nur unter `C:\DNPIA`. Jetzt sieht sie
  jeden Ordner mit „DNP“ im Namen auf Laufwerk C: durch. Findet sie es nicht,
  steht auf der Karte, wo sie gesucht hat.
- **Handy-Galerie lädt wieder:** Die Windows-Firewall ließ die Handys nur in
  „privaten“ Netzen durch – Windows 11 stuft ein neues WLAN aber als
  „öffentlich“ ein. Die Freigabe gilt jetzt für alle Netze (beim Update
  automatisch). Offen ist der Zugang trotzdem nur, solange die Galerie in der
  Veranstaltung eingeschaltet ist. Außerdem nimmt die Fotobox für den QR-Code
  die Adresse des WLAN-Adapters, mit dem sie wirklich verbunden ist, und zieht
  nach, wenn sich die Adresse ändert. Unter „Ausgabe“ steht, in welchem WLAN
  die Handys sein müssen.
- **QR-Code am Startbildschirm links unten** statt rechts.
- **Schloss nur noch als Kreis:** Das Schloss-Symbol ist weg, es bleibt der
  dezente Kreis oben rechts, der sich beim Gedrückthalten füllt.
- **Kurzanleitung neu gestaltet:** A4 hoch, die Betreuer-PIN groß in einer
  eigenen Karte, die drei Schritte zum Servicemenü, Papierwechsel, Störungen
  und die Notfallnummer übersichtlich auf einer Seite. Vorher stand die PIN
  mitten im Fließtext, und eine fast leere zweite Seite kam dazu.
- **QR-Aushang neu gestaltet:** A4 hoch im selben Stil wie die
  Kurzanleitung – große QR-Codes für WLAN und Galerie, darunter WLAN-Name und
  Passwort in Klarschrift. Ohne WLAN-Code steht der Galerie-Code allein und
  größer in der Mitte.
- **Ordner für die Übergabe auswählen statt tippen:** „Ordner wählen …“
  öffnet den gewohnten Ordnerdialog von Windows – mit Schnellzugriff,
  OneDrive und USB-Sticks. Der Pfad lässt sich weiterhin auch eintragen.
- **Kamera unter Gerät:** Der Hinweis erklärt jetzt, dass ISO, Blende und
  Verschlusszeit nur ankommen, wenn das Moduswahlrad der 600D auf „M“ steht.

## 1.0.4

- **Papiervorrat direkt vom Drucker:** Die Fotobox liest jetzt die echte Zahl
  der Restblätter aus dem DNP-Drucker – dieselbe wie „Media Remaining“ in
  DNPs PrinterInfo. Dafür nutzt sie die Bibliothek von PrinterInfo; das
  Programm muss also installiert sein (bei dir ist es das schon). Die Zahl
  steht unter Gerät → „Papiervorrat laut Drucker“, in der Übersicht, im
  Servicemenü und im Startbereit-Check. „Neue Rolle eingelegt“ musst du nicht
  mehr drücken: Nach einem Rollenwechsel steht die neue Zahl spätestens nach
  zehn Minuten da (oder sofort mit „Jetzt vom Drucker lesen“). Gefragt wird
  der Drucker nur, wenn er gerade nicht druckt – das verlangt DNP so.
- **„Kiosk schließen“ schließt jetzt wirklich:** Der Knopf im Servicemenü
  meldete „Kiosk wird geschlossen“, der Browser blieb aber offen. Der Befehl,
  der ihn beenden sollte, lief unter Windows gar nicht erst an. Jetzt geht der
  Kiosk-Browser zu, und du landest auf dem Windows-Desktop. Zurück geht es mit
  „Fotobox starten“ auf dem Desktop. Klappt es doch einmal nicht, steht der
  Grund unter „Was zuletzt gehakt hat“. Auf demselben Weg wurde auch
  „PC herunterfahren“ abgesichert.
- **Drucken geht jetzt wirklich bis zum Drucker:** Bisher übergab die Fotobox
  jedes Bild an SumatraPDF – und das meldete im stillen Druckmodus „erledigt“,
  auch wenn es den Drucker gar nicht erreicht hatte. Die Box zeigte „an
  Windows übergeben“, in der Windows-Druckerwarteschlange kam aber nie ein
  Auftrag an. Jetzt druckt Windows selbst: Die Fotobox wählt im Treiber das
  Papier 6 × 4 Zoll (10 × 15), legt das Bild quer bis an die Kante und schickt
  den Auftrag direkt in die Windows-Warteschlange. Klappt das nicht, steht der
  Grund in Windows' eigenen Worten unter Gerät → Druckwarteschlange, statt
  dass ein Druck still verschwindet. Nach dem ersten Druck steht im Protokoll,
  welches Papier der Treiber genommen hat. Die Druckkalibrierung gilt
  unverändert weiter. SumatraPDF wird nicht mehr gebraucht und beim Update
  entfernt; das Feld dafür unter Gerät → Drucker ist weg.
- **Keine stillen Fehlschläge mehr:** Der Code wurde gezielt nach Stellen
  durchsucht, die „erledigt“ melden, ohne es zu prüfen. Gefunden und behoben:
  - Den **Fotoordner der Kamera** hat digiCamControl manchmal nicht
    übernommen. Die Fotobox hielt das für gelungen, weil digiCamControl auch
    bei einem Fehler „alles in Ordnung“ (HTTP 200) antwortet und den Fehler
    nur in den Text schreibt. Jetzt zählt nur ein echtes „OK“, sonst steht
    der Grund unter „Was zuletzt gehakt hat“.
  - Dasselbe bei **ISO, Blende und Verschlusszeit**: Lehnt die Kamera einen
    Wert ab, sagt die Verwaltung das jetzt, statt „Gespeichert.“ zu zeigen.
  - **„PC herunterfahren“** meldete „fährt in 15 Sekunden herunter“, ohne zu
    wissen, ob Windows zugestimmt hatte. Jetzt kommt eine Fehlermeldung, wenn
    nicht.
  - **Fehlermeldungen aus Windows** (Drucken, Update) waren manchmal nur
    unlesbarer PowerShell-Text („Preparing modules for first use“). Jetzt
    kommt der eigentliche Grund an.
  - Ließ sich digiCamControl oder der Explorer nicht starten, konnte das den
    ganzen Fotobox-Server mitreißen. Jetzt wird es abgefangen.
- **Schloss öffnet schneller:** Eine Sekunde Gedrückthalten reicht jetzt statt
  zwei. Ein kurzes Antippen öffnet weiterhin nichts.
- **Ansagen bei der Aufnahme groß und mittig:** „Gleich geht es los“, „Neue
  Pose!“, „Bitte lächeln!“ stehen jetzt groß in der Bildmitte, halbtransparent
  hinterlegt, sodass man sich dahinter noch sieht.
- **Pfeil zur Kamera:** Unten in der Mitte zeigt ein wippender Pfeil mit „In
  die Kamera schauen“ auf die Linse unter dem Bildschirm – damit die Gäste in
  die Kamera schauen statt auf den Bildschirm.
- **„Abbrechen“ während der Aufnahme:** Oben links führt ein Knopf zurück zum
  Startbildschirm, etwa um doch eine andere Vorlage zu wählen. Während gerade
  ausgelöst wird, ist er kurz ausgeblendet.
- **„Die Kamera meldet sich gerade nicht“, obwohl sie auslöst – behoben:**
  digiCamControl schickt auf die Zustandsabfrage eine Antwort mit einer
  doppelten Längenangabe. Der Browser sieht darüber hinweg, die Fotobox brach
  ab und hielt digiCamControl für stumm. Jetzt liest sie solche Antworten
  nachsichtig. Damit klappt auch das Setzen des Zielordners für die Fotos
  wieder zuverlässig.
- **„Was zuletzt gehakt hat“ leeren:** In der Übersicht löscht der Knopf
  „Liste leeren“ alle angezeigten Warnungen und Fehler – etwa nach dem
  Einrichten oder vor dem Verleih, damit danach nur steht, was beim Kunden
  passiert ist.

## 1.0.3

> **Von Version 1.0.2 aus bitte einmal von Hand installieren:** Dort startet
> „Jetzt installieren“ das Setup nicht. Die Datei `Fotobox-Setup-1.0.3.exe`
> von der Releases-Seite laden und doppelklicken. Ab 1.0.3 geht das Update
> wieder aus der Verwaltung.

- **Druckwarteschlange sichtbar:** Unter Gerät steht jetzt, was mit den
  Druckaufträgen los ist – wie viele bei der Fotobox und wie viele bei Windows
  warten, die letzten Aufträge mit ihrem Status und, falls die Schleife nach
  einem Fehldruck angehalten hat, die Fehlermeldung von Windows. Dazu die Knöpfe
  „Fortsetzen“ und „Wartende verwerfen“.
- **Druck nach einem Update repariert:** Startete die Fotobox, bevor der
  Drucker eingetragen war, scheiterten die wartenden Aufträge mit „Kein Drucker
  ausgewählt“, und die Warteschlange blieb danach angehalten. Jetzt warten die
  Aufträge, bis ein Drucker gewählt ist, und gehen dann von selbst los.
- **Foto ging verloren, obwohl es da war:** Windows meldete beim Schreiben der
  Kameradatei kurz „Datei gesperrt“, und die Aufnahme brach ab. Das wird jetzt
  übergangen; die Fotobox sieht zusätzlich selbst im Ordner nach.
- **Update aus der Verwaltung repariert:** Nach „Jetzt installieren“ kam die
  Windows-Rückfrage nicht, und das Setup startete nie – ohne Hinweis. Jetzt
  meldet die Verwaltung, ob das Setup wirklich läuft, und sagt, wo die
  Rückfrage steckt, falls sie nur in der Taskleiste blinkt. Klappt es nicht,
  öffnet „Setup von Hand starten“ den Ordner mit der schon geladenen und
  geprüften Setup-Datei.
- digiCamControl wird zuverlässiger minimiert: kurz nach dem Start mehrmals,
  und das Live-View-Fenster erst, wenn es wirklich aufgegangen ist.
- Wird in der Verwaltung ein anderer Drucker gewählt, läuft die Warteschlange
  sofort wieder an, auch wenn sie nach einem Fehldruck angehalten war.

## 1.0.2

- **Kamera-Verbindung repariert:** Die Fotobox erreichte digiCamControl nicht,
  obwohl die Kamera dort verbunden war, und startete das Programm alle zwei
  Minuten neu – es sprang dabei jedes Mal vor den Kiosk. Jetzt spricht sie
  digiCamControl richtig an, startet es nicht mehr endlos neu und minimiert
  sein Fenster, sobald es antwortet.
- **Drucker aus einer Liste wählen:** Unter Gerät → Drucker stehen jetzt alle
  Drucker, die Windows kennt, der DNP-Drucker oben mit ★. Kein Abtippen des
  Namens mehr. Stimmt der eingetragene Name nicht und gibt es genau einen
  DNP-Drucker, trägt die Box ihn beim Start selbst ein.
- **Hintergrundbild für den Startbildschirm:** In der Veranstaltung unter
  „Aussehen & PIN“ ein Bild auswählen. Es füllt den ganzen Bildschirm hinter
  Titel und Knöpfen; ein Regler dunkelt es ab, damit alles lesbar bleibt. Die
  Vorschau daneben zeigt, wie es aussieht.
- **Textebenen im Vorlagen-Editor einfacher:** Text und Schriftart stehen
  jetzt ganz oben bei der ausgewählten Ebene. Knöpfe fügen Name der
  Veranstaltung, Datum, Uhrzeit oder eine fortlaufende Nummer ein, und darunter
  steht, wie der Text im Ausdruck aussieht. Eine neue Textebene beginnt mit
  „Euer Text“ statt einem unerklärten Platzhalter; ein Doppelklick auf einen
  Text springt ins Textfeld.
- Die Galerie am Touchscreen sagt im Probelauf, dass Testfotos dort nicht
  erscheinen, statt einfach leer zu sein.
- Fehlt in digiCamControl eine Einstellung, sagen Übersicht und
  Startbereit-Check jetzt genau, welcher Haken unter File → Settings →
  Webserver fehlt.
- Das Schloss oben rechts am Kiosk ist jetzt als kleiner runder Knopf zu
  sehen. Gedrückt halten füllt einen Ring – nach zwei Sekunden kommt die
  PIN-Abfrage. Ein kurzes Antippen bewirkt weiterhin nichts.

## 1.0.1

Wartungsversion: alle Bausteine auf dem neuesten Stand. Für dich ändert sich
an der Bedienung nichts, Veranstaltungen und Fotos bleiben unverändert.

- Mitgeliefertes Node.js 24 (aktuelle Langzeit-Version)
- Datenbank-Baustein Version 13, Bildbearbeitung, Oberfläche und Druckhelfer
  SumatraPDF 3.6.1 aktualisiert
- Keine bekannten Sicherheitslücken in den verwendeten Bausteinen

## 1.0.0

Erste Version für den Betrieb.

- Kompletter Ablauf: Vorlage wählen, Fotos mit Countdown, Filter, Layout, Druck
- Galerie am Touchscreen und im WLAN, Statusseite, Foto per E-Mail
- Servicemenü mit Betreuer- und Besitzer-PIN, Störungshinweise in Alltagssprache
- Verwaltung: Veranstaltungen, Vorlagen-Editor, Filter und LUTs, Gerät, Druckkalibrierung
- Veranstaltungen duplizieren und Einstellungen als Voreinstellung speichern
- Installation per Setup-Datei, Updates aus der Verwaltung oder per USB-Stick
- Desktop-Icon „Fotobox starten“ startet Server und Kiosk, soweit sie nicht laufen
