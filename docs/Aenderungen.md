# Änderungen

Was sich von Version zu Version ändert. Der Abschnitt einer Version erscheint
beim Update in der Verwaltung unter „Software“ – also so schreiben, dass du
ihn auf der Box verstehst.

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
