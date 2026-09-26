import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { findeEventNachGalerieToken, findeEventNachStatusToken } from '../fach/events.js';
import { galerieEintraege, holeAusgabe } from '../fach/sitzungen.js';
import { berechneAuslagen } from '../fach/auslagen.js';
import { eventpfade } from '../fach/pfade.js';
import { abgeleitet, FASSUNGEN } from '../bild/abgeleitet.js';
import type { Betrieb } from '../betrieb.js';
import type { Veranstaltung } from '../../shared/typen.js';

/**
 * Oeffentliche Routen: Galerie und Statusseite.
 *
 * Diese und nur diese Routen sind ueber das LAN erreichbar. Kiosk und Admin
 * laufen auf einer getrennten Instanz, die ausschliesslich auf 127.0.0.1
 * lauscht - ein Gast im WLAN kann die Admin-Adresse also nicht einmal
 * aufrufen, egal was er eintippt.
 *
 * Kein Dateipfad kommt je aus der URL: Bilder werden ueber Ausgabe-IDs aus der
 * Datenbank angefordert, den Pfad setzt der Server selbst zusammen und prueft,
 * dass er im Ordner des freigegebenen Events liegt. Damit ist "../.." nicht
 * weggefiltert, sondern strukturell ausgeschlossen.
 *
 * Ein Token gilt nur, solange seine Veranstaltung laeuft (aktiv oder
 * pausiert). Vorher galt es fuer immer: Der Reise-Router ist bei jeder Feier
 * derselbe, mit demselben WLAN-Passwort - wer den Link der Hochzeit vom
 * letzten Wochenende aufhob oder weitergeleitet bekam, sah deren Bilder auf
 * dem naechsten Geburtstag wieder.
 */
const LAUFEND = new Set(['aktiv', 'pausiert']);

function galerieEvent(token: string): Veranstaltung | null {
  const event = findeEventNachGalerieToken(token);
  return event && event.einstellungen.galerieAktiv && LAUFEND.has(event.status) ? event : null;
}

/**
 * Das Layout zu einer Bild-ID - nur, wenn es zu dieser Veranstaltung gehoert,
 * kein Probelauf ist, nicht aus der Galerie genommen wurde und dort liegt, wo
 * Layouts hingehoeren. Frueher prueften Grossansicht und Download das
 * unterschiedlich gruendlich; der Download lieferte so auch Probelauf-Bilder.
 */
function freigegebenesLayout(event: Veranstaltung, ausgabeId: string): { id: string; pfad: string } | null {
  const ausgabe = holeAusgabe(ausgabeId);
  if (!ausgabe || ausgabe.eventId !== event.id || ausgabe.istTest || ausgabe.verborgen) return null;
  const layoutsOrdner = eventpfade(event.ordner).layouts;
  if (!ausgabe.pfadLayout.startsWith(layoutsOrdner + sep)) return null;
  return { id: ausgabe.id, pfad: ausgabe.pfadLayout };
}

export function registriereOeffentlich(app: FastifyInstance, betrieb: Betrieb): void {
  app.get<{ Params: { token: string } }>('/api/galerie/:token', async (anfrage, antwort) => {
    const event = galerieEvent(anfrage.params.token);
    if (!event) {
      return antwort.code(404).send({ fehler: 'Galerie nicht verfuegbar.' });
    }
    const eintraege = galerieEintraege(event.id);
    return {
      veranstaltung: event.name,
      datum: event.datum,
      bilder: eintraege.map((e) => ({ id: e.ausgabeId, erstellt: e.erstellt })),
    };
  });

  // Bilder der Galerie. EXIF wird entfernt, damit Kamera- und
  // Zeitstempel-Informationen nicht in Umlauf geraten.
  app.get<{ Params: { token: string; id: string }; Querystring: { gross?: string } }>(
    '/medien/galerie/:token/:id.jpg',
    async (anfrage, antwort) => {
      const event = galerieEvent(anfrage.params.token);
      if (!event) return antwort.code(404).send();
      const layout = freigegebenesLayout(event, anfrage.params.id);
      if (!layout) return antwort.code(404).send();

      const pfad = await abgeleitet(
        layout.pfad,
        eventpfade(event.ordner).cache,
        layout.id,
        anfrage.query.gross === '1' ? FASSUNGEN.handyVoll : FASSUNGEN.handyKlein,
      );
      return antwort
        .header('Content-Type', 'image/jpeg')
        .header('Cache-Control', 'private, max-age=86400, immutable')
        .send(createReadStream(pfad));
    },
  );

  // Download aufs Handy. Der Gast kann das Bild anschliessend ueber die
  // Systemfunktionen weitergeben - WhatsApp und Co. brauchen wir nicht selbst.
  app.get<{ Params: { token: string; id: string } }>(
    '/medien/download/:token/:id.jpg',
    async (anfrage, antwort) => {
      const event = galerieEvent(anfrage.params.token);
      if (!event) return antwort.code(404).send();
      const layout = freigegebenesLayout(event, anfrage.params.id);
      if (!layout) return antwort.code(404).send();

      // Dieselbe bereinigte Fassung wie die Grossansicht - einmal gerechnet.
      const pfad = await abgeleitet(
        layout.pfad,
        eventpfade(event.ordner).cache,
        layout.id,
        FASSUNGEN.handyVoll,
      );
      const name = `${event.name.replace(/[^\w-]+/g, '_')}_${layout.id.slice(0, 8)}.jpg`;
      return antwort
        .header('Content-Type', 'image/jpeg')
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .send(createReadStream(pfad));
    },
  );

  /**
   * Schreibgeschuetzte Statusseite fuer das Handy des Gastgebers. Nur lesen,
   * keine Aktionen - damit er die Box im Blick hat, ohne etwas verstellen zu
   * koennen.
   */
  app.get<{ Params: { token: string } }>('/api/status/:token', async (anfrage, antwort) => {
    const event = findeEventNachStatusToken(anfrage.params.token);
    if (!event || !LAUFEND.has(event.status)) return antwort.code(404).send({ fehler: 'Unbekannt.' });

    const status = await betrieb.status();
    const auslagen = berechneAuslagen(event);
    return {
      veranstaltung: event.name,
      zustand: {
        kamera: status.kamera,
        drucker: status.drucker,
        stoerung: status.stoerung,
        warteschlangeOffen: status.warteschlangeOffen,
        speicherFreiGb: status.speicherFreiGb,
      },
      zahlen: {
        sitzungen: auslagen.sitzungen,
        drucke: auslagen.druckeGesamt,
        materialRest: auslagen.materialRest,
      },
    };
  });
}

/** Datei sicher ausliefern, nachdem der Pfad serverseitig geprueft wurde. */
export async function sendeDatei(pfad: string) {
  await stat(pfad);
  return createReadStream(pfad);
}
