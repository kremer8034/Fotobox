import { holeDb } from './index.js';
import {
  KALIBRIERUNG_VORGABE,
  type Druckkalibrierung,
  type Geraeteeinstellungen,
  type Kameraeinstellungen,
  type MailEinstellungen,
} from '../../shared/typen.js';

/**
 * Geraeteeinstellungen liegen bewusst in einer eigenen Tabelle, nicht im Event:
 * Sie beschreiben die Box, nicht die Feier. Deshalb wandern Druckkalibrierung,
 * Kameraprofil und PIN-Hash auch nicht mit einem Event-Export auf einen anderen
 * Rechner.
 */

const KAMERA_VORGABE: Kameraeinstellungen = { iso: '400', blende: '5.6', verschlusszeit: '1/125' };

export function leseGeraet(): Geraeteeinstellungen {
  const db = holeDb();
  const zeilen = db.prepare('SELECT schluessel, wert FROM geraet').all() as {
    schluessel: string;
    wert: string;
  }[];
  const map = new Map(zeilen.map((z) => [z.schluessel, z.wert]));

  const lies = <T>(schluessel: string, vorgabe: T): T => {
    const roh = map.get(schluessel);
    if (roh === undefined) return vorgabe;
    try {
      return JSON.parse(roh) as T;
    } catch {
      return vorgabe;
    }
  };

  return {
    datenpfad: lies('datenpfad', ''),
    druckerName: lies('druckerName', ''),
    kalibrierung: lies('kalibrierung', KALIBRIERUNG_VORGABE),
    kamera: lies('kamera', KAMERA_VORGABE),
    besitzerPinHash: lies<string | null>('besitzerPinHash', null),
    speicherWarnungGb: lies('speicherWarnungGb', 5),
    digicamcontrolPfad: lies('digicamcontrolPfad', 'C:\\Program Files (x86)\\digiCamControl'),
    sumatraPfad: lies('sumatraPfad', ''),
    mail: lies<MailEinstellungen | null>('mail', null),
  };
}

/*
 * Das Passwort des Mailkontos liegt unter einem eigenen Schluessel und wird
 * nur hier gelesen - nie von leseGeraet(). So kann es nicht versehentlich mit
 * den Geraeteeinstellungen an die Verwaltung im Browser gehen oder in einer
 * Antwort landen.
 *
 * Ehrlich zur Grenze: Es steht unverschluesselt in der Datenbank auf der Box.
 * Die Datenbank geht bei der Uebergabe nicht mit, aber wer den PC in der Hand
 * hat, kommt heran. Deshalb gehoert hier ein App-Passwort eines eigenen
 * Fotobox-Kontos hin, nie das Passwort des privaten Postfachs.
 */
export function leseMailPasswort(): string {
  const zeile = holeDb().prepare("SELECT wert FROM geraet WHERE schluessel = 'mailPasswort'").get() as
    | { wert: string }
    | undefined;
  if (!zeile) return '';
  try {
    return String(JSON.parse(zeile.wert));
  } catch {
    return '';
  }
}

export function schreibeMailPasswort(passwort: string | null): void {
  if (passwort === null) {
    holeDb().prepare("DELETE FROM geraet WHERE schluessel = 'mailPasswort'").run();
    return;
  }
  holeDb()
    .prepare(
      "INSERT INTO geraet (schluessel, wert) VALUES ('mailPasswort', ?) " +
        'ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert',
    )
    .run(JSON.stringify(passwort));
}

export function schreibeGeraet(teil: Partial<Geraeteeinstellungen>): void {
  const db = holeDb();
  const stmt = db.prepare(
    'INSERT INTO geraet (schluessel, wert) VALUES (?, ?) ' +
      'ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert',
  );
  const schreibeAlle = db.transaction((eintraege: [string, unknown][]) => {
    for (const [schluessel, wert] of eintraege) stmt.run(schluessel, JSON.stringify(wert));
  });
  schreibeAlle(Object.entries(teil));
}

/**
 * Begrenzt die Kalibrierwerte auf den erlaubten Bereich. Abweichungen von
 * mehreren Zentimetern sind kein Kalibrierproblem, sondern ein falsches
 * Papierformat im Treiber - dafuer waere ein Schieberegler die falsche Antwort.
 */
export function begrenzeKalibrierung(k: Druckkalibrierung): Druckkalibrierung {
  const klemme = (wert: number, min: number, max: number) =>
    Number.isFinite(wert) ? Math.min(max, Math.max(min, wert)) : 0;
  return {
    versatzXMm: klemme(k.versatzXMm, -5, 5),
    versatzYMm: klemme(k.versatzYMm, -5, 5),
    skalierungXProzent: klemme(k.skalierungXProzent, 95, 105) || 100,
    skalierungYProzent: klemme(k.skalierungYProzent, 95, 105) || 100,
  };
}
