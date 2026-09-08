import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { holeAktivesEvent, holeEvent, verbucheMaterial } from '../fach/events.js';
import { holeVorlage, listeVorlagen } from '../fach/vorlagen.js';
import { listeFilter } from '../fach/filter.js';
import { leseGeraet } from '../db/geraet.js';
import {
  brichSitzungAb,
  galerieEintraege,
  holeAusgabe,
  erstesFoto,
  starteSitzung,
  stelleFertig,
  verbucheFoto,
} from '../fach/sitzungen.js';
import { warteAufNeueDatei, warteAufStabileDatei } from '../fach/aufnahme.js';
import { reiheEin } from '../fach/druckwarteschlange.js';
import { berechneAuslagen } from '../fach/auslagen.js';
import { drosselGreift, istOnline, leseMailzugang, pruefeAdresse, tageslimitErreicht, versende } from '../fach/email.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { pruefePin, PinDrossel } from '../fach/pin.js';
import { filterVorschau, vorlagenVorschau } from '../bild/vorschau.js';
import { anzahlFotos, STOERUNGSTEXTE } from '../../shared/typen.js';
import { protokolliere, type Betrieb } from '../betrieb.js';
import type { Konfig } from '../konfig.js';

/**
 * Kiosk-Routen. Erreichbar ausschliesslich ueber 127.0.0.1 - siehe
 * Sicherheitskonzept.
 */
export function registriereKiosk(app: FastifyInstance, betrieb: Betrieb, konfig: Konfig): void {
  const wurzel = wurzelpfade(konfig.datenpfad);
  const drossel = new PinDrossel();

  /** Startbildschirm: Was darf der Gast, und laeuft ueberhaupt etwas? */
  app.get('/api/kiosk/start', async () => {
    const event = holeAktivesEvent();
    const status = await betrieb.status();
    if (!event) {
      return { bereit: false, status, grund: 'Es ist gerade keine Veranstaltung aktiv.' };
    }

    const freigegeben = event.einstellungen.vorlagen
      .map((id) => holeVorlage(id))
      .filter((v): v is NonNullable<typeof v> => v !== null);

    const alleFilter = listeFilter();
    const filter = event.einstellungen.filter
      .map((id) => alleFilter.find((f) => f.id === id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined);

    return {
      bereit: event.status === 'aktiv',
      pausiert: event.status === 'pausiert',
      status,
      veranstaltung: { id: event.id, name: event.name, probelauf: event.probelauf },
      darstellung: {
        titel: event.einstellungen.startTitel,
        untertitel: event.einstellungen.startUntertitel,
        akzent: event.einstellungen.farbeAkzent,
        qrAufStartseite: event.einstellungen.qrAufStartseite && event.einstellungen.galerieAktiv,
        galerieToken: event.einstellungen.galerieAktiv ? event.galerieToken : null,
      },
      zeiten: event.einstellungen.zeiten,
      toene: event.einstellungen.toene,
      ausgabe: {
        druckAktiv: event.einstellungen.druckAktiv,
        emailAktiv: event.einstellungen.emailAktiv && leseMailzugang() !== null && (await istOnline()),
        kopienVorgabe: event.einstellungen.kopienVorgabe,
        kopienMax: event.einstellungen.kopienMax,
        druckLimitErreicht: druckLimitErreicht(event.id),
      },
      vorlagen: freigegeben.map((v) => ({
        id: v.id,
        name: v.name,
        fotos: anzahlFotos(v),
        canvas: v.canvas,
      })),
      filter: filter.map((f) => ({ id: f.id, name: f.name })),
    };
  });

  /**
   * Vorschaubild einer Vorlage: die Vorlage mit nummerierten Platzhaltern
   * statt echter Fotos. Der Gast sieht damit vor der Wahl, was er bekommt.
   *
   * Angefordert wird ueber die ID, nie ueber einen Pfad - der Server setzt den
   * Ordner selbst zusammen, und ausgeliefert wird nur, was in der laufenden
   * Veranstaltung auch freigegeben ist.
   */
  app.get<{ Params: { id: string } }>(
    '/api/kiosk/vorlage/:id/vorschau.jpg',
    async (anfrage, antwort) => {
      const event = holeAktivesEvent();
      if (!event || !event.einstellungen.vorlagen.includes(anfrage.params.id)) {
        return antwort.code(404).send({ fehler: 'Nicht freigegeben.' });
      }
      const vorlage = holeVorlage(anfrage.params.id);
      if (!vorlage) return antwort.code(404).send({ fehler: 'Vorlage nicht gefunden.' });

      const bild = await vorlagenVorschau(vorlage, wurzel.vorlagen);
      return antwort.type('image/jpeg').header('Cache-Control', 'no-cache').send(bild);
    },
  );

  /**
   * Vorschaubild eines Filters.
   *
   * Mit einer Sitzung im Ruecken zeigt die Kachel das erste eigene Foto des
   * Gastes durch den Filter - an einem fremden Farbmuster sieht niemand, was
   * ein Look mit seinem Gesicht anstellt. Ohne Sitzung (oder wenn das Foto noch
   * nicht lesbar ist) bleibt das allgemeine Muster.
   */
  app.get<{ Params: { id: string }; Querystring: { sitzung?: string } }>(
    '/api/kiosk/filter/:id/vorschau.jpg',
    async (anfrage, antwort) => {
      const event = holeAktivesEvent();
      if (!event || !event.einstellungen.filter.includes(anfrage.params.id)) {
        return antwort.code(404).send({ fehler: 'Nicht freigegeben.' });
      }
      const preset = listeFilter().find((f) => f.id === anfrage.params.id);
      if (!preset) return antwort.code(404).send({ fehler: 'Filter nicht gefunden.' });

      // Der Pfad kommt aus der Datenbank, nie aus der Anfrage - aus der URL
      // stammt nur die Sitzungskennung.
      const eigenes = anfrage.query.sitzung ? erstesFoto(anfrage.query.sitzung) : null;

      const bild = await filterVorschau(preset, wurzel.luts, eigenes);
      return antwort.type('image/jpeg').header('Cache-Control', 'no-cache').send(bild);
    },
  );

  /** Sitzung starten. Die gewaehlte Vorlage bestimmt die Zahl der Fotos. */
  app.post<{ Body: unknown }>('/api/kiosk/sitzung', async (anfrage, antwort) => {
    const koerper = z.object({ vorlageId: z.string() }).parse(anfrage.body);
    const event = holeAktivesEvent();
    if (!event || event.status !== 'aktiv') {
      return antwort.code(409).send({ fehler: 'Es laeuft gerade keine Veranstaltung.' });
    }
    if (betrieb.aktiveSitzung) {
      return antwort.code(409).send({ fehler: 'Es laeuft bereits eine Sitzung.' });
    }

    const sitzung = starteSitzung(event, koerper.vorlageId);
    betrieb.aktiveSitzung = sitzung;
    betrieb.letzteBeruehrung = Date.now();

    // Zielordner der Kamera auf 01_originale des aktiven Events setzen: Die
    // Datei entsteht dort, wo sie ohnehin hingehoert.
    const pfade = eventpfade(event.ordner, sitzung.istTest);
    await betrieb.kamera.setzeZielordner(pfade.originale).catch(() => undefined);
    await betrieb.starteLiveView();

    return {
      sitzungId: sitzung.id,
      benoetigteFotos: sitzung.benoetigteFotos,
      vorlage: { id: sitzung.vorlage.id, name: sitzung.vorlage.name, canvas: sitzung.vorlage.canvas },
      seitenverhaeltnisse: seitenverhaeltnisse(sitzung.vorlage),
    };
  });

  /**
   * Ein Foto aufnehmen. Der Aufrufer zaehlt vorher selbst herunter; hier wird
   * nur ausgeloest und auf die Datei gewartet.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/kiosk/sitzung/:id/foto',
    async (anfrage, antwort) => {
      const koerper = z.object({ index: z.number().int().min(1) }).parse(anfrage.body);
      const sitzung = betrieb.aktiveSitzung;
      if (!sitzung || sitzung.id !== anfrage.params.id) {
        return antwort.code(409).send({ fehler: 'Sitzung ist nicht mehr aktiv.' });
      }
      const event = holeEvent(sitzung.eventId);
      if (!event) return antwort.code(409).send({ fehler: 'Veranstaltung fehlt.' });

      betrieb.letzteBeruehrung = Date.now();
      const pfade = eventpfade(event.ordner, sitzung.istTest);

      try {
        // Erst den Waechter aufsetzen, dann ausloesen - sonst geht eine sehr
        // schnelle Kamera durch die Lappen.
        const wartet = warteAufNeueDatei(pfade.originale, { zeitlimitMs: 25_000 });
        await betrieb.kamera.ausloesen();
        const datei = await wartet;
        await warteAufStabileDatei(datei);
        await verbucheFoto(sitzung, event, datei, koerper.index);
        sitzung.gemachteFotos = koerper.index;

        // Der Countdown fuer das naechste Foto darf erst starten, wenn die
        // Kamera wieder ein Live-Bild liefert.
        const liveWiederDa = await betrieb.warteAufLiveBild();

        return { ok: true, index: koerper.index, liveWiederDa };
      } catch (fehler) {
        const text = fehler instanceof Error ? fehler.message : String(fehler);
        protokolliere('warnung', 'aufnahme', text);
        return antwort.code(503).send({ fehler: 'aufnahme-fehlgeschlagen', hinweis: text });
      }
    },
  );

  /** Filter anwenden, Layout bauen, Druck-PDF erzeugen. */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/kiosk/sitzung/:id/fertig',
    async (anfrage, antwort) => {
      const koerper = z.object({ filterId: z.string().nullable() }).parse(anfrage.body);
      const sitzung = betrieb.aktiveSitzung;
      if (!sitzung || sitzung.id !== anfrage.params.id) {
        return antwort.code(409).send({ fehler: 'Sitzung ist nicht mehr aktiv.' });
      }
      const event = holeEvent(sitzung.eventId);
      if (!event) return antwort.code(409).send({ fehler: 'Veranstaltung fehlt.' });

      betrieb.letzteBeruehrung = Date.now();
      const geraet = leseGeraet();
      const ausgabe = await stelleFertig(sitzung, event, koerper.filterId, {
        lutOrdner: wurzel.luts,
        vorlagenOrdner: wurzel.vorlagen,
        kalibrierung: geraet.kalibrierung,
      });

      betrieb.aktiveSitzung = null;
      return { ausgabeId: ausgabe.id, vorschau: `/medien/ausgabe/${ausgabe.id}.jpg` };
    },
  );

  app.post<{ Params: { id: string } }>('/api/kiosk/sitzung/:id/abbrechen', async (anfrage) => {
    if (betrieb.aktiveSitzung?.id === anfrage.params.id) {
      brichSitzungAb(anfrage.params.id);
      betrieb.aktiveSitzung = null;
    }
    return { ok: true };
  });

  /**
   * Drucken. Es wird nie ungefragt gedruckt: Diese Route wird ausschliesslich
   * durch das bewusste Antippen des Gastes ausgeloest.
   */
  app.post<{ Body: unknown }>('/api/kiosk/drucken', async (anfrage, antwort) => {
    const koerper = z
      .object({
        ausgabeId: z.string(),
        kopien: z.number().int().min(1).max(20),
        quelle: z.enum(['kiosk', 'galerie', 'servicemenue']).default('kiosk'),
      })
      .parse(anfrage.body);

    const event = holeAktivesEvent();
    if (!event) return antwort.code(409).send({ fehler: 'Keine Veranstaltung aktiv.' });
    if (!event.einstellungen.druckAktiv) {
      return antwort.code(403).send({ fehler: 'Drucken ist fuer diese Veranstaltung aus.' });
    }
    if (koerper.kopien > event.einstellungen.kopienMax) {
      return antwort.code(400).send({ fehler: 'Mehr Kopien als erlaubt.' });
    }
    if (druckLimitErreicht(event.id)) {
      return antwort.code(403).send({ fehler: 'Das Druck-Limit dieser Veranstaltung ist erreicht.' });
    }

    const ausgabe = holeAusgabe(koerper.ausgabeId);
    if (!ausgabe || ausgabe.eventId !== event.id || !ausgabe.pfadDruckPdf) {
      return antwort.code(404).send({ fehler: 'Ausgabe nicht gefunden.' });
    }

    const auftragId = reiheEin({
      eventId: event.id,
      ausgabeId: ausgabe.id,
      pfadPdf: ausgabe.pfadDruckPdf,
      kopien: koerper.kopien,
      quelle: koerper.quelle,
      // Probelauf-Sitzungen zaehlen nicht in den Auslagenersatz.
      berechnen: !event.probelauf,
    });

    betrieb.letzteBeruehrung = Date.now();
    return { auftragId, wartend: true };
  });

  /**
   * E-Mail-Versand. Der Knopf erscheint in der Oberflaeche nur, wenn die Box
   * tatsaechlich online ist; hier wird das noch einmal geprueft, damit die
   * Route nicht ohne Verbindung haengen bleibt.
   */
  app.post<{ Body: unknown }>('/api/kiosk/email', async (anfrage, antwort) => {
    const koerper = z
      .object({
        ausgabeId: z.string(),
        adresse: z.string().max(254),
        einwilligung: z.literal(true),
      })
      .parse(anfrage.body);

    const event = holeAktivesEvent();
    if (!event) return antwort.code(409).send({ fehler: 'Keine Veranstaltung aktiv.' });
    if (!event.einstellungen.emailAktiv) {
      return antwort.code(403).send({ fehler: 'E-Mail ist fuer diese Veranstaltung aus.' });
    }
    if (!pruefeAdresse(koerper.adresse)) {
      return antwort.code(400).send({ fehler: 'Diese Adresse sieht nicht richtig aus.' });
    }
    // Ein offenes Mailformular im Fremd-WLAN ist ein klassisches Missbrauchsziel.
    const kennung = anfrage.ip;
    if (drosselGreift(kennung) || tageslimitErreicht(event.id)) {
      return antwort.code(429).send({ fehler: 'Gerade zu viele Anfragen. Bitte kurz warten.' });
    }

    const ausgabe = holeAusgabe(koerper.ausgabeId);
    if (!ausgabe || ausgabe.eventId !== event.id) {
      return antwort.code(404).send({ fehler: 'Ausgabe nicht gefunden.' });
    }

    const zugang = leseMailzugang();
    if (!zugang || !(await istOnline())) {
      return antwort.code(503).send({ fehler: 'Die Box ist gerade nicht online.' });
    }

    try {
      await versende(event, koerper.adresse, ausgabe.pfadLayout, ausgabe.id, zugang);
      return { ok: true };
    } catch (fehler) {
      protokolliere('warnung', 'email', (fehler as Error).message);
      return antwort.code(502).send({ fehler: 'Versand hat nicht geklappt.' });
    }
  });

  /** Galerie am Touchscreen: die fertigen Layouts der laufenden Veranstaltung. */
  app.get('/api/kiosk/galerie', async () => {
    const event = holeAktivesEvent();
    if (!event) return { bilder: [] };
    return {
      veranstaltung: event.name,
      nachdruckMoeglich: event.einstellungen.druckAktiv && !druckLimitErreicht(event.id),
      kopienMax: event.einstellungen.kopienMax,
      bilder: galerieEintraege(event.id).map((e) => ({ id: e.ausgabeId, erstellt: e.erstellt })),
    };
  });

  /**
   * "Was ist los?" - erreichbar ueber einen Knopf auf der PIN-Abfrage, also
   * ohne PIN. Lesen darf ihn jeder, aendern kann dort niemand etwas.
   */
  app.get('/api/kiosk/wasistlos', async () => {
    const status = await betrieb.status();
    const event = holeAktivesEvent();
    const auslagen = event ? berechneAuslagen(event) : null;
    return {
      kamera: status.kamera,
      drucker: status.drucker,
      stoerung: status.stoerung,
      stoerungstext: status.stoerung ? STOERUNGSTEXTE[status.stoerung] : null,
      warteschlangeOffen: status.warteschlangeOffen,
      materialRest: auslagen?.materialRest ?? 0,
      speicherFreiGb: status.speicherFreiGb,
      drucke: auslagen?.druckeGesamt ?? 0,
      sitzungen: auslagen?.sitzungen ?? 0,
    };
  });

  /**
   * PIN-Pruefung fuer das Servicemenue. Welches Menue erscheint, haengt davon
   * ab, welche PIN eingegeben wurde: Der Kunde bekommt die Betreuer-PIN und
   * damit nur die Handgriffe des Alltags.
   */
  app.post<{ Body: unknown }>('/api/kiosk/pin', async (anfrage, antwort) => {
    const koerper = z.object({ pin: z.string().min(1).max(32) }).parse(anfrage.body);

    const sperreMs = drossel.gesperrtFuerMs();
    if (sperreMs > 0) {
      return antwort
        .code(429)
        .send({ fehler: 'Zu viele Fehlversuche.', wartenSekunden: Math.ceil(sperreMs / 1000) });
    }

    const geraet = leseGeraet();
    const event = holeAktivesEvent();

    if (await pruefePin(koerper.pin, geraet.besitzerPinHash)) {
      drossel.merkeErfolg();
      return { ebene: 'besitzer' as const };
    }
    if (event && (await pruefePin(koerper.pin, event.betreuerPinHash))) {
      drossel.merkeErfolg();
      return { ebene: 'betreuer' as const };
    }

    drossel.merkeFehlversuch();
    return antwort.code(401).send({ fehler: 'PIN stimmt nicht.' });
  });

  /** Servicemenue: Papier gewechselt, Warteschlange fortsetzen. */
  app.post('/api/kiosk/service/fortsetzen', async () => {
    betrieb.druckschleife.fortsetzen();
    protokolliere('info', 'druck', 'Warteschlange nach Papierwechsel fortgesetzt.');
    return { ok: true };
  });

  /** Servicemenue: neue Rolle eingelegt, Materialzaehler zuruecksetzen. */
  app.post('/api/kiosk/service/neue-rolle', async (_anfrage, antwort) => {
    const event = holeAktivesEvent();
    if (!event) return antwort.code(409).send({ fehler: 'Keine Veranstaltung aktiv.' });
    verbucheMaterial(event.id, -event.materialVerbraucht);
    protokolliere('info', 'material', `Neue Rolle fuer "${event.name}" eingelegt.`);
    return { ok: true };
  });

  function druckLimitErreicht(eventId: string): boolean {
    const event = holeEvent(eventId);
    if (!event || event.einstellungen.druckLimit <= 0) return false;
    return berechneAuslagen(event).druckeGesamt >= event.einstellungen.druckLimit;
  }
}

/** Seitenverhaeltnis je Foto-Ebene, damit das Live-Bild passend maskiert wird. */
function seitenverhaeltnisse(vorlage: {
  canvas: { breiteMm: number; hoeheMm: number };
  ebenen: { typ: string; index?: number; w: number; h: number }[];
}): Record<number, number> {
  const ergebnis: Record<number, number> = {};
  for (const ebene of vorlage.ebenen) {
    if (ebene.typ !== 'foto' || ebene.index === undefined) continue;
    const breitePx = ebene.w * vorlage.canvas.breiteMm;
    const hoehePx = ebene.h * vorlage.canvas.hoeheMm;
    ergebnis[ebene.index] = hoehePx > 0 ? breitePx / hoehePx : 1.5;
  }
  return ergebnis;
}
