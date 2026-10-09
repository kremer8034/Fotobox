import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { holeDb, jetzt } from '../db/index.js';
import { legeEventordnerAn, eventpfade, ordnernameFuer } from './pfade.js';
import { neuesToken } from './pin.js';
import {
  EINSTELLUNGEN_VORGABE,
  UEBERGAENGE,
  type EventEinstellungen,
  type EventStatus,
  type Veranstaltung,
  FILTER_OHNE,
  STATUS_NAME,
} from '../../shared/typen.js';

/**
 * Veranstaltungen und ihr Lebenszyklus.
 *
 *   Entwurf -> Startbereit -> Aktiv -> Abgeschlossen -> Archiviert
 *
 * Es darf immer nur genau ein Event aktiv sein. Das verhindert den Klassiker,
 * dass Fotos im Ordner der letzten Hochzeit landen; erzwungen wird es zusaetzlich
 * durch einen partiellen Unique-Index in der Datenbank.
 */

interface EventZeile {
  id: string;
  name: string;
  datum: string;
  ordner: string;
  status: string;
  galerie_token: string;
  status_token: string;
  betreuer_pin_hash: string | null;
  material_verbraucht: number;
  probelauf: number;
  erstellt: string;
  geschlossen_am: string | null;
  einstellungen: string;
}

function zuVeranstaltung(zeile: EventZeile): Veranstaltung {
  return {
    id: zeile.id,
    name: zeile.name,
    datum: zeile.datum,
    ordner: zeile.ordner,
    status: zeile.status as EventStatus,
    galerieToken: zeile.galerie_token,
    statusToken: zeile.status_token,
    betreuerPinHash: zeile.betreuer_pin_hash,
    materialVerbraucht: zeile.material_verbraucht,
    probelauf: zeile.probelauf === 1,
    erstellt: zeile.erstellt,
    geschlossenAm: zeile.geschlossen_am,
    einstellungen: {
      ...EINSTELLUNGEN_VORGABE,
      ...(JSON.parse(zeile.einstellungen) as Partial<EventEinstellungen>),
    },
  };
}

export function listeEvents(): Veranstaltung[] {
  const zeilen = holeDb()
    .prepare('SELECT * FROM events ORDER BY datum DESC, erstellt DESC')
    .all() as EventZeile[];
  return zeilen.map(zuVeranstaltung);
}

export function holeEvent(id: string): Veranstaltung | null {
  const zeile = holeDb().prepare('SELECT * FROM events WHERE id = ?').get(id) as
    | EventZeile
    | undefined;
  return zeile ? zuVeranstaltung(zeile) : null;
}

/** Das eine aktive Event, mit dem die Box gerade arbeitet. */
export function holeAktivesEvent(): Veranstaltung | null {
  const zeile = holeDb()
    .prepare("SELECT * FROM events WHERE status = 'aktiv' LIMIT 1")
    .get() as EventZeile | undefined;
  return zeile ? zuVeranstaltung(zeile) : null;
}

export function erstelleEvent(
  eingabe: { name: string; datum: string; einstellungen?: Partial<EventEinstellungen> },
  eventsWurzel: string,
): Veranstaltung {
  const id = randomUUID();
  // Gleicher Name am gleichen Tag ergab vorher denselben Ordner - die Fotos
  // zweier Veranstaltungen lagen dann gemischt, und das Loeschen der einen
  // nahm den Ordner der anderen mit. Jetzt bekommt jede ihren eigenen.
  const basis = join(eventsWurzel, ordnernameFuer(eingabe.datum, eingabe.name));
  let ordner = basis;
  for (let n = 2; existsSync(ordner); n += 1) ordner = `${basis}_${n}`;
  legeEventordnerAn(ordner);

  const einstellungen: EventEinstellungen = {
    ...EINSTELLUNGEN_VORGABE,
    ...eingabe.einstellungen,
  };

  holeDb()
    .prepare(
      `INSERT INTO events
        (id, name, datum, ordner, status, galerie_token, status_token, betreuer_pin_hash,
         material_verbraucht, probelauf, erstellt, geschlossen_am, einstellungen)
       VALUES (?, ?, ?, ?, 'entwurf', ?, ?, NULL, 0, 0, ?, NULL, ?)`,
    )
    .run(
      id,
      eingabe.name,
      eingabe.datum,
      ordner,
      neuesToken(),
      neuesToken(),
      jetzt(),
      JSON.stringify(einstellungen),
    );

  const event = holeEvent(id)!;
  schreibeEventJson(event);
  return event;
}

/**
 * Eine Veranstaltung mit allen Einstellungen der Vorlage-Veranstaltung anlegen
 * - fuer die naechste Buchung desselben Gastgebers oder dieselbe Art Feier.
 * Uebernommen werden nur die Einstellungen: keine Fotos, keine Zahlen, keine
 * Galerie-Links (neue Tokens) und keine Betreuer-PIN - der naechste Gastgeber
 * bekommt seine eigene.
 */
export function dupliziereEvent(
  quelleId: string,
  eingabe: { name: string; datum: string },
  eventsWurzel: string,
  uebernimm: (e: EventEinstellungen) => EventEinstellungen = (e) => e,
): Veranstaltung {
  const quelle = holeEvent(quelleId);
  if (!quelle) throw new Error('Veranstaltung nicht gefunden.');
  return erstelleEvent({ ...eingabe, einstellungen: uebernimm(quelle.einstellungen) }, eventsWurzel);
}

export function aktualisiereEvent(
  id: string,
  aenderung: {
    name?: string;
    datum?: string;
    einstellungen?: Partial<EventEinstellungen>;
    betreuerPinHash?: string | null;
  },
): Veranstaltung {
  const vorher = holeEvent(id);
  if (!vorher) throw new Error('Veranstaltung nicht gefunden.');

  const einstellungen: EventEinstellungen = {
    ...vorher.einstellungen,
    ...aenderung.einstellungen,
    zeiten: { ...vorher.einstellungen.zeiten, ...aenderung.einstellungen?.zeiten },
    toene: { ...vorher.einstellungen.toene, ...aenderung.einstellungen?.toene },
  };
  // Vorausgewaehlt kann nicht mehr sein als erlaubt - sonst startete die
  // Mengenwahl im Kiosk ueber der Obergrenze.
  einstellungen.kopienVorgabe = Math.min(einstellungen.kopienVorgabe, einstellungen.kopienMax);
  // "Ohne Filter" ist immer die erste Kachel.
  if (!einstellungen.filter.includes(FILTER_OHNE)) einstellungen.filter = [FILTER_OHNE, ...einstellungen.filter];

  holeDb()
    .prepare(
      `UPDATE events SET name = ?, datum = ?, einstellungen = ?,
        betreuer_pin_hash = ? WHERE id = ?`,
    )
    .run(
      aenderung.name ?? vorher.name,
      aenderung.datum ?? vorher.datum,
      JSON.stringify(einstellungen),
      aenderung.betreuerPinHash === undefined ? vorher.betreuerPinHash : aenderung.betreuerPinHash,
      id,
    );

  const nachher = holeEvent(id)!;
  schreibeEventJson(nachher);
  return nachher;
}

export function setzeStatus(id: string, neu: EventStatus): Veranstaltung {
  const event = holeEvent(id);
  if (!event) throw new Error('Veranstaltung nicht gefunden.');
  if (event.status === neu) return event;

  const erlaubt = UEBERGAENGE[event.status] ?? [];
  if (!erlaubt.includes(neu)) {
    throw new Error(`Von „${STATUS_NAME[event.status]}“ geht es nicht direkt nach „${STATUS_NAME[neu]}“.`);
  }

  if (neu === 'aktiv') {
    const anderes = holeAktivesEvent();
    if (anderes && anderes.id !== id) {
      throw new Error(
        `„${anderes.name}“ läuft gerade. Es kann immer nur eine Veranstaltung aktiv sein.`,
      );
    }
  }

  const geschlossen = neu === 'abgeschlossen' ? jetzt() : null;
  holeDb()
    .prepare('UPDATE events SET status = ?, geschlossen_am = COALESCE(?, geschlossen_am) WHERE id = ?')
    .run(neu, geschlossen, id);

  const nachher = holeEvent(id)!;
  schreibeEventJson(nachher);
  return nachher;
}

/** Die Veranstaltung aus der Datenbank - Sitzungen, Fotos, Drucke und Versand gehen per Fremdschluessel mit. */
export function loescheEvent(id: string): void {
  holeDb().prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function setzeProbelauf(id: string, an: boolean): Veranstaltung {
  holeDb().prepare('UPDATE events SET probelauf = ? WHERE id = ?').run(an ? 1 : 0, id);
  return holeEvent(id)!;
}

export function erneuereGalerieToken(id: string): Veranstaltung {
  holeDb().prepare('UPDATE events SET galerie_token = ? WHERE id = ?').run(neuesToken(), id);
  return holeEvent(id)!;
}

/** Ein weitergegebener Status-Link wird so ungueltig - wie beim Galerie-Link. */
export function erneuereStatusToken(id: string): Veranstaltung {
  holeDb().prepare('UPDATE events SET status_token = ? WHERE id = ?').run(neuesToken(), id);
  return holeEvent(id)!;
}

export function findeEventNachGalerieToken(token: string): Veranstaltung | null {
  if (!token) return null;
  const zeile = holeDb().prepare('SELECT * FROM events WHERE galerie_token = ?').get(token) as
    | EventZeile
    | undefined;
  return zeile ? zuVeranstaltung(zeile) : null;
}

export function findeEventNachStatusToken(token: string): Veranstaltung | null {
  if (!token) return null;
  const zeile = holeDb().prepare('SELECT * FROM events WHERE status_token = ?').get(token) as
    | EventZeile
    | undefined;
  return zeile ? zuVeranstaltung(zeile) : null;
}

/**
 * Die Betreuer-PIN lesbar merken - fuer die Kurzanleitung, die sie gross
 * zeigt. Vorher war sie nur als Hash gespeichert, und wer den Zettel spaeter
 * erzeugte, musste sie jedes Mal neu eintippen. Bewusst nur fuer die
 * Betreuer-PIN (die steht ohnehin auf Papier in der Box), nie fuer die
 * Besitzer-PIN. Sie bleibt in der Datenbank: nicht im Veranstaltungs-Objekt,
 * nicht in event.json, nicht bei der Uebergabe.
 */
export function merkeBetreuerPin(id: string, pin: string | null): void {
  holeDb().prepare('UPDATE events SET betreuer_pin = ? WHERE id = ?').run(pin, id);
}

export function leseBetreuerPin(id: string): string | null {
  const zeile = holeDb().prepare('SELECT betreuer_pin FROM events WHERE id = ?').get(id) as
    | { betreuer_pin: string | null }
    | undefined;
  return zeile?.betreuer_pin ?? null;
}

/**
 * Kopie der Konfiguration in den Event-Ordner. Damit bleibt der Ordner auch
 * dann verstaendlich, wenn er nur noch als Datenhaufen beim Gastgeber liegt.
 */
export function schreibeEventJson(event: Veranstaltung): void {
  const pfade = eventpfade(event.ordner);
  const oeffentlich = { ...event, betreuerPinHash: undefined, statusToken: undefined };
  try {
    writeFileSync(pfade.eventJson, JSON.stringify(oeffentlich, null, 2), 'utf8');
  } catch {
    // Ein nicht schreibbarer Ordner darf den Betrieb nicht anhalten.
  }
}
