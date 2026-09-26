import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { holeDb, oeffneDb, schliesseDb } from '../db/index.js';
import { leseGeraet, schreibeGeraet, schreibeMailPasswort } from '../db/geraet.js';
import { aktualisiereEvent, erstelleEvent } from '../fach/events.js';
import { wurzelpfade } from '../fach/pfade.js';
import {
  adresseZuOft,
  leseMailzugang,
  listeAdressen,
  loescheAlteAdressen,
  pruefeAdresse,
  schwaerze,
  transportOptionen,
  versende,
  type Mailzugang,
} from '../fach/email.js';
import type { Veranstaltung } from '../../shared/typen.js';

/*
 * Die E-Mail-Funktion verschickt im Namen des Besitzers Fotos an Adressen, die
 * ein Gast eintippt - und speichert dabei personenbezogene Daten. Geprueft
 * wird beides: dass sich damit kein Unfug treiben laesst, und dass die
 * Adressen verschwinden, wie es dem Gast versprochen wurde.
 */

let wurzel: ReturnType<typeof wurzelpfade>;
let event: Veranstaltung;
let layout: string;
const zugang: Mailzugang = {
  host: 'smtp.example.de',
  port: 587,
  benutzer: 'fotobox@example.de',
  passwort: 'geheim',
  absender: 'Fotobox <fotobox@example.de>',
};

/** Ein Transport, der nichts verschickt, sondern festhaelt, was er sollte. */
function testTransport(scheitern?: string) {
  const gesendet: Record<string, unknown>[] = [];
  let optionen: unknown;
  const fabrik = (o: unknown) => {
    optionen = o;
    return {
      sendMail: async (nachricht: Record<string, unknown>) => {
        if (scheitern) throw new Error(scheitern);
        gesendet.push(nachricht);
        return {};
      },
      close: () => undefined,
    } as never;
  };
  return { fabrik, gesendet, optionen: () => optionen };
}

beforeAll(async () => {
  const datenpfad = mkdtempSync(join(tmpdir(), 'fotobox-email-'));
  wurzel = wurzelpfade(datenpfad);
  oeffneDb(wurzel.db);
  // Die Versandzeilen verweisen auf Fotos; hier geht es um den Versand selbst,
  // nicht um Sitzungen - deshalb ohne Fremdschluessel-Pruefung.
  holeDb().pragma('foreign_keys = OFF');
  schreibeGeraet({ datenpfad });
  const e0 = erstelleEvent({ name: 'Sommerfest', datum: '2026-07-01' }, wurzel.events);
  event = aktualisiereEvent(e0.id, { einstellungen: { emailAktiv: true, emailLoeschfristTage: 30 } });
  layout = join(datenpfad, 'layout.jpg');
  await sharp({ create: { width: 600, height: 400, channels: 3, background: '#48a' } })
    .withMetadata({ exif: { IFD0: { Make: 'Canon', Model: 'EOS 600D' } } })
    .jpeg()
    .toFile(layout);
});

afterAll(() => schliesseDb());

describe('Adresspruefung', () => {
  it('nimmt gewoehnliche Adressen', () => {
    for (const a of ['anna.mueller@web.de', 'ben_1990@gmail.com', 'c-d+fotos@t-online.de', 'x@sub.firma.co.uk']) {
      expect(pruefeAdresse(a), a).toBe(true);
    }
  });

  it('weist alles ab, woraus ein Mailserver mehrere Empfaenger oder Kopfzeilen machen koennte', () => {
    for (const a of [
      'gast@web.de,postmaster',
      'gast@web.de;chef@firma.de',
      'gast@web.de>',
      '<gast@web.de>',
      'gast@web.de\r\nBcc: alle@firma.de',
      'Anna <anna@web.de>',
      'a b@web.de',
      'anna..b@web.de',
      'anna@web',
      '@web.de',
      'anna@@web.de',
      '"anna"@web.de',
    ]) {
      expect(pruefeAdresse(a), JSON.stringify(a)).toBe(false);
    }
  });
});

describe('Versand', () => {
  it('verlangt Verschluesselung, auch auf Port 587', () => {
    expect(transportOptionen(zugang)).toMatchObject({ secure: false, requireTLS: true });
    expect(transportOptionen({ ...zugang, port: 465 })).toMatchObject({ secure: true });
    expect(transportOptionen(zugang).tls).toMatchObject({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    expect(transportOptionen(zugang).socketTimeout).toBeGreaterThan(0);
  });

  it('schickt genau an die eine Adresse, ohne Kameradaten, und haelt den Wortlaut der Einwilligung fest', async () => {
    const t = testTransport();
    await versende(event, 'anna@web.de', layout, 'a1', zugang, 'Ich möchte mein Foto per E-Mail.', t.fabrik);
    expect(t.gesendet).toHaveLength(1);
    const mail = t.gesendet[0]!;
    expect(mail.to).toEqual({ name: '', address: 'anna@web.de' });
    const anhang = (mail.attachments as { content: Buffer }[])[0]!.content;
    expect((await sharp(anhang).metadata()).exif).toBeUndefined();
    const zeile = holeDb().prepare("SELECT status, einwilligung_text FROM versand WHERE ziel = 'anna@web.de'").get() as {
      status: string;
      einwilligung_text: string;
    };
    expect(zeile).toEqual({ status: 'gesendet', einwilligung_text: 'Ich möchte mein Foto per E-Mail.' });
  });

  it('nennt in Fehlermeldungen keine Adressen', async () => {
    const t = testTransport('550 5.1.1 <ben@web.de>: Recipient address rejected');
    await expect(versende(event, 'ben@web.de', layout, 'a2', zugang, 'x', t.fabrik)).rejects.toThrow(
      '550 5.1.1 <<adresse>>: Recipient address rejected',
    );
    expect(schwaerze('an anna@web.de und ben.b@firma.de')).toBe('an <adresse> und <adresse>');
  });

  it('schickt an dieselbe Adresse hoechstens dreimal am Tag', async () => {
    const t = testTransport();
    for (let i = 0; i < 3; i += 1) {
      expect(adresseZuOft(event.id, 'Clara@Web.de')).toBe(false);
      await versende(event, 'clara@web.de', layout, `c${i}`, zugang, 'x', t.fabrik);
    }
    expect(adresseZuOft(event.id, 'Clara@Web.de')).toBe(true);
  });

  it('entfernt Zeilenumbrueche aus dem Betreff', async () => {
    const t = testTransport();
    const listig = { ...event, name: 'Feier\r\nBcc: alle@firma.de' };
    await versende(listig, 'dora@web.de', layout, 'd1', zugang, 'x', t.fabrik);
    expect(String(t.gesendet[0]!.subject)).not.toMatch(/[\r\n]/);
  });
});

describe('Datenschutz', () => {
  it('loescht Adressen nach der Frist, laesst Zeitpunkt und Wortlaut stehen', () => {
    const alt = new Date(Date.now() - 31 * 24 * 3600_000).toISOString();
    holeDb()
      .prepare(
        `INSERT INTO versand (id, event_id, kanal, ziel, einwilligung_am, einwilligung_text, status)
         VALUES ('alt1', ?, 'email', 'emil@web.de', ?, 'Wortlaut', 'gesendet')`,
      )
      .run(event.id, alt);
    expect(loescheAlteAdressen(event)).toBe(1);
    const liste = listeAdressen(event.id);
    const geloescht = liste.find((a) => a.id === 'alt1')!;
    expect(geloescht.adresse).toBe('(geloescht)');
    expect(geloescht.einwilligungAm).toBe(alt);
    // Die frischen Adressen von heute bleiben bis zum Ablauf der Frist.
    expect(liste.some((a) => a.adresse === 'anna@web.de')).toBe(true);
  });

  it('Frist 0: die Adresse bleibt nicht liegen', async () => {
    const sofort = { ...event, einstellungen: { ...event.einstellungen, emailLoeschfristTage: 0 } };
    await versende(sofort, 'fritz@web.de', layout, 'f1', zugang, 'x', testTransport().fabrik);
    expect(listeAdressen(event.id).some((a) => a.adresse === 'fritz@web.de')).toBe(false);
  });
});

describe('Mailzugang', () => {
  it('gibt das Passwort nie mit den Geraeteeinstellungen heraus', () => {
    schreibeGeraet({ mail: { host: 'smtp.example.de', port: 587, benutzer: 'b', absender: 'a@example.de' } });
    schreibeMailPasswort('streng-geheim');
    expect(JSON.stringify(leseGeraet())).not.toContain('streng-geheim');
    expect(leseMailzugang()?.passwort).toBe('streng-geheim');
    schreibeMailPasswort(null);
    expect(leseMailzugang()).toBeNull();
  });
});
