import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { holeAktivesEvent, holeEvent, setzeStatus, verbucheMaterial } from '../fach/events.js';
import { holeVorlage, listeVorlagen } from '../fach/vorlagen.js';
import { listeFilter } from '../fach/filter.js';
import { leseGeraet } from '../db/geraet.js';
import {
  bestaetigungsbild,
  brichSitzungAb,
  galerieEintraege,
  holeAusgabe,
  setzeVerborgen,
  vorschauBasis,
  starteSitzung,
  stelleFertig,
  verbucheFoto,
  zahlDerFotos,
} from '../fach/sitzungen.js';
import { warteAufNeueDatei, warteAufStabileDatei } from '../fach/aufnahme.js';
import { blattInWarteschlange, blattVergeben, gastKopienVon, reiheEin } from '../fach/druckwarteschlange.js';
import { berechneAuslagen } from '../fach/auslagen.js';
import {
  adresseZuOft,
  drosselGreift,
  einwilligungstextFuer,
  FOTO_FRISCH_MS,
  istOnline,
  leseMailzugang,
  pruefeAdresse,
  tageslimitErreicht,
  versende,
} from '../fach/email.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { pruefePin, PinDrossel } from '../fach/pin.js';
import { filterVorschau, vorlagenVorschau } from '../bild/vorschau.js';
import { anzahlFotos, BETREUER_HINWEISE, fotoEbenen, STOERUNGSTEXTE, type Vorlage } from '../../shared/typen.js';
import { galerieUrl } from '../netzwerk.js';
import { protokolliere, type Betrieb } from '../betrieb.js';
import type { Konfig } from '../konfig.js';

/**
 * Kiosk-Routen. Erreichbar ausschliesslich ueber 127.0.0.1 - siehe
 * Sicherheitskonzept.
 */
/** So lange darf die Kamera fuer eine Datei brauchen. Die 600D schickt ein
 *  JPEG ueber USB in zwei bis vier Sekunden; was nach 15 nicht da ist, kommt
 *  nicht mehr - und die Gaeste stehen so lange mit eingefrorenem Laecheln da. */
const AUFNAHME_ZEITLIMIT_MS = 15_000;

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

    // Eine Vorlage ohne sichtbare Foto-Ebene bietet der Kiosk nicht an: Die
    // Gruppe stuende auf, und es wuerde kein Foto gemacht.
    const freigegeben = event.einstellungen.vorlagen
      .map((id) => holeVorlage(id))
      .filter((v): v is NonNullable<typeof v> => v !== null && anzahlFotos(v) > 0);

    const alleFilter = listeFilter();
    const filter = event.einstellungen.filter
      .map((id) => alleFilter.find((f) => f.id === id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined);

    return {
      bereit: event.status === 'aktiv',
      pausiert: event.status === 'pausiert',
      status,
      // Damit der Kiosk eine verwaiste Sitzung erkennt - etwa nach einem
      // Neuladen des Browsers mitten in der Aufnahme - und sie verwirft,
      // statt den naechsten Gast drei Minuten mit "laeuft schon" zu blockieren.
      aktiveSitzungId: betrieb.aktiveSitzung?.id ?? null,
      veranstaltung: { id: event.id, name: event.name, probelauf: event.probelauf },
      darstellung: {
        titel: event.einstellungen.startTitel,
        untertitel: event.einstellungen.startUntertitel,
        akzent: event.einstellungen.farbeAkzent,
        qrAufStartseite: event.einstellungen.qrAufStartseite && event.einstellungen.galerieAktiv,
        // Fertige Adresse vom Server, nie im Browser zusammengesetzt - siehe
        // galerieUrl(). null, wenn die Box keine Netzwerkadresse hat.
        galerieUrl: event.einstellungen.galerieAktiv
          ? galerieUrl(event.galerieToken, konfig.portOeffentlich)
          : null,
      },
      zeiten: event.einstellungen.zeiten,
      toene: event.einstellungen.toene,
      ausgabe: {
        druckAktiv: event.einstellungen.druckAktiv,
        emailAktiv: event.einstellungen.emailAktiv && leseMailzugang() !== null && (await istOnline()),
        einwilligungstext: einwilligungstextFuer(event),
        kopienVorgabe: event.einstellungen.kopienVorgabe,
        kopienMax: event.einstellungen.kopienMax,
        druckLimitErreicht: druckLimitErreicht(event.id),
        // Blatt bis zum Druck-Limit, null ohne Limit - die Mengenwahl bietet nie mehr an.
        druckRest: druckRest(event.id),
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
      // Schlaegt das Lesen fehl (Datei noch nicht fertig geschrieben), bleibt
      // das allgemeine Muster - eine Vorschau ist besser als eine leere Kachel.
      const eigenes = anfrage.query.sitzung ? await vorschauBasis(anfrage.query.sitzung) : null;

      const bild = await filterVorschau(preset, wurzel.luts, eigenes);
      return antwort.type('image/jpeg').header('Cache-Control', 'no-cache').send(bild);
    },
  );

  /** Sitzung starten. Die gewaehlte Vorlage bestimmt die Zahl der Fotos. */
  app.post<{ Body: unknown }>('/api/kiosk/sitzung', async (anfrage, antwort) => {
    const koerper = z.object({ vorlageId: z.string() }).parse(anfrage.body);
    const event = holeAktivesEvent();
    if (!event || event.status !== 'aktiv') {
      return antwort.code(409).send({ fehler: 'Es läuft gerade keine Veranstaltung.' });
    }
    if (betrieb.aktiveSitzung) {
      return antwort.code(409).send({ fehler: 'Es läuft schon eine Aufnahme.' });
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
      if (koerper.index > sitzung.benoetigteFotos) {
        return antwort.code(400).send({ fehler: `Diese Vorlage hat nur ${sitzung.benoetigteFotos} Fotoplätze.` });
      }
      const event = holeEvent(sitzung.eventId);
      if (!event) return antwort.code(409).send({ fehler: 'Veranstaltung fehlt.' });

      betrieb.letzteBeruehrung = Date.now();
      const pfade = eventpfade(event.ordner, sitzung.istTest);

      const abbruch = new AbortController();
      try {
        // Den Zielordner vor jedem Foto neu setzen, nicht nur zu Beginn der
        // Sitzung: Startet digiCamControl zwischendurch neu, vergisst es ihn
        // und legt das naechste Foto in seinen Standardordner - wir warteten
        // dann vergeblich.
        await betrieb.kamera.setzeZielordner(pfade.originale).catch(() => undefined);

        // Erst den Waechter aufsetzen, dann ausloesen - sonst geht eine sehr
        // schnelle Kamera durch die Lappen.
        const wartet = warteAufNeueDatei(pfade.originale, {
          zeitlimitMs: AUFNAHME_ZEITLIMIT_MS,
          abbruch: abbruch.signal,
        });
        await betrieb.kamera.ausloesen();
        const datei = await wartet;
        await warteAufStabileDatei(datei);
        await verbucheFoto(sitzung, event, datei, koerper.index);
        sitzung.gemachteFotos = koerper.index;
        betrieb.letzteBeruehrung = Date.now();

        return { ok: true, index: koerper.index };
      } catch (fehler) {
        abbruch.abort();
        const text = fehler instanceof Error ? fehler.message : String(fehler);
        protokolliere('warnung', 'aufnahme', `Foto ${koerper.index}: ${text}`);
        // Der Kiosk versucht es noch einmal; die Sitzung bleibt bestehen.
        return antwort.code(503).send({ fehler: 'Das Foto hat nicht geklappt.', wiederholbar: true });
      }
    },
  );

  /** Das eben gemachte Foto fuer die Bestaetigung - nur waehrend der eigenen Sitzung. */
  app.get<{ Params: { id: string; index: string } }>(
    '/api/kiosk/sitzung/:id/foto/:index/bild.jpg',
    async (anfrage, antwort) => {
      if (betrieb.aktiveSitzung?.id !== anfrage.params.id) {
        return antwort.code(409).send({ fehler: 'Sitzung ist nicht mehr aktiv.' });
      }
      const index = Number(anfrage.params.index);
      if (!Number.isInteger(index) || index < 1) return antwort.code(400).send({ fehler: 'Ungueltiger Platz.' });
      const bild = await bestaetigungsbild(anfrage.params.id, index).catch(() => null);
      if (!bild) return antwort.code(404).send({ fehler: 'Foto nicht gefunden.' });
      return antwort.type('image/jpeg').header('Cache-Control', 'no-store').send(bild);
    },
  );

  /**
   * Ist die Kamera bereit fuer das naechste Foto? Bereit heisst: Es kam gerade
   * eben ein frisches Live-Bild. Der Kiosk fragt das vor jedem Countdown, damit
   * nie vor einem schwarzen oder eingefrorenen Bild heruntergezaehlt wird.
   */
  app.get<{ Params: { id: string } }>('/api/kiosk/sitzung/:id/kamera', async (anfrage, antwort) => {
    if (betrieb.aktiveSitzung?.id !== anfrage.params.id) {
      return antwort.code(409).send({ fehler: 'Sitzung ist nicht mehr aktiv.' });
    }
    // Wer auf die Kamera wartet, ist nicht untaetig - die Rettungsleine nach
    // drei Minuten soll eine wartende Gruppe nicht hinauswerfen.
    betrieb.letzteBeruehrung = Date.now();
    if (!betrieb.liveViewLaeuft()) await betrieb.starteLiveView();
    return { bereit: await betrieb.liveBildDa() };
  });

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
      // Ein Layout mit leeren Fotoplaetzen soll nie entstehen.
      if (zahlDerFotos(sitzung.id) < sitzung.benoetigteFotos) {
        return antwort.code(409).send({ fehler: 'Es fehlen noch Fotos. Bitte startet noch einmal.' });
      }

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
      return antwort.code(403).send({ fehler: 'Drucken ist bei dieser Feier ausgeschaltet.' });
    }
    if (koerper.kopien > event.einstellungen.kopienMax) {
      return antwort.code(400).send({ fehler: 'Mehr Kopien als erlaubt.' });
    }
    const limitRest = druckRest(event.id);
    if (limitRest !== null && limitRest <= 0) {
      return antwort.code(403).send({ fehler: 'Für diese Feier sind alle Ausdrucke aufgebraucht. Dein Foto ist trotzdem gespeichert.' });
    }
    if (limitRest !== null && koerper.kopien > limitRest) {
      return antwort.code(409).send({
        fehler: `Für diese Feier ${limitRest === 1 ? 'geht nur noch ein Ausdruck' : `gehen nur noch ${limitRest} Ausdrucke`}.`,
      });
    }

    const ausgabe = holeAusgabe(koerper.ausgabeId);
    if (!ausgabe || ausgabe.eventId !== event.id || !ausgabe.pfadDruckPdf) {
      return antwort.code(404).send({ fehler: 'Ausgabe nicht gefunden.' });
    }

    // "Maximale Kopien" gilt je Foto, nicht je Tipper. Vorher liess sich
    // dasselbe Foto ueber die Galerie immer wieder drucken - im Test zwoelf
    // Blatt bei eingestellten drei. Genau das sollte die Einstellung bei
    // einer Kinderparty verhindern. Der Betreuer im Servicemenue darf mehr.
    if (koerper.quelle !== 'servicemenue') {
      const rest = event.einstellungen.kopienMax - gastKopienVon(ausgabe.id);
      if (rest <= 0) {
        return antwort
          .code(409)
          .send({ fehler: 'Von diesem Foto sind schon alle Ausdrucke gemacht, die es gibt. Frag gern den Gastgeber.' });
      }
      if (koerper.kopien > rest) {
        return antwort
          .code(409)
          .send({ fehler: `Von diesem Foto ${rest === 1 ? 'geht nur noch ein Ausdruck' : `gehen nur noch ${rest} Ausdrucke`}.` });
      }
    }

    // Vor dem Einreihen: So viele Blatt kommen vor diesem heraus.
    const vorDir = blattInWarteschlange();
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
    // Steht der Drucker gerade, soll die Quittung das sagen - nicht "gleich am
    // Drucker abholen", waehrend das Papier leer ist. Dafuer ein frischer
    // Blick auf den Drucker, nicht der von vor bis zu 20 Sekunden.
    await betrieb.frischerDruckerStatus();
    const stoerung = betrieb.aktuelleStoerung();
    const druckerSteht =
      stoerung === 'papier-leer' || stoerung === 'drucker-offline' || stoerung === 'drucker-klappe';
    return { auftragId, wartend: true, druckerSteht, vorDir };
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
      return antwort.code(403).send({ fehler: 'E-Mail ist bei dieser Feier ausgeschaltet.' });
    }
    if (!pruefeAdresse(koerper.adresse)) {
      return antwort.code(400).send({ fehler: 'Diese Adresse sieht nicht richtig aus.' });
    }
    // Ein Formular, das im Namen des Besitzers Mails verschickt, ist ein
    // Missbrauchsziel - daher Drossel, Tageslimit und Limit je Adresse.
    // Drei Sperren, drei Saetze: "Bitte kurz warten" stimmte nur fuer die
    // erste - bei den anderen hilft Warten an diesem Abend nicht.
    const kennung = anfrage.ip;
    if (drosselGreift(kennung)) {
      return antwort.code(429).send({ fehler: 'Gerade zu viele E-Mails auf einmal. Bitte eine Minute warten.' });
    }
    if (tageslimitErreicht(event.id)) {
      return antwort
        .code(429)
        .send({ fehler: 'Heute gehen keine E-Mails mehr hinaus. Die Fotos gibt es später beim Gastgeber.' });
    }
    if (adresseZuOft(event.id, koerper.adresse)) {
      return antwort.code(429).send({ fehler: 'An diese Adresse sind heute schon genug Fotos gegangen.' });
    }

    // Nur das Foto, das gerade eben fertig wurde - nicht jedes beliebige aus
    // der Galerie, und keines, das der Gastgeber herausgenommen hat.
    const ausgabe = holeAusgabe(koerper.ausgabeId);
    if (
      !ausgabe ||
      ausgabe.eventId !== event.id ||
      ausgabe.verborgen ||
      Date.now() - Date.parse(ausgabe.erstellt) > FOTO_FRISCH_MS
    ) {
      return antwort.code(404).send({ fehler: 'Dieses Foto lässt sich nicht mehr verschicken.' });
    }

    const zugang = leseMailzugang();
    if (!zugang || !(await istOnline())) {
      return antwort.code(503).send({ fehler: 'Die Box ist gerade nicht online.' });
    }

    try {
      await versende(
        event,
        koerper.adresse,
        ausgabe.pfadLayout,
        ausgabe.id,
        zugang,
        einwilligungstextFuer(event),
      );
      return { ok: true };
    } catch (fehler) {
      // versende() hat die Adresse schon aus der Meldung entfernt.
      protokolliere('warnung', 'email', (fehler as Error).message);
      return antwort.code(502).send({ fehler: 'Versand hat nicht geklappt.' });
    }
  });

  /**
   * Galerie am Touchscreen: die fertigen Layouts der laufenden Veranstaltung.
   * Mit ?alle=1 (aus dem Servicemenue) auch die aus der Galerie genommenen,
   * damit man sie zurueckholen kann.
   */
  app.get<{ Querystring: { alle?: string } }>('/api/kiosk/galerie', async (anfrage) => {
    const event = holeAktivesEvent();
    if (!event) return { bilder: [] };
    const limitRest = druckRest(event.id);
    return {
      veranstaltung: event.name,
      nachdruckMoeglich: event.einstellungen.druckAktiv && !druckLimitErreicht(event.id),
      // Auch der Betreuer druckt nicht ueber das Druck-Limit hinaus.
      kopienMax: Math.min(event.einstellungen.kopienMax, limitRest ?? Infinity),
      bilder: galerieEintraege(event.id, { mitVerborgenen: anfrage.query.alle === '1' }).map((e) => ({
        id: e.ausgabeId,
        erstellt: e.erstellt,
        verborgen: e.verborgen,
        // Wie viele Ausdrucke Gaeste von diesem Foto noch anstossen koennen -
        // je Foto und hoechstens bis zum Druck-Limit der Feier.
        restKopien: Math.max(
          0,
          Math.min(event.einstellungen.kopienMax - gastKopienVon(e.ausgabeId), limitRest ?? Infinity),
        ),
      })),
    };
  });

  /**
   * Servicemenue: ein Bild aus der Galerie nehmen oder zurueckholen. Es
   * verschwindet sofort von allen Handys und vom Touchscreen; die Dateien
   * bleiben und gehen mit der Uebergabe an den Gastgeber.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/kiosk/service/galerie/:id',
    async (anfrage, antwort) => {
      const { verborgen } = z.object({ verborgen: z.boolean() }).parse(anfrage.body);
      const event = holeAktivesEvent();
      const ausgabe = holeAusgabe(anfrage.params.id);
      if (!event || !ausgabe || ausgabe.eventId !== event.id) {
        return antwort.code(404).send({ fehler: 'Bild nicht gefunden.' });
      }
      setzeVerborgen(ausgabe.id, verborgen);
      protokolliere(
        'info',
        'galerie',
        `Bild ${ausgabe.id.slice(0, 8)} ${verborgen ? 'aus der Galerie genommen' : 'wieder in die Galerie gestellt'}.`,
      );
      return { ok: true, verborgen };
    },
  );

  /**
   * "Was ist los?" - erreichbar ueber einen Knopf auf der PIN-Abfrage, also
   * ohne PIN. Lesen darf ihn jeder, aendern kann dort niemand etwas.
   */
  app.get('/api/kiosk/wasistlos', async () => {
    const status = await betrieb.status();
    const event = holeAktivesEvent();
    const auslagen = event ? berechneAuslagen(event) : null;
    return {
      // Der Stand gehoert dazu: Wer ein Foto dieser Seite verschickt, soll
      // sehen koennen, wann es entstanden ist.
      stand: new Date().toISOString(),
      veranstaltung: event ? { id: event.id, name: event.name, status: event.status } : null,
      kamera: status.kamera,
      drucker: status.drucker,
      stoerung: status.stoerung,
      stoerungstext: status.stoerung ? STOERUNGSTEXTE[status.stoerung] : null,
      betreuerHinweis: status.stoerung ? BETREUER_HINWEISE[status.stoerung] : null,
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
      const sekunden = Math.ceil(sperreMs / 1000);
      // Mit Zahl: "Zu viele Fehlversuche." allein laesst offen, ob man gleich
      // weitermachen kann oder den Besitzer anrufen muss.
      return antwort
        .code(429)
        .send({ fehler: `Zu viele Fehlversuche. Bitte ${sekunden} Sekunden warten.`, wartenSekunden: sekunden });
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
    const wartend = betrieb.druckschleife.fortsetzen(holeAktivesEvent()?.id ?? null);
    protokolliere('info', 'druck', `Warteschlange nach Papierwechsel fortgesetzt (${wartend} offen).`);
    // Die Zahl gehoert in die Rueckmeldung: "Die wartenden Fotos werden
    // gedruckt" stand vorher auch da, wenn gar nichts wartete.
    return { ok: true, wartend };
  });

  /** Servicemenue: neue Rolle eingelegt, Materialzaehler zuruecksetzen. */
  app.post('/api/kiosk/service/neue-rolle', async (_anfrage, antwort) => {
    const event = holeAktivesEvent();
    if (!event) return antwort.code(409).send({ fehler: 'Keine Veranstaltung aktiv.' });
    verbucheMaterial(event.id, -event.materialVerbraucht);
    protokolliere('info', 'material', `Neue Rolle fuer "${event.name}" eingelegt.`);
    return { ok: true };
  });

  /**
   * Servicemenue: Pause ein/aus. Der Kiosk zeigt waehrend der Pause einen
   * freundlichen Hinweis statt der Startseite - etwa waehrend des Essens.
   */
  app.post<{ Body: unknown }>('/api/kiosk/service/pause', async (anfrage, antwort) => {
    const { an } = z.object({ an: z.boolean() }).parse(anfrage.body);
    const event = holeAktivesEvent();
    if (!event) return antwort.code(409).send({ fehler: 'Keine Veranstaltung aktiv.' });
    try {
      setzeStatus(event.id, an ? 'pausiert' : 'aktiv');
    } catch (fehler) {
      return antwort.code(409).send({ fehler: (fehler as Error).message });
    }
    protokolliere('info', 'event', `"${event.name}" ${an ? 'pausiert' : 'laeuft weiter'} (Servicemenue).`);
    return { ok: true, pausiert: an };
  });

  /**
   * Servicemenue (Besitzer): PC herunterfahren.
   *
   * Nur mit echter Hardware unter Windows - im Entwicklungsbetrieb wuerde das
   * sonst den Rechner des Entwicklers abschalten. 15 Sekunden Vorlauf, damit
   * der Server die Datenbank sauber schliessen kann; "shutdown /a" bricht ab.
   * Laeuft ohne Adminrechte: Das Herunterfahren des eigenen Rechners darf unter
   * Windows jeder angemeldete Benutzer.
   */
  app.post('/api/kiosk/service/herunterfahren', async () => {
    if (process.platform !== 'win32' || !konfig.echteHardware) {
      protokolliere('info', 'system', 'Herunterfahren angefordert (Entwicklungsbetrieb - nur protokolliert).');
      return { ok: true, simuliert: true };
    }
    protokolliere('info', 'system', 'PC wird heruntergefahren (Servicemenue).');
    spawn('shutdown', ['/s', '/t', '15', '/c', 'Die Fotobox wird heruntergefahren.'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return { ok: true, simuliert: false };
  });

  /**
   * QR-Code fuer den Startbildschirm. Nur lokal: Im WLAN braucht ihn niemand,
   * und ein offener Generator dort waere nur Rechenzeit fuer Fremde.
   */
  app.get<{ Querystring: { text?: string } }>('/api/qr', async (anfrage, antwort) => {
    const text = anfrage.query.text ?? '';
    if (!text || text.length > 500) return antwort.code(400).send({ fehler: 'Kein gueltiger Text.' });
    const png = await QRCode.toBuffer(text, { width: 512, margin: 1 });
    return antwort.header('Content-Type', 'image/png').send(png);
  });

  /** Die Oberflaeche meldet einen eigenen Absturz, damit er im Protokoll steht. */
  app.post<{ Body: unknown }>('/api/kiosk/meldung', async (anfrage) => {
    const { text } = z.object({ text: z.string().max(4000) }).parse(anfrage.body);
    protokolliere('fehler', 'oberflaeche', text);
    return { ok: true };
  });

  /**
   * Servicemenue (Besitzer): Kiosk schliessen, zum Windows-Desktop.
   *
   * "Vollbild verlassen" per Fullscreen-API konnte im Chrome-Kiosk nie
   * funktionieren - der Kiosk-Modus ist kein Vollbild im Sinne der Seite. Jetzt
   * wird der Kiosk-Browser beendet, und eine Markierung sagt "Kiosk starten.bat",
   * ihn diesmal nicht wieder zu oeffnen. Ein Doppelklick auf diese Datei (oder
   * der naechste PC-Start) bringt den Kiosk zurueck.
   */
  app.post('/api/kiosk/service/kiosk-schliessen', async () => {
    writeFileSync(join(konfig.datenpfad, 'kiosk-aus.txt'), `Kiosk geschlossen am ${new Date().toISOString()}\r\n`);
    if (process.platform !== 'win32' || !konfig.echteHardware) {
      protokolliere('info', 'system', 'Kiosk schliessen angefordert (Entwicklungsbetrieb - nur protokolliert).');
      return { ok: true, simuliert: true };
    }
    protokolliere('info', 'system', 'Kiosk geschlossen (Servicemenue).');
    // Nur die Browser-Instanz mit dem Kiosk-Profil - ein anderes offenes
    // Chrome-Fenster bleibt unberuehrt.
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Start-Sleep -Milliseconds 800; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*Fotobox-Kiosk*' -and ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    ).unref();
    return { ok: true, simuliert: false };
  });

  /** Blatt bis zum Druck-Limit der Feier; null, wenn kein Limit gesetzt ist. */
  function druckRest(eventId: string): number | null {
    const event = holeEvent(eventId);
    if (!event || event.einstellungen.druckLimit <= 0) return null;
    return Math.max(0, event.einstellungen.druckLimit - blattVergeben(event.id));
  }

  function druckLimitErreicht(eventId: string): boolean {
    const rest = druckRest(eventId);
    return rest !== null && rest <= 0;
  }
}

/** Seitenverhaeltnis je Foto-Ebene, damit das Live-Bild passend maskiert wird. */
function seitenverhaeltnisse(vorlage: Vorlage): Record<number, number> {
  // Nach Aufnahmenummer, nicht nach der eingetragenen Nummer der Ebene - das
  // Live-Bild fuer Foto 2 zeigt den Ausschnitt der Ebene, die Foto 2 bekommt.
  const ergebnis: Record<number, number> = {};
  fotoEbenen(vorlage).forEach((ebene, i) => {
    const breite = ebene.w * vorlage.canvas.breiteMm;
    const hoehe = ebene.h * vorlage.canvas.hoeheMm;
    ergebnis[i + 1] = hoehe > 0 ? breite / hoehe : 1.5;
  });
  return ergebnis;
}
