import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { leseGeraet, schreibeGeraet, begrenzeKalibrierung } from '../db/geraet.js';
import {
  aktualisiereEvent,
  erneuereGalerieToken,
  erstelleEvent,
  holeAktivesEvent,
  holeEvent,
  listeEvents,
  setzeProbelauf,
  setzeStatus,
} from '../fach/events.js';
import { holeVorlage, listeVorlagen, loescheVorlage, speichereVorlage } from '../fach/vorlagen.js';
import { listeFilter, loescheFilter, speichereFilter } from '../fach/filter.js';
import { berechneAuslagen, schreibeAuslagenCsv } from '../fach/auslagen.js';
import { listeAuftraege, reiheEin, setzeBerechnen } from '../fach/druckwarteschlange.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { hashePin } from '../fach/pin.js';
import { baueLayout, layoutMasse } from '../bild/layout.js';
import { schreibeDruckPdf } from '../bild/pdf.js';
import { kalibrierTestbild, platzhalterFoto } from '../bild/testbilder.js';
import { leereVorschauLager, vorlagenVorschau } from '../bild/vorschau.js';
import { familieAus, listeSchriften, schriftenOrdner } from '../fach/schriften.js';
import { startbereitPruefung } from '../fach/startbereit.js';
import { bereiteUebergabeVor, uebergebeAufDatentraeger } from '../fach/uebergabe.js';
import { schreibeAushang, schreibeKurzanleitung } from '../fach/unterlagen.js';
import { loescheAlteAdressen } from '../fach/email.js';
import { lanAdresse } from '../netzwerk.js';
import { CANVAS_PRESETS, fotoEbenen, type CanvasPreset, type Ebene } from '../../shared/typen.js';
import { protokolliere, type Betrieb } from '../betrieb.js';
import type { Konfig } from '../konfig.js';

/**
 * Admin-Routen. Ausschliesslich ueber 127.0.0.1 erreichbar - ein Gast im WLAN
 * kann diese Adresse nicht einmal aufrufen.
 */
export function registriereAdmin(app: FastifyInstance, betrieb: Betrieb, konfig: Konfig): void {
  const wurzel = wurzelpfade(konfig.datenpfad);

  // ---------------------------------------------------------------- Geraet
  app.get('/api/admin/geraet', async () => {
    const geraet = leseGeraet();
    return {
      ...geraet,
      besitzerPinGesetzt: geraet.besitzerPinHash !== null,
      besitzerPinHash: undefined,
      lanAdresse: lanAdresse(),
      hardware: konfig.echteHardware ? 'echt' : 'mock',
    };
  });

  app.put<{ Body: unknown }>('/api/admin/geraet', async (anfrage) => {
    const koerper = z
      .object({
        druckerName: z.string().optional(),
        sumatraPfad: z.string().optional(),
        digicamcontrolPfad: z.string().optional(),
        speicherWarnungGb: z.number().min(0).optional(),
        kamera: z
          .object({ iso: z.string(), blende: z.string(), verschlusszeit: z.string() })
          .optional(),
        kalibrierung: z
          .object({
            versatzXMm: z.number(),
            versatzYMm: z.number(),
            skalierungXProzent: z.number(),
            skalierungYProzent: z.number(),
          })
          .optional(),
        besitzerPin: z.string().min(4).max(32).optional(),
      })
      .parse(anfrage.body);

    const aenderung: Parameters<typeof schreibeGeraet>[0] = {};
    if (koerper.druckerName !== undefined) aenderung.druckerName = koerper.druckerName;
    if (koerper.sumatraPfad !== undefined) aenderung.sumatraPfad = koerper.sumatraPfad;
    if (koerper.digicamcontrolPfad !== undefined)
      aenderung.digicamcontrolPfad = koerper.digicamcontrolPfad;
    if (koerper.speicherWarnungGb !== undefined)
      aenderung.speicherWarnungGb = koerper.speicherWarnungGb;
    if (koerper.kamera) aenderung.kamera = koerper.kamera;
    if (koerper.kalibrierung) aenderung.kalibrierung = begrenzeKalibrierung(koerper.kalibrierung);
    if (koerper.besitzerPin) aenderung.besitzerPinHash = await hashePin(koerper.besitzerPin);

    schreibeGeraet(aenderung);
    betrieb.ladeTreiberNeu();
    if (koerper.kamera) await betrieb.kamera.setzeBelichtung(koerper.kamera).catch(() => undefined);
    return leseGeraet();
  });

  /** Kalibrier-Testbild drucken. Zaehlt nicht in den Auslagenersatz. */
  app.post<{ Body: unknown }>('/api/admin/geraet/kalibrierdruck', async (anfrage, antwort) => {
    const koerper = z
      .object({ preset: z.enum(['10x15-quer', '10x15-hoch']).default('10x15-quer') })
      .parse(anfrage.body ?? {});
    const event = holeAktivesEvent() ?? listeEvents()[0];
    if (!event) return antwort.code(409).send({ fehler: 'Es muss mindestens eine Veranstaltung geben.' });

    const canvas = CANVAS_PRESETS[koerper.preset];
    const bild = await kalibrierTestbild(canvas);
    const ordner = join(eventpfade(event.ordner).cache, 'testdrucke');
    await mkdir(ordner, { recursive: true });
    const pdf = join(ordner, `kalibrierung_${Date.now()}.pdf`);
    await schreibeDruckPdf(bild, pdf, { canvas, kalibrierung: leseGeraet().kalibrierung });

    const auftragId = reiheEin({
      eventId: event.id,
      ausgabeId: null,
      pfadPdf: pdf,
      kopien: 1,
      quelle: 'testdruck',
      berechnen: false,
    });
    return { auftragId };
  });

  // -------------------------------------------------------------- Vorlagen
  app.get('/api/admin/vorlagen', async () =>
    listeVorlagen().map((v) => ({ ...v, fotos: fotoEbenen(v).length })),
  );

  app.get<{ Params: { id: string } }>('/api/admin/vorlagen/:id', async (anfrage, antwort) => {
    const vorlage = holeVorlage(anfrage.params.id);
    return vorlage ?? antwort.code(404).send({ fehler: 'Nicht gefunden.' });
  });

  app.put<{ Body: unknown }>('/api/admin/vorlagen', async (anfrage) => {
    const koerper = z
      .object({
        id: z.string().optional(),
        name: z.string().min(1),
        preset: z.enum(['10x15-quer', '10x15-hoch']),
        hintergrundFarbe: z.string().optional(),
        ebenen: z.array(z.any()),
      })
      .parse(anfrage.body);

    return speichereVorlage({
      id: koerper.id ?? randomUUID(),
      name: koerper.name,
      canvas: CANVAS_PRESETS[koerper.preset as CanvasPreset],
      hintergrundFarbe: koerper.hintergrundFarbe,
      ebenen: koerper.ebenen as Ebene[],
    });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/vorlagen/:id', async (anfrage) => {
    loescheVorlage(anfrage.params.id);
    return { ok: true };
  });

  /**
   * "Bild aus Datei" - die Rueckfallebene fuer Canva und zugleich der Normalweg.
   * In Canva gestalten, als PNG exportieren, hier einfuegen, fertig.
   */
  app.post('/api/admin/vorlagen/bild', async (anfrage, antwort) => {
    const datei = await anfrage.file?.();
    if (!datei) return antwort.code(400).send({ fehler: 'Keine Datei empfangen.' });
    const erlaubt = ['.png', '.jpg', '.jpeg', '.webp'];
    const endung = extname(datei.filename).toLowerCase();
    if (!erlaubt.includes(endung)) {
      return antwort.code(400).send({ fehler: 'Nur PNG, JPEG oder WEBP.' });
    }
    await mkdir(wurzel.vorlagen, { recursive: true });
    const name = `${randomUUID()}${endung}`;
    await writeFile(join(wurzel.vorlagen, name), await datei.toBuffer());
    return { datei: name };
  });

  // --------------------------------------------------------------- Schriften

  /**
   * Die eigenen Schriften. Die feste Auswahlliste steht in den geteilten Typen;
   * hier kommt nur dazu, was der Nutzer selbst hinzugefuegt hat.
   */
  app.get('/api/admin/schriften', async () => listeSchriften(konfig.datenpfad));

  /**
   * Eine Schriftdatei hinzufuegen.
   *
   * Der Dateiname wird nicht uebernommen, sondern neu vergeben: Ein Name aus
   * der Anfrage darf nie einen Pfad bestimmen. Verworfen wird die Datei, wenn
   * sich kein Familienname aus ihr lesen laesst - dann ist es keine Schrift,
   * die der Renderer spaeter finden koennte.
   */
  app.post('/api/admin/schriften', async (anfrage, antwort) => {
    const datei = await anfrage.file?.();
    if (!datei) return antwort.code(400).send({ fehler: 'Keine Datei empfangen.' });
    const endung = extname(datei.filename).toLowerCase();
    if (!['.ttf', '.otf'].includes(endung)) {
      return antwort.code(400).send({ fehler: 'Nur TTF- oder OTF-Dateien.' });
    }

    const ordner = schriftenOrdner(konfig.datenpfad);
    await mkdir(ordner, { recursive: true });
    const name = `${randomUUID()}${endung}`;
    const pfad = join(ordner, name);
    await writeFile(pfad, await datei.toBuffer());

    const familie = familieAus(pfad);
    if (!familie) {
      await rm(pfad, { force: true });
      return antwort.code(400).send({ fehler: 'Aus der Datei liess sich kein Schriftname lesen.' });
    }

    protokolliere('info', 'schriften', `Schrift "${familie}" hinzugefuegt.`);
    return { datei: name, familie };
  });

  /** Die Schriftdatei selbst - der Browser braucht sie fuer die Editor-Vorschau. */
  app.get<{ Params: { datei: string } }>(
    '/api/admin/schriften/:datei',
    async (anfrage, antwort) => {
      // Nur die Kennungen, die wir selbst vergeben haben. Damit kann aus der
      // Adresse nie ein Pfad werden.
      const bekannt = listeSchriften(konfig.datenpfad).find(
        (s) => s.datei === anfrage.params.datei,
      );
      if (!bekannt) return antwort.code(404).send({ fehler: 'Schrift nicht gefunden.' });
      const pfad = join(schriftenOrdner(konfig.datenpfad), bekannt.datei);
      return antwort
        .type(bekannt.datei.endsWith('.otf') ? 'font/otf' : 'font/ttf')
        .send(createReadStream(pfad));
    },
  );

  app.delete<{ Params: { datei: string } }>(
    '/api/admin/schriften/:datei',
    async (anfrage, antwort) => {
      const bekannt = listeSchriften(konfig.datenpfad).find(
        (s) => s.datei === anfrage.params.datei,
      );
      if (!bekannt) return antwort.code(404).send({ fehler: 'Schrift nicht gefunden.' });
      await rm(join(schriftenOrdner(konfig.datenpfad), bekannt.datei), { force: true });
      return { ok: true };
    },
  );

  /**
   * Vorschaubild einer Vorlage fuer die Bibliothek.
   *
   * Anders als die Kiosk-Route haengt diese nicht an einer laufenden
   * Veranstaltung: Vorlagen werden am Schreibtisch gebaut, lange bevor ein
   * Event sie freigibt.
   */
  app.get<{ Params: { id: string } }>(
    '/api/admin/vorlagen/:id/vorschau.jpg',
    async (anfrage, antwort) => {
      const vorlage = holeVorlage(anfrage.params.id);
      if (!vorlage) return antwort.code(404).send({ fehler: 'Vorlage nicht gefunden.' });
      const bild = await vorlagenVorschau(vorlage, wurzel.vorlagen);
      return antwort.type('image/jpeg').header('Cache-Control', 'no-cache').send(bild);
    },
  );

  /** Layout-Testdruck mit Platzhaltern statt echter Fotos. */
  app.post<{ Params: { id: string } }>(
    '/api/admin/vorlagen/:id/testdruck',
    async (anfrage, antwort) => {
      const vorlage = holeVorlage(anfrage.params.id);
      if (!vorlage) return antwort.code(404).send({ fehler: 'Vorlage nicht gefunden.' });
      const event = holeAktivesEvent() ?? listeEvents()[0];
      if (!event) return antwort.code(409).send({ fehler: 'Es muss eine Veranstaltung geben.' });

      const fotos = new Map<number, Buffer>();
      for (const ebene of fotoEbenen(vorlage)) {
        fotos.set(ebene.index, await platzhalterFoto(ebene.index));
      }
      const layout = await baueLayout(
        vorlage,
        {
          fotos,
          assetsOrdner: wurzel.vorlagen,
          platzhalter: {
            veranstaltung: event.name,
            datum: new Date(event.datum).toLocaleDateString('de-DE'),
            uhrzeit: '12:00',
            nummer: '42',
          },
        },
        layoutMasse(vorlage),
      );

      const ordner = join(eventpfade(event.ordner).cache, 'testdrucke');
      await mkdir(ordner, { recursive: true });
      const pdf = join(ordner, `layout_${vorlage.id}_${Date.now()}.pdf`);
      await schreibeDruckPdf(layout, pdf, {
        canvas: vorlage.canvas,
        kalibrierung: leseGeraet().kalibrierung,
      });

      const auftragId = reiheEin({
        eventId: event.id,
        ausgabeId: null,
        pfadPdf: pdf,
        kopien: 1,
        quelle: 'testdruck',
        berechnen: false,
      });
      return { auftragId };
    },
  );

  // ---------------------------------------------------------------- Filter
  app.get('/api/admin/filter', async () => listeFilter());

  app.put<{ Body: unknown }>('/api/admin/filter', async (anfrage) => {
    const koerper = z
      .object({ id: z.string().optional(), name: z.string().min(1), operationen: z.array(z.any()) })
      .parse(anfrage.body);
    const gespeichert = speichereFilter({
      id: koerper.id ?? randomUUID(),
      name: koerper.name,
      operationen: koerper.operationen as never,
    });
    // Die Vorschaukachel im Kiosk zeigt sonst weiter den alten Look.
    leereVorschauLager();
    return gespeichert;
  });

  app.delete<{ Params: { id: string } }>('/api/admin/filter/:id', async (anfrage) => {
    loescheFilter(anfrage.params.id);
    leereVorschauLager();
    return { ok: true };
  });

  // --------------------------------------------------------- Veranstaltungen
  app.get('/api/admin/events', async () =>
    listeEvents().map((e) => ({ ...e, betreuerPinHash: undefined, auslagen: berechneAuslagen(e) })),
  );

  app.get<{ Params: { id: string } }>('/api/admin/events/:id', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    return {
      ...event,
      betreuerPinHash: undefined,
      betreuerPinGesetzt: event.betreuerPinHash !== null,
      auslagen: berechneAuslagen(event),
      druckauftraege: listeAuftraege(event.id).slice(0, 50),
    };
  });

  app.post<{ Body: unknown }>('/api/admin/events', async (anfrage) => {
    const koerper = z
      .object({ name: z.string().min(1), datum: z.string().min(4) })
      .parse(anfrage.body);
    return erstelleEvent(koerper, wurzel.events);
  });

  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id',
    async (anfrage, antwort) => {
      const koerper = z
        .object({
          name: z.string().min(1).optional(),
          datum: z.string().min(4).optional(),
          betreuerPin: z.string().min(4).max(32).optional(),
          einstellungen: z.record(z.any()).optional(),
        })
        .parse(anfrage.body);

      try {
        return aktualisiereEvent(anfrage.params.id, {
          name: koerper.name,
          datum: koerper.datum,
          einstellungen: koerper.einstellungen as never,
          ...(koerper.betreuerPin ? { betreuerPinHash: await hashePin(koerper.betreuerPin) } : {}),
        });
      } catch (fehler) {
        return antwort.code(400).send({ fehler: (fehler as Error).message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id/status',
    async (anfrage, antwort) => {
      const koerper = z
        .object({
          status: z.enum(['entwurf', 'startbereit', 'aktiv', 'pausiert', 'abgeschlossen', 'archiviert']),
        })
        .parse(anfrage.body);
      try {
        const event = setzeStatus(anfrage.params.id, koerper.status);
        if (koerper.status === 'abgeschlossen') await schreibeAuslagenCsv(event);
        if (koerper.status === 'aktiv') await betrieb.starteLiveView();
        protokolliere('info', 'event', `"${event.name}" ist jetzt ${koerper.status}.`);
        return event;
      } catch (fehler) {
        return antwort.code(409).send({ fehler: (fehler as Error).message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id/probelauf',
    async (anfrage) => {
      const koerper = z.object({ an: z.boolean() }).parse(anfrage.body);
      return setzeProbelauf(anfrage.params.id, koerper.an);
    },
  );

  app.post<{ Params: { id: string } }>('/api/admin/events/:id/galerie-token', async (anfrage) =>
    erneuereGalerieToken(anfrage.params.id),
  );

  app.get<{ Params: { id: string } }>('/api/admin/events/:id/startbereit', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    return startbereitPruefung(event, betrieb, konfig);
  });

  app.get<{ Params: { id: string } }>('/api/admin/events/:id/auslagen.csv', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send();
    const pfad = await schreibeAuslagenCsv(event);
    protokolliere('info', 'auslagen', `CSV geschrieben: ${pfad}`);
    const { alsCsv } = await import('../fach/auslagen.js');
    return antwort
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="auslagen.csv"')
      .send(alsCsv(berechneAuslagen(event)));
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/druck/:id/berechnen',
    async (anfrage) => {
      const koerper = z.object({ berechnen: z.boolean() }).parse(anfrage.body);
      setzeBerechnen(anfrage.params.id, koerper.berechnen);
      return { ok: true };
    },
  );

  // ------------------------------------------------------- Uebergabe
  /**
   * Uebergabe an den Gastgeber. Erst nach verifizierter Kopie wird Vollzug
   * gemeldet - eine Markerdatei muss drueben ankommen und die Dateizahl
   * stimmen.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id/uebergabe',
    async (anfrage, antwort) => {
      const koerper = z.object({ ziel: z.string().min(2) }).parse(anfrage.body);
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      try {
        const ergebnis = await uebergebeAufDatentraeger(event, koerper.ziel);
        protokolliere(
          ergebnis.geprueft ? 'info' : 'warnung',
          'uebergabe',
          `${event.name}: ${ergebnis.meldung}`,
        );
        return ergebnis;
      } catch (fehler) {
        return antwort.code(500).send({ fehler: (fehler as Error).message });
      }
    },
  );

  /** Ordner uebergabefertig machen, ohne zu kopieren. */
  app.post<{ Params: { id: string } }>(
    '/api/admin/events/:id/uebergabe-vorbereiten',
    async (anfrage, antwort) => {
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      await bereiteUebergabeVor(event);
      return { ok: true, ordner: event.ordner };
    },
  );

  // ------------------------------------------------------ Unterlagen
  /**
   * Zwei Zettel mit unterschiedlichen Lesern: Die Kurzanleitung mit der PIN
   * kommt in die Box, der QR-Aushang aussen dran.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id/unterlagen',
    async (anfrage, antwort) => {
      const koerper = z
        .object({
          betreuerPin: z.string().default(''),
          telefon: z.string().default(''),
          wlanName: z.string().optional(),
          wlanPasswort: z.string().optional(),
        })
        .parse(anfrage.body ?? {});
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });

      const adresse = lanAdresse();
      const galerieUrl =
        event.einstellungen.galerieAktiv && adresse
          ? `http://${adresse}:${konfig.portOeffentlich}/g/${event.galerieToken}`
          : undefined;

      const angaben = { ...koerper, galerieUrl };
      const kurzanleitung = await schreibeKurzanleitung(event, angaben);
      const aushang = event.einstellungen.galerieAktiv
        ? await schreibeAushang(event, angaben)
        : null;
      return { kurzanleitung, aushang };
    },
  );

  /** Erfasste E-Mail-Adressen nach der eingestellten Frist loeschen. */
  app.post<{ Params: { id: string } }>(
    '/api/admin/events/:id/adressen-aufraeumen',
    async (anfrage, antwort) => {
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      const anzahl = loescheAlteAdressen(event);
      return { geloescht: anzahl };
    },
  );

  app.get('/api/admin/status', async () => betrieb.status());
}
