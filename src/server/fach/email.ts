import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { holeDb, jetzt } from '../db/index.js';
import { leseGeraet } from '../db/geraet.js';
import type { Veranstaltung } from '../../shared/typen.js';

/**
 * E-Mail-Versand.
 *
 * Der Knopf erscheint nur, wenn die Box tatsaechlich online ist - es gibt
 * bewusst keine Warteschlange fuer spaeter. Steht die Box im Insel-Netz des
 * Reise-Routers, ist E-Mail schlicht kein Thema.
 *
 * Ein offenes Mailformular in einem fremden WLAN ist ein klassisches
 * Missbrauchsziel. Deshalb: strenge Formatpruefung, Laengenbegrenzung, ein
 * Zaehler je Geraet und ein Tageslimit je Veranstaltung. Versendet wird immer
 * nur das Foto der gerade abgeschlossenen Sitzung, nie ein frei waehlbares Bild.
 */

export interface Mailzugang {
  host: string;
  port: number;
  benutzer: string;
  passwort: string;
  absender: string;
}

const EMAIL_MUSTER = /^[^\s@]{1,64}@[^\s@.]{1,63}(\.[^\s@.]{1,63})+$/;
const TAGESLIMIT = 200;

const zaehlerJeGeraet = new Map<string, { anzahl: number; fenster: number }>();

export function pruefeAdresse(adresse: string): boolean {
  return adresse.length <= 254 && EMAIL_MUSTER.test(adresse);
}

/** Fuenf Adressen je Minute und Geraet. */
export function drosselGreift(kennung: string): boolean {
  const jetztMs = Date.now();
  const eintrag = zaehlerJeGeraet.get(kennung);
  if (!eintrag || jetztMs - eintrag.fenster > 60_000) {
    zaehlerJeGeraet.set(kennung, { anzahl: 1, fenster: jetztMs });
    return false;
  }
  eintrag.anzahl += 1;
  return eintrag.anzahl > 5;
}

export function tageslimitErreicht(eventId: string): boolean {
  const seit = new Date(Date.now() - 24 * 3600_000).toISOString();
  const zeile = holeDb()
    .prepare("SELECT COUNT(*) AS n FROM versand WHERE event_id = ? AND kanal = 'email' AND id > '' AND gesendet_am > ?")
    .get(eventId, seit) as { n: number };
  return zeile.n >= TAGESLIMIT;
}

/**
 * Ist ueberhaupt Internet da? Ohne echte Verbindung bleibt der Knopf weg.
 *
 * Das Ergebnis wird 30 Sekunden gepuffert: Der Startbildschirm fragt seinen
 * Zustand im Sekundentakt ab, und ein Netzwerktest je Aufruf wuerde ihn
 * ausbremsen. Die laufende Pruefung wird geteilt, damit nicht mehrere
 * gleichzeitig losziehen.
 */
let onlineStand: { wert: boolean; bis: number } | null = null;
let onlineLaeuft: Promise<boolean> | null = null;

export async function istOnline(): Promise<boolean> {
  if (onlineStand && Date.now() < onlineStand.bis) return onlineStand.wert;
  onlineLaeuft ??= pruefeVerbindung().finally(() => {
    onlineLaeuft = null;
  });
  return onlineLaeuft;
}

async function pruefeVerbindung(): Promise<boolean> {
  let wert = false;
  try {
    const antwort = await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
    });
    wert = antwort.status < 500;
  } catch {
    wert = false;
  }
  onlineStand = { wert, bis: Date.now() + 30_000 };
  return wert;
}

export async function versende(
  event: Veranstaltung,
  adresse: string,
  layoutPfad: string,
  ausgabeId: string,
  zugang: Mailzugang,
): Promise<void> {
  const versandId = randomUUID();
  holeDb()
    .prepare(
      `INSERT INTO versand (id, event_id, ausgabe_id, kanal, ziel, einwilligung_am, status)
       VALUES (?, ?, ?, 'email', ?, ?, 'wartend')`,
    )
    .run(versandId, event.id, ausgabeId, adresse, jetzt());

  const transport = nodemailer.createTransport({
    host: zugang.host,
    port: zugang.port,
    secure: zugang.port === 465,
    auth: { user: zugang.benutzer, pass: zugang.passwort },
  });

  // EXIF entfernen, damit Kamera- und Zeitstempel nicht in Umlauf geraten.
  const anhang = await sharp(layoutPfad).rotate().jpeg({ quality: 92 }).toBuffer();

  try {
    await transport.sendMail({
      from: zugang.absender,
      to: adresse,
      subject: `Dein Foto von ${event.name}`,
      text: `Hallo!\n\nHier ist dein Foto von ${event.name}.\n\nViel Freude damit!`,
      attachments: [{ filename: 'fotobox.jpg', content: anhang }],
    });
    holeDb()
      .prepare("UPDATE versand SET status = 'gesendet', gesendet_am = ? WHERE id = ?")
      .run(jetzt(), versandId);
  } catch (fehler) {
    holeDb().prepare("UPDATE versand SET status = 'fehlgeschlagen' WHERE id = ?").run(versandId);
    throw fehler;
  }
}

/**
 * Erfasste Adressen sind personenbezogene Daten: Loeschung nach der im Event
 * eingestellten Frist.
 */
export function loescheAlteAdressen(event: Veranstaltung): number {
  const tage = event.einstellungen.emailLoeschfristTage;
  if (tage <= 0) return 0;
  const grenze = new Date(Date.now() - tage * 24 * 3600_000).toISOString();
  const ergebnis = holeDb()
    .prepare(
      `UPDATE versand SET ziel = '(geloescht)', geloescht_am = ?
        WHERE event_id = ? AND kanal = 'email' AND geloescht_am IS NULL AND einwilligung_am < ?`,
    )
    .run(jetzt(), event.id, grenze);
  return ergebnis.changes;
}

export function leseMailzugang(): Mailzugang | null {
  const geraet = leseGeraet() as unknown as { mail?: Mailzugang };
  const mail = geraet.mail;
  if (!mail?.host || !mail.absender) return null;
  return mail;
}
