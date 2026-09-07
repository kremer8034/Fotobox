# Inbetriebnahme

Diese Anleitung führt von der leeren Festplatte bis zur einsatzbereiten Box.
Sie ist nach dem Prinzip aufgebaut: **erst das Riskante, dann das Bequeme.**
Kamera und Drucker sind die einzigen Stellen, an denen wirklich etwas
schiefgehen kann — deshalb kommen sie zuerst, und zwar einzeln.

Plane für den ersten Durchgang zwei bis drei Stunden ein. Danach ist die
Vorbereitung einer Veranstaltung eine Sache von zehn Minuten.

---

## Teil 1 — Software auf den PC

### 1.1 Projekt holen

Am einfachsten über Git:

```
git clone https://github.com/kremer8034/Fotobox.git
cd Fotobox
git checkout claude/fotobox-software-plan-naq4i6
```

Ohne Git: Auf GitHub oben rechts auf **Code → Download ZIP**, entpacken, und im
entpackten Ordner weitermachen.

### 1.2 Ein Skript, das den Rest erledigt

Rechtsklick auf `windows\Installieren.ps1` → **Mit PowerShell ausführen**.
Beim ersten Mal am besten als Administrator, dann wird auch die
Firewall-Freigabe gleich mit angelegt.

Das Skript prüft Node.js (und installiert es bei Bedarf über winget), holt die
Abhängigkeiten, baut die Oberfläche, lässt die Tests laufen, legt den
Datenordner an, sucht digiCamControl, SumatraPDF und den DNP-Drucker und
richtet den Autostart ein.

**Dafür braucht der PC einmalig Internet.** Danach nie wieder.

Meldet das Skript fehlende Zusatzprogramme, hole sie nach:

| Programm | Wofür | Woher |
|---|---|---|
| digiCamControl | Kamera auslösen und Live-View | digicamcontrol.com/download |
| SumatraPDF | dialogfrei drucken | sumatrapdfreader.org (portable Fassung genügt) |

Die portable SumatraPDF-Datei kannst du einfach nach `windows\SumatraPDF.exe`
legen — dort sucht die Software von selbst.

### 1.3 Läuft es?

```
windows\Fotobox starten.bat
```

Dann `windows\Fotobox oeffnen.bat` — die Verwaltung muss erscheinen. Wenn ja,
ist die Software fertig und der Rest ist Hardware.

---

## Teil 2 — Die Kamera

Der heikelste Teil. Bitte einzeln durchgehen und nicht überspringen: Wenn hier
etwas klemmt, findest du es so in Minuten statt in Stunden.

### 2.1 Vorbereiten

- **Netzteil mit Dummy-Akku** einsetzen, nicht den Akku. Dauerhafter Live-View
  zieht einen 600D-Akku in etwa einer Stunde leer.
- Objektiv auf **manuellen Fokus**, scharfstellen auf die Stelle, wo die Gäste
  stehen. Der Kontrast-Autofokus der 600D ist im Live-View träge.
- **M-Modus** mit festen Werten für ISO, Blende und Zeit. Mit LED-Dauerlicht
  bleiben die Bilder so den ganzen Abend gleich hell.
- SD-Karte drin lassen — sie ist die zweite Sicherung.
- USB-Kabel an einen **rückseitigen** Port des PCs, nicht an einen langen
  passiven Hub.

### 2.2 digiCamControl allein testen

Kamera einschalten, digiCamControl starten. Die 600D muss in der Geräteliste
erscheinen.

- **Erscheint sie nicht:** Kamera aus und wieder an, anderes USB-Kabel,
  anderer Port. Prüfen, dass Canons „EOS Utility" *nicht* mitläuft — die beiden
  streiten sich um die Kamera.

In digiCamControl unter *Einstellungen → Webserver* den Webserver einschalten,
Port **5513**, danach das Programm einmal neu starten.

### 2.3 Live-View und Auslösen prüfen

Bei laufendem digiCamControl im Browser aufrufen:

```
http://localhost:5513/?CMD=LiveViewWnd_Show
http://localhost:5513/liveview.jpg
```

Die zweite Adresse muss ein Bild zeigen. Dann:

```
http://localhost:5513/?CMD=Capture
```

Die Kamera muss auslösen.

- **Live-View kommt nicht:** In digiCamControl von Hand das Live-View-Fenster
  öffnen. Geht es dort auch nicht, liegt es an Kamera oder Kabel, nicht an
  unserer Software.
- **`liveview.jpg` liefert nichts:** Webserver wirklich eingeschaltet? Programm
  nach dem Einschalten neu gestartet?

### 2.4 Zusammenspiel mit der Fotobox

Fotobox-Server starten, Verwaltung öffnen, unter **Gerät** nachsehen: Die
Kamera muss als *bereit* gemeldet sein.

---

## Teil 3 — Der Drucker

### 3.1 Treiber einstellen

Im Windows-Treiber des DS-RX1HS einmalig setzen:

- **randlos**
- **Papierformat 10 × 15** (das ist 4 × 6 Zoll)
- **ICC-Farbprofil von DNP.** Ohne Profil treffen Thermosublimationsdrucker
  Hauttöne und Rot spürbar daneben. Das ist der billigste Qualitätsgewinn im
  ganzen Aufbau.

Den Streifenmodus brauchst du nicht — die Software druckt volle Blätter.

### 3.2 Trocken testen

In der Verwaltung unter **Gerät → Drucker** den Windows-Druckernamen und den
SumatraPDF-Pfad eintragen. Dann zuerst auf **„Microsoft Print to PDF"**
drucken lassen: So siehst du, ob der Weg funktioniert, ohne Papier zu
verbrauchen.

### 3.3 Kalibrieren

Jetzt der einzige Ausdruck, der wirklich nötig ist:

1. *Gerät → Drucker → Kalibrier-Testbild drucken.*
2. Am Ausdruck an allen vier Rändern ablesen, wie viele Millimeter fehlen
   oder überstehen. Der rote Rahmen ist die Sollkante.
3. Die Werte unter **Druckkalibrierung** eintragen: Versatz in Millimetern,
   Skalierung in Prozent.
4. Zur Gegenprobe noch einmal drucken — jetzt muss die Sollkante rundum
   gleichmäßig sitzen.

Ein absichtlich gesetzter Versatz von 1,0 mm muss sich auf dem Ausdruck als
genau 1 mm zeigen. Tut er das nicht, skaliert irgendwo doch der Treiber.

---

## Teil 4 — Die erste Veranstaltung

1. **Besitzer-PIN vergeben** unter *Gerät*. Ohne sie startet keine
   Veranstaltung, und eine ausgelieferte Standard-PIN gibt es bewusst nicht.
2. **Veranstaltung anlegen** unter *Veranstaltungen*.
3. **Vorlagen freigeben.** Fünf Standardvorlagen sind dabei; eigene baust du im
   Vorlagen-Editor. Aus Canva: als PNG exportieren, im Editor über
   „Bild aus Datei" einfügen, Foto-Ebenen darüber setzen.
4. **Layout-Testdruck** aus dem Editor: Prüft die Proportionen mit Platzhaltern
   statt echter Fotos.
5. **Zeiten prüfen** unter *Ablauf, Zeiten & Töne*. Die Vorgaben sind ein guter
   Startpunkt; nach dem ersten Event weißt du, was du ändern willst.
6. **Betreuer-PIN setzen** — die bekommt der Gastgeber.
7. **Unterlagen erzeugen**: Die Kurzanleitung kommt in die Box, der QR-Aushang
   außen dran.
8. **Startbereit-Check** laufen lassen. Erst wenn alles grün ist, auf *aktiv*
   schalten.

### Probelauf statt Blindflug

Schalte vor Ort den **Probelauf** ein und mache drei bis vier komplette
Durchgänge. Diese Sitzungen zählen weder in den Auslagenersatz noch in die
Galerie und landen in `_probelauf/`. So testest du Licht, Layout und Druck in
Ruhe, ohne die Zahlen zu verfälschen. Danach Probelauf aus — und los.

---

## Teil 5 — Der Störungstest

Bitte **einmal vor dem ersten echten Einsatz** durchspielen. Es ist der
wichtigste Test überhaupt, weil die Box meistens ohne dich beim Kunden steht.

Jeweils mitten in einer laufenden Sitzung:

| Was du tust | Was passieren muss |
|---|---|
| Kamera-USB abziehen | Freundlicher Hinweis, keine Fehlermeldung. Nach dem Einstecken geht es weiter. |
| Drucker ausschalten | „Dein Foto ist gespeichert…", der Auftrag bleibt in der Warteschlange. |
| Druckerklappe öffnen | Wie oben, mit passendem Text. |
| Server-Fenster schließen | Startet selbst neu, Event und Zähler unversehrt. |
| Stromstecker ziehen | Nach dem Einschalten fährt die Box in den Kiosk zurück. |

Damit der letzte Punkt funktioniert, im BIOS **„nach Stromrückkehr
einschalten"** aktivieren.

Nach dem Wiedereinschalten des Druckers im Servicemenü **„Papier gewechselt —
weiter drucken"** wählen. Die wartenden Aufträge laufen dann durch.

---

## Wenn etwas nicht geht

| Beobachtung | Wahrscheinliche Ursache |
|---|---|
| Oberfläche winzig oder riesig | Windows-Anzeigeskalierung steht nicht auf 100 % |
| Kamera „meldet sich nicht" | digiCamControl läuft nicht, oder EOS Utility hat die Kamera belegt |
| Live-View schwarz | Live-View in digiCamControl nicht gestartet, oder Objektivdeckel drauf |
| Druck kommt nicht | SumatraPDF-Pfad fehlt, oder der Druckername stimmt nicht |
| Ausdruck beschnitten | Kalibrierung fehlt, oder der Treiber skaliert trotz `noscale` |
| Galerie am Handy nicht erreichbar | Galerie im Event nicht eingeschaltet, oder Handy hängt in einem anderen WLAN |
| Weiße Seite im Browser | Oberfläche nicht gebaut — `npm run build` nachholen |

Bei Störungen hilft der Bildschirm **„Was ist los?"**: über das Schloss oben
rechts erreichbar, ohne PIN. Er zeigt im Klartext, was die Box gerade meldet.
