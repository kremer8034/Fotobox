import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { holeDb, jetzt } from '../db/index.js';
import { leseGeraet, leseMailPasswort } from '../db/geraet.js';
import type { Veranstaltung } from '../../shared/typen.js';
import { pruefeAdresse } from '../../shared/adresse.js';

/**
 * E-Mail-Versand.
 *
 * Der Knopf erscheint nur, wenn die Box tatsaechlich online ist - es gibt
 * bewusst keine Warteschlange fuer spaeter. Steht die Box im Insel-Netz des
 * Reise-Routers, ist E-Mail schlicht kein Thema.
 *
 * Ein Formular, das im Namen des Besitzers Mails an beliebige Adressen
 * verschickt, ist ein Missbrauchsziel. Deshalb:
 *  - nur schlichte Adressen (keine Listen, keine Sonderzeichen),
 *  - fuenf Versuche je Minute, hoechstens drei Mails je Adresse und Tag,
 *    200 je Veranstaltung und Tag,
 *  - nur ein Foto, das gerade eben fertig wurde - nicht jedes aus der Galerie,
 *  - fester Text, der Gast bestimmt nur die Adresse,
 *  - die Verbindung zum Mailserver ist immer verschluesselt.
 *
 * Adressen sind personenbezogene Daten: Sie werden nach der Frist geloescht,
 * die dem Gast im Einwilligungstext genannt wurde, und stehen nie im Protokoll.
 */

export interface Mailzugang {
  host: string;
  port: number;
  benutzer: string;
  passwort: string;
  absender: string;
}

/** Die Adresspruefung liegt in shared/adresse.ts - der Kiosk prueft mit derselben Regel. */
export { pruefeAdresse };

const TAGESLIMIT = 200;
const JE_ADRESSE_UND_TAG = 3;
/** Bis so lange nach dem Fertigwerden darf ein Foto per E-Mail verschickt werden. */
export const FOTO_FRISCH_MS = 15 * 60_000;

const zaehlerJeGeraet = new Map<string, { anzahl: number; fenster: number }>();


/** Fuenf Versuche je Minute und Geraet. */
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
    .prepare("SELECT COUNT(*) AS n FROM versand WHERE event_id = ? AND kanal = 'email' AND einwilligung_am > ?")
    .get(eventId, seit) as { n: number };
  return zeile.n >= TAGESLIMIT;
}

/**
 * Dieselbe Adresse hoechstens dreimal am Tag. Sonst liesse sich jemand, dessen
 * Adresse man kennt, von der Box aus mit Mails eindecken - im Namen des
 * Besitzers.
 */
export function adresseZuOft(eventId: string, adresse: string): boolean {
  const seit = new Date(Date.now() - 24 * 3600_000).toISOString();
  const zeile = holeDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM versand WHERE event_id = ? AND kanal = 'email' AND lower(ziel) = lower(?) AND einwilligung_am > ?",
    )
    .get(eventId, adresse, seit) as { n: number };
  return zeile.n >= JE_ADRESSE_UND_TAG;
}

/**
 * Adressen aus einem Text entfernen. Fehlermeldungen von Mailservern nennen
 * gern den Empfaenger ("550 <gast@web.de>: unbekannt") - im Protokoll stuende
 * die Adresse dann fuer immer, laengst nach der zugesagten Loeschung.
 */
export function schwaerze(text: string): string {
  return text.replace(/[^\s<>"',;:()]+@[^\s<>"',;:()]+/g, '<adresse>');
}

/**
 * Ist ueberhaupt Internet da? Ohne echte Verbindung bleibt der Knopf weg.
 *
 * Das Ergebnis wird 30 Sekunden gepuffert: Der Startbildschirm fragt seinen
 * Zustand regelmaessig ab, und ein Netzwerktest je Aufruf wuerde ihn
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

type TransportFabrik = (optionen: SMTPTransport.Options) => Transporter;
const echterTransport: TransportFabrik = (optionen) => nodemailer.createTransport(optionen);

/**
 * Die Verbindung zum Mailserver - immer verschluesselt.
 *
 * Port 465 spricht von Anfang an TLS. Auf 587 (und allen anderen) beginnt die
 * Verbindung offen und wechselt per STARTTLS; vorher war dieser Wechsel nur
 * erbeten. Bot der Server ihn nicht an - oder unterdrueckte ihn jemand im
 * Netz der Location -, gingen Benutzername und Passwort im Klartext hinaus.
 * requireTLS bricht in dem Fall ab, statt zu senden.
 *
 * Die Zeitlimits halten den Gast nicht minutenlang vor "Wird verschickt …",
 * wenn der Mailserver haengt.
 */
export function transportOptionen(zugang: Mailzugang): SMTPTransport.Options {
  return {
    host: zugang.host,
    port: zugang.port,
    secure: zugang.port === 465,
    requireTLS: zugang.port !== 465,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    auth: zugang.benutzer ? { user: zugang.benutzer, pass: zugang.passwort } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

export async function versende(
  event: Veranstaltung,
  adresse: string,
  layoutPfad: string,
  ausgabeId: string,
  zugang: Mailzugang,
  einwilligungstext: string,
  fabrik: TransportFabrik = echterTransport,
): Promise<void> {
  const versandId = randomUUID();
  holeDb()
    .prepare(
      `INSERT INTO versand (id, event_id, ausgabe_id, kanal, ziel, einwilligung_am, einwilligung_text, status)
       VALUES (?, ?, ?, 'email', ?, ?, ?, 'wartend')`,
    )
    .run(versandId, event.id, ausgabeId, adresse, jetzt(), einwilligungstext);

  // EXIF entfernen, damit Kamera- und Zeitstempel nicht in Umlauf geraten.
  const anhang = await sharp(layoutPfad).rotate().jpeg({ quality: 92 }).toBuffer();
  const transport = fabrik(transportOptionen(zugang));

  try {
    await transport.sendMail({
      from: zugang.absender,
      // Als Objekt statt als Text: Dann wird die Adresse nicht noch einmal
      // als Empfaengerliste gedeutet.
      to: { name: '', address: adresse },
      subject: `Dein Foto von ${einzeilig(event.name)}`,
      text: `Hallo!\n\nHier ist dein Foto von ${event.name}.\n\nViel Freude damit!`,
      attachments: [{ filename: 'fotobox.jpg', content: anhang, contentType: 'image/jpeg' }],
    });
    holeDb()
      .prepare("UPDATE versand SET status = 'gesendet', gesendet_am = ? WHERE id = ?")
      .run(jetzt(), versandId);
  } catch (fehler) {
    holeDb().prepare("UPDATE versand SET status = 'fehlgeschlagen' WHERE id = ?").run(versandId);
    throw new Error(schwaerze((fehler as Error).message));
  } finally {
    transport.close?.();
    // Frist 0 heisst: nichts aufheben, was nicht mehr gebraucht wird.
    if (event.einstellungen.emailLoeschfristTage <= 0) loescheAdresse(versandId);
  }
}

export async function sendeTestmail(
  an: string,
  zugang: Mailzugang,
  fabrik: TransportFabrik = echterTransport,
): Promise<void> {
  const transport = fabrik(transportOptionen(zugang));
  try {
    await transport.sendMail({
      from: zugang.absender,
      to: { name: '', address: an },
      subject: 'Testmail der Fotobox',
      text: 'Der E-Mail-Versand der Fotobox funktioniert. Die Verbindung war verschlüsselt.',
    });
  } finally {
    transport.close?.();
  }
}

/**
 * Der Einwilligungstext, wie ihn der Gast liest - an genau einer Stelle
 * gebildet, damit der gespeicherte Nachweis Wort fuer Wort dem Angezeigten
 * entspricht.
 */
export function einwilligungstextFuer(event: Veranstaltung): string {
  return event.einstellungen.einwilligungstext.replace(
    /\{loeschfrist\}/g,
    String(event.einstellungen.emailLoeschfristTage),
  );
}

/** Zeilenumbrueche haben in einer Betreffzeile nichts verloren. */
function einzeilig(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

// ------------------------------------------------------------------ Loeschen

/**
 * Adressen einer Veranstaltung nach der eingestellten Frist loeschen.
 *
 * Gerechnet ab der Einwilligung, die auf der Feier gegeben wurde - damit ist
 * die Zusage "spaetestens X Tage nach der Feier" immer eingehalten. Stehen
 * bleiben Zeitpunkt und Wortlaut der Einwilligung, ohne Adresse.
 */
export function loescheAlteAdressen(event: Veranstaltung): number {
  const tage = Math.max(0, event.einstellungen.emailLoeschfristTage);
  const grenze = new Date(Date.now() - tage * 24 * 3600_000).toISOString();
  return holeDb()
    .prepare(
      `UPDATE versand SET ziel = '(geloescht)', geloescht_am = ?
        WHERE event_id = ? AND kanal = 'email' AND geloescht_am IS NULL
          AND status != 'wartend' AND einwilligung_am <= ?`,
    )
    .run(jetzt(), event.id, grenze).changes;
}

/** Laeuft beim Start und stuendlich - die Loeschung darf nicht davon abhaengen,
 *  dass jemand in der Verwaltung auf einen Knopf drueckt. */
export function raeumeAlleAdressenAuf(alle: Veranstaltung[]): number {
  return alle.reduce((summe, event) => summe + loescheAlteAdressen(event), 0);
}

export function loescheAdresse(versandId: string): boolean {
  return (
    holeDb()
      .prepare(
        "UPDATE versand SET ziel = '(geloescht)', geloescht_am = ? WHERE id = ? AND geloescht_am IS NULL",
      )
      .run(jetzt(), versandId).changes > 0
  );
}

export function loescheAlleAdressen(eventId: string): number {
  return holeDb()
    .prepare(
      "UPDATE versand SET ziel = '(geloescht)', geloescht_am = ? WHERE event_id = ? AND kanal = 'email' AND geloescht_am IS NULL",
    )
    .run(jetzt(), eventId).changes;
}

export interface Adresseintrag {
  id: string;
  adresse: string;
  status: string;
  einwilligungAm: string | null;
  geloeschtAm: string | null;
}

/** Fuer die Verwaltung: Wer hat welche Adresse hinterlassen - und wann wird sie geloescht? */
export function listeAdressen(eventId: string): Adresseintrag[] {
  const zeilen = holeDb()
    .prepare(
      `SELECT id, ziel, status, einwilligung_am, geloescht_am FROM versand
        WHERE event_id = ? AND kanal = 'email' ORDER BY einwilligung_am DESC`,
    )
    .all(eventId) as { id: string; ziel: string; status: string; einwilligung_am: string | null; geloescht_am: string | null }[];
  return zeilen.map((z) => ({
    id: z.id,
    adresse: z.ziel,
    status: z.status,
    einwilligungAm: z.einwilligung_am,
    geloeschtAm: z.geloescht_am,
  }));
}

export function leseMailzugang(): Mailzugang | null {
  const mail = leseGeraet().mail;
  const passwort = leseMailPasswort();
  if (!mail?.host || !mail.absender || (mail.benutzer && !passwort)) return null;
  return { ...mail, passwort };
}
