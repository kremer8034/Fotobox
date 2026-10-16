import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Warum hat die Kamera nicht ausgeloest? - aus digiCamControls eigenem Protokoll.
 *
 * "?CMD=Capture" antwortet sofort mit "OK", ganz gleich, ob die Kamera danach
 * ausloest. Lehnt die 600D ab - Autofokus findet nichts, Speicherkarte voll
 * oder fehlt, Kamera beschaeftigt -, erfuhr die Box davon nichts: Sie wartete
 * 15 Sekunden auf eine Datei, die nie kam, und meldete "keine Datei". Das
 * Live-Bild lief dabei ungestoert weiter, und nach drei Versuchen stand die
 * Gruppe wieder am Startbildschirm, ohne dass irgendwer den Grund kannte.
 *
 * digiCamControl schreibt solche Fehler aber in seine Protokolldatei. Die wird
 * nach einem Fehlschuss gelesen; was dort seit dem Ausloesen steht, kommt ins
 * Protokoll der Box - bei bekannten Ursachen mit einem Satz, was zu tun ist.
 */

export interface Kamerafehler {
  /** Was zu tun ist - null, wenn die Ursache nicht bekannt ist. */
  hinweis: string | null;
  /** Die Zeile aus digiCamControls Protokoll, gekuerzt. */
  zeile: string;
}

/*
 * Bekannte Ablehnungen der Kamera. Canons EDSDK meldet sie als Fehlercode;
 * digiCamControl schreibt mal den Namen, mal die Zahl (hexadezimal oder
 * dezimal) - deshalb alle drei Schreibweisen.
 *   0x8D01 TAKE_PICTURE_AF_NG          Autofokus fand nichts
 *   0x8D06 TAKE_PICTURE_NO_CARD_NG     keine Karte
 *   0x8D07 TAKE_PICTURE_CARD_NG        Karte voll oder fehlerhaft
 *   0x8D08 TAKE_PICTURE_CARD_PROTECT_NG Karte schreibgeschuetzt
 *   0x0081 DEVICE_BUSY                 Kamera beschaeftigt
 */
const BEKANNTE: { muster: RegExp; hinweis: string }[] = [
  {
    muster: /AF_NG|8D01|\b36097\b|autofocus|auto focus|focus fail/i,
    hinweis:
      'Der Autofokus fand nichts zum Scharfstellen, deshalb hat die Kamera nicht ausgelöst. ' +
      'Am Objektiv den Schalter auf MF stellen und einmal auf die Stelle scharf stellen, wo die Gäste stehen.',
  },
  {
    muster: /NO_CARD|8D06|\b36102\b|no card|no memory card/i,
    hinweis:
      'Die Kamera löst ohne Speicherkarte nicht aus. Eine SD-Karte einlegen ' +
      '(oder im Kameramenü „Auslöser ohne Karte betätigen“ auf „Aktivieren“ stellen).',
  },
  {
    muster: /CARD_PROTECT|8D08|\b36104\b|write.?protect/i,
    hinweis: 'Die Speicherkarte der Kamera ist schreibgeschützt. Den kleinen Schieber an der Karte nach oben schieben.',
  },
  {
    muster: /CARD_NG|8D07|\b36103\b|card (is )?full|memory card full/i,
    hinweis:
      'Die Speicherkarte der Kamera ist voll oder fehlerhaft, deshalb löst sie nicht aus. ' +
      'Karte in der Kamera formatieren oder eine leere einlegen.',
  },
  {
    muster: /DEVICE_BUSY|\bbusy\b/i,
    hinweis:
      'Die Kamera meldete „beschäftigt“. Hilft das Warten nicht, Kamera aus- und wieder einschalten.',
  },
];

/** Zeilen, die auf einen Fehler hindeuten. */
const FEHLERZEILE = /\b(error|exception|fehler)\b|_NG\b|\bbusy\b/i;

/**
 * Aus den Protokollzeilen seit dem Ausloesen die Ursache herauslesen. Die
 * letzte Fehlerzeile zaehlt; ist ihre Ursache unbekannt, wird trotzdem eine
 * bekannte aus den Zeilen davor genommen.
 */
export function deuteKamerafehler(zeilen: string[]): Kamerafehler | null {
  const fehler = zeilen.filter((z) => FEHLERZEILE.test(z));
  if (fehler.length === 0) return null;
  for (let i = fehler.length - 1; i >= 0; i -= 1) {
    const bekannt = BEKANNTE.find((b) => b.muster.test(fehler[i]!));
    if (bekannt) return { hinweis: bekannt.hinweis, zeile: kuerze(fehler[i]!) };
  }
  return { hinweis: null, zeile: kuerze(fehler[fehler.length - 1]!) };
}

/**
 * Nur Zeilen ab einem Zeitpunkt. log4net schreibt "2026-10-16 19:43:12,345"
 * in Ortszeit an den Zeilenanfang; Zeilen ohne Zeitstempel (Fortsetzungen
 * einer Fehlermeldung) gehoeren zur Zeile davor.
 */
export function zeilenSeit(text: string, seitMs: number): string[] {
  const ergebnis: string[] = [];
  let dabei = false;
  for (const zeile of text.split(/\r?\n/)) {
    const zeit = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(zeile);
    if (zeit) {
      const [, j, mo, t, h, mi, s] = zeit.map(Number) as number[];
      // Eine Sekunde Spielraum: Der Zeitstempel hat keine Millisekunden im Vergleich.
      dabei = new Date(j!, mo! - 1, t!, h!, mi!, s!).getTime() >= seitMs - 1000;
    }
    if (dabei && zeile.trim()) ergebnis.push(zeile);
  }
  return ergebnis;
}

function kuerze(zeile: string): string {
  const ohneZeit = zeile.replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[,.]?\d*\s*/, '').trim();
  return ohneZeit.length > 240 ? `${ohneZeit.slice(0, 240)} …` : ohneZeit;
}

/** Wo digiCamControl sein Protokoll ablegt (Standard: C:\ProgramData\digiCamControl\Log\app.log). */
export function protokollKandidaten(umgebung: NodeJS.ProcessEnv = process.env): string[] {
  const orte = [umgebung.ProgramData, umgebung.ALLUSERSPROFILE, umgebung.APPDATA, umgebung.LOCALAPPDATA];
  return [...new Set(orte.filter((o): o is string => !!o))].map((o) => join(o, 'digiCamControl', 'Log', 'app.log'));
}

/** Hoechstens so viel vom Dateiende lesen - die Datei waechst ueber Monate. */
const ENDE_BYTES = 64 * 1024;

/** Liest das Ende des Protokolls und deutet die Zeilen seit dem Ausloesen. */
export async function leseKamerafehler(
  seitMs: number,
  kandidaten: string[] = protokollKandidaten(),
): Promise<Kamerafehler | null> {
  for (const pfad of kandidaten) {
    const info = await stat(pfad).catch(() => null);
    if (!info?.isFile()) continue;
    const datei = await open(pfad, 'r').catch(() => null);
    if (!datei) continue;
    try {
      const laenge = Math.min(ENDE_BYTES, info.size);
      const puffer = Buffer.alloc(laenge);
      await datei.read(puffer, 0, laenge, info.size - laenge);
      return deuteKamerafehler(zeilenSeit(puffer.toString('utf8'), seitMs));
    } catch {
      return null;
    } finally {
      await datei.close().catch(() => undefined);
    }
  }
  return null;
}
