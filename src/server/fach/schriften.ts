import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Eigene Schriften.
 *
 * Die Auswahlliste in den geteilten Typen deckt ab, was Windows ohnehin
 * mitbringt. Fuer eine Hochzeit will man aber vielleicht genau die eine
 * Schreibschrift, die im Einladungskarten-Design steckt - also kann man
 * Schriftdateien hinzufuegen.
 *
 * Zwei Dinge muessen dafuer zusammenpassen:
 *  - Der Browser braucht die Datei ueber eine Adresse, um sie per @font-face
 *    in der Editor-Vorschau zu zeigen.
 *  - Der Renderer (sharp -> librsvg -> fontconfig) findet Schriften nur in den
 *    Ordnern, die fontconfig kennt. Deshalb schreiben wir eine fonts.conf und
 *    zeigen mit FONTCONFIG_PATH darauf.
 *
 * Beides greift auf denselben Ordner zu, damit Vorschau und Ausdruck dieselbe
 * Schrift benutzen und nicht zwei verschiedene.
 */

export interface Schriftdatei {
  /** Dateiname im Schriftenordner, dient als Kennung. */
  datei: string;
  /** Der Familienname aus der Datei - das, was font-family treffen muss. */
  familie: string;
}

const ERLAUBT = new Set(['.ttf', '.otf']);

export function schriftenOrdner(datenpfad: string): string {
  return join(datenpfad, 'schriften');
}

/**
 * Legt den Schriftenordner an und macht ihn fontconfig bekannt.
 *
 * Muss laufen, bevor sharp das erste Mal Text rendert: fontconfig liest seine
 * Konfiguration einmal beim ersten Zugriff und schaut danach nicht mehr hin.
 */
export function richteSchriftenEin(datenpfad: string): string {
  const ordner = schriftenOrdner(datenpfad);
  mkdirSync(ordner, { recursive: true });

  const konf = join(ordner, 'fonts.conf');
  writeFileSync(
    konf,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${ordner}</dir>
  <!-- Die Schriften des Systems weiter mitbenutzen, sonst faende der Renderer
       ploetzlich kein Arial mehr. -->
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <cachedir>${join(ordner, '.cache')}</cachedir>
</fontconfig>
`,
    'utf8',
  );

  // fontconfig sucht in diesem Verzeichnis nach "fonts.conf".
  process.env.FONTCONFIG_PATH = ordner;
  return ordner;
}

export function listeSchriften(datenpfad: string): Schriftdatei[] {
  const ordner = schriftenOrdner(datenpfad);
  if (!existsSync(ordner)) return [];
  return readdirSync(ordner)
    .filter((d) => ERLAUBT.has(extname(d).toLowerCase()))
    .map((datei) => ({ datei, familie: familieAus(join(ordner, datei)) ?? datei }))
    .sort((a, b) => a.familie.localeCompare(b.familie, 'de'));
}

/**
 * Den Familiennamen aus der Schriftdatei lesen.
 *
 * Der Dateiname taugt dafuer nicht: "GreatVibes-Regular.ttf" heisst innen
 * "Great Vibes", und genau diesen Namen muss font-family treffen. Gelesen wird
 * die name-Tabelle des sfnt-Formats, Eintrag 1 (Familie). Das sind ein paar
 * Zeilen Pufferarbeit und spart eine weitere Abhaengigkeit.
 */
export function familieAus(pfad: string): string | null {
  try {
    const puffer = readFileSync(pfad);
    const tabellen = puffer.readUInt16BE(4);
    let nameAnfang = 0;

    for (let i = 0; i < tabellen; i += 1) {
      const eintrag = 12 + i * 16;
      if (puffer.toString('ascii', eintrag, eintrag + 4) === 'name') {
        nameAnfang = puffer.readUInt32BE(eintrag + 8);
        break;
      }
    }
    if (!nameAnfang) return null;

    const anzahl = puffer.readUInt16BE(nameAnfang + 2);
    const textAnfang = nameAnfang + puffer.readUInt16BE(nameAnfang + 4);
    let ersatz: string | null = null;

    for (let i = 0; i < anzahl; i += 1) {
      const satz = nameAnfang + 6 + i * 12;
      const plattform = puffer.readUInt16BE(satz);
      const kennung = puffer.readUInt16BE(satz + 6);
      if (kennung !== 1) continue; // 1 = Familienname

      const laenge = puffer.readUInt16BE(satz + 8);
      const versatz = puffer.readUInt16BE(satz + 10);
      const roh = puffer.subarray(textAnfang + versatz, textAnfang + versatz + laenge);

      // Plattform 3 (Windows) speichert UTF-16BE, Plattform 1 (Mac) ASCII.
      if (plattform === 3) return utf16be(roh);
      if (!ersatz) ersatz = roh.toString('latin1');
    }
    return ersatz;
  } catch {
    // Eine kaputte oder unbekannte Datei darf den Start nicht aufhalten.
    return null;
  }
}

function utf16be(roh: Buffer): string {
  let text = '';
  for (let i = 0; i + 1 < roh.length; i += 2) {
    text += String.fromCharCode(roh.readUInt16BE(i));
  }
  return text;
}
