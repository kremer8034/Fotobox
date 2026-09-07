import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { holeDb, jetzt } from '../db/index.js';
import { legeEventordnerAn, eventpfade, ordnernameFuer } from './pfade.js';
import { neuesToken } from './pin.js';
import {
  EINSTELLUNGEN_VORGABE,
  type EventEinstellungen,
  type EventStatus,
  type Veranstaltung,
} from '../../shared/typen.js';

/**
 * Veranstaltungen und ihr Lebenszyklus.
 *
 *   Entwurf -> Startbereit -> Aktiv <-> Pausiert -> Abgeschlossen -> Archiviert
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

/** Das eine aktive oder pausierte Event, mit dem die Box gerade arbeitet. */
export function holeAktivesEvent(): Veranstaltung | null {
  const zeile = holeDb()
    .prepare("SELECT * FROM events WHERE status IN ('aktiv','pausiert') LIMIT 1")
    .get() as EventZeile | undefined;
  return zeile ? zuVeranstaltung(zeile) : null;
}

export function erstelleEvent(
  eingabe: { name: string; datum: string; einstellungen?: Partial<EventEinstellungen> },
  eventsWurzel: string,
): Veranstaltung {
  const id = randomUUID();
  const ordner = join(eventsWurzel, ordnernameFuer(eingabe.datum, eingabe.name));
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

/** Erlaubte Statuswechsel. Alles andere wird abgewiesen. */
const UEBERGAENGE: Record<EventStatus, EventStatus[]> = {
  entwurf: ['startbereit', 'archiviert'],
  startbereit: ['aktiv', 'entwurf', 'archiviert'],
  aktiv: ['pausiert', 'abgeschlossen'],
  pausiert: ['aktiv', 'abgeschlossen'],
  abgeschlossen: ['archiviert', 'aktiv'],
  archiviert: ['entwurf'],
};

export function setzeStatus(id: string, neu: EventStatus): Veranstaltung {
  const event = holeEvent(id);
  if (!event) throw new Error('Veranstaltung nicht gefunden.');
  if (event.status === neu) return event;

  const erlaubt = UEBERGAENGE[event.status] ?? [];
  if (!erlaubt.includes(neu)) {
    throw new Error(`Wechsel von "${event.status}" nach "${neu}" ist nicht vorgesehen.`);
  }

  if (neu === 'aktiv') {
    const anderes = holeAktivesEvent();
    if (anderes && anderes.id !== id) {
      throw new Error(
        `"${anderes.name}" laeuft gerade. Es kann immer nur eine Veranstaltung aktiv sein.`,
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

export function setzeProbelauf(id: string, an: boolean): Veranstaltung {
  holeDb().prepare('UPDATE events SET probelauf = ? WHERE id = ?').run(an ? 1 : 0, id);
  return holeEvent(id)!;
}

export function erneuereGalerieToken(id: string): Veranstaltung {
  holeDb().prepare('UPDATE events SET galerie_token = ? WHERE id = ?').run(neuesToken(), id);
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

/** Material verbrauchen. Ein Blatt = ein Bild, 700 pro Rolle. */
export function verbucheMaterial(id: string, blaetter: number): void {
  holeDb()
    .prepare('UPDATE events SET material_verbraucht = material_verbraucht + ? WHERE id = ?')
    .run(blaetter, id);
}

export function setzeMaterialZurueck(id: string): void {
  holeDb().prepare('UPDATE events SET material_verbraucht = 0 WHERE id = ?').run(id);
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
