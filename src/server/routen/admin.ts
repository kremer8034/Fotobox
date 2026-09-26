import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  EINSTELLUNGEN_EINGABE,
  ersteMeldung,
  EVENT_DATUM,
  EVENT_NAME,
  PIN_EINGABE,
} from '../fach/einstellungen-pruefung.js';
import sharp from 'sharp';
import { leseGeraet, leseMailPasswort, schreibeGeraet, schreibeMailPasswort, begrenzeKalibrierung } from '../db/geraet.js';
import {
  aktualisiereEvent,
  erneuereGalerieToken,
  erneuereStatusToken,
  erstelleEvent,
  holeAktivesEvent,
  holeEvent,
  listeEvents,
  loescheEvent,
  setzeProbelauf,
  setzeStatus,
} from '../fach/events.js';
import {
  beschreibePruefung,
  holeVorlage,
  listeVorlagen,
  loescheVorlage,
  speichereVorlage,
  VORLAGE_EINGABE,
  vorlageInVeranstaltungen,
} from '../fach/vorlagen.js';
import { FILTER_EINGABE, holeFilter, listeFilter, loescheFilter, speichereFilter } from '../fach/filter.js';
import { parseCube } from '../bild/lut.js';
import { berechneAuslagen, schreibeAuslagenCsv } from '../fach/auslagen.js';
import { listeAuftraege, reiheEin, setzeBerechnen, stelleFremdeZurueck } from '../fach/druckwarteschlange.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { hashePin, pruefePin } from '../fach/pin.js';
import { baueLayout, layoutMasse } from '../bild/layout.js';
import { schreibeDruckPdf } from '../bild/pdf.js';
import { kalibrierTestbild, platzhalterFoto } from '../bild/testbilder.js';
import { filterVorschau, leereVorschauLager, vorlagenVorschau } from '../bild/vorschau.js';
import { familieAus, listeSchriften, schriftenOrdner } from '../fach/schriften.js';
import { startbereitPruefung } from '../fach/startbereit.js';
import { bereiteUebergabeVor, uebergebeAufDatentraeger } from '../fach/uebergabe.js';
import { schreibeAushang, schreibeKurzanleitung } from '../fach/unterlagen.js';
import {
  leseMailzugang,
  listeAdressen,
  loescheAdresse,
  loescheAlleAdressen,
  loescheAlteAdressen,
  pruefeAdresse,
  schwaerze,
  sendeTestmail,
} from '../fach/email.js';
import { galerieUrl as galerieAdresse, lanAdresse } from '../netzwerk.js';
import { CANVAS_PRESETS, fotoEbenen, type CanvasPreset, type Ebene, type FilterOperation, type Veranstaltung } from '../../shared/typen.js';
import { protokolliere, type Betrieb } from '../betrieb.js';
import { holeDb } from '../db/index.js';
import type { Konfig } from '../konfig.js';

/**
 * Admin-Routen. Ausschliesslich ueber 127.0.0.1 erreichbar - ein Gast im WLAN
 * kann diese Adresse nicht einmal aufrufen.
 */
export function registriereAdmin(app: FastifyInstance, betrieb: Betrieb, konfig: Konfig): void {
  const wurzel = wurzelpfade(konfig.datenpfad);

  // ---------------------------------------------------------------- Geraet
  /**
   * Die Geraeteeinstellungen, wie sie der Browser sehen darf: ohne PIN-Hash
   * und ohne Mailpasswort - nur, ob sie gesetzt sind. Vorher gab die Antwort
   * auf das Speichern den PIN-Hash mit zurueck.
   */
  function geraetFuerBrowser() {
    const geraet = leseGeraet();
    return {
      ...geraet,
      besitzerPinGesetzt: geraet.besitzerPinHash !== null,
      besitzerPinHash: undefined,
      mailPasswortGesetzt: leseMailPasswort() !== '',
      lanAdresse: lanAdresse(),
      hardware: konfig.echteHardware ? 'echt' : 'mock',
    };
  }

  app.get('/api/admin/geraet', async () => geraetFuerBrowser());

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
        besitzerPin: PIN_EINGABE.optional(),
        mail: z
          .object({
            host: z.string().trim().min(1).max(200),
            port: z.number().int().min(1).max(65535),
            benutzer: z.string().trim().max(200),
            absender: z.string().trim().min(3).max(200),
          })
          .nullable()
          .optional(),
        // Leer oder weggelassen: bleibt, wie es ist. Das Feld in der
        // Verwaltung ist immer leer - das gespeicherte Passwort kommt nie zurueck.
        mailPasswort: z.string().max(200).optional(),
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
    if (koerper.mail !== undefined) aenderung.mail = koerper.mail;

    schreibeGeraet(aenderung);
    if (koerper.mail === null) schreibeMailPasswort(null);
    else if (koerper.mailPasswort) schreibeMailPasswort(koerper.mailPasswort);
    betrieb.ladeTreiberNeu();
    if (koerper.kamera) await betrieb.kamera.setzeBelichtung(koerper.kamera).catch(() => undefined);
    return geraetFuerBrowser();
  });

  /**
   * Testmail an eine Adresse des Besitzers - prueft Server, Anmeldung und
   * Verschluesselung, bevor der erste Gast auf "Per E-Mail" tippt.
   */
  app.post<{ Body: unknown }>('/api/admin/geraet/testmail', async (anfrage, antwort) => {
    const { an } = z.object({ an: z.string().max(254) }).parse(anfrage.body);
    if (!pruefeAdresse(an)) return antwort.code(400).send({ fehler: 'Diese Adresse sieht nicht richtig aus.' });
    const zugang = leseMailzugang();
    if (!zugang) return antwort.code(409).send({ fehler: 'Erst Server, Absender und Passwort eintragen.' });
    try {
      await sendeTestmail(an, zugang);
      return { ok: true };
    } catch (fehler) {
      const text = schwaerze((fehler as Error).message);
      protokolliere('warnung', 'email', `Testmail: ${text}`);
      return antwort.code(502).send({ fehler: `Hat nicht geklappt: ${text}` });
    }
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

  app.put<{ Body: unknown }>('/api/admin/vorlagen', async (anfrage, antwort) => {
    const geprueft = VORLAGE_EINGABE.safeParse(anfrage.body);
    if (!geprueft.success) {
      const ebenen = (anfrage.body as { ebenen?: unknown } | null)?.ebenen;
      return antwort.code(400).send({ fehler: beschreibePruefung(geprueft.error, ebenen) });
    }
    const koerper = geprueft.data;
    return speichereVorlage({
      id: koerper.id || randomUUID(),
      name: koerper.name,
      canvas: CANVAS_PRESETS[koerper.preset as CanvasPreset],
      hintergrundFarbe: koerper.hintergrundFarbe,
      ebenen: koerper.ebenen as Ebene[],
    });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/vorlagen/:id', async (anfrage, antwort) => {
    // Eine Vorlage, mit der gerade gefeiert wird, bleibt. Sonst verschwaende
    // sie mitten im Abend vom Bildschirm - und war sie die einzige, stuende
    // der Kiosk ohne Auswahl da.
    const laufend = vorlageInVeranstaltungen(anfrage.params.id).find(
      (e) => e.status === 'aktiv' || e.status === 'pausiert',
    );
    if (laufend) {
      return antwort
        .code(409)
        .send({ fehler: `"${laufend.name}" läuft gerade mit dieser Vorlage. Erst danach löschen.` });
    }
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
    // Die Endung allein sagt nichts: Erst wenn sharp die Datei als Bild liest,
    // kommt sie in den Vorlagenordner. Die Masse gehen zurueck, damit der
    // Editor das Bild im richtigen Seitenverhaeltnis einsetzt statt es auf
    // die ganze Seite zu verzerren.
    const inhalt = await datei.toBuffer();
    let masse: { breite: number; hoehe: number };
    try {
      const info = await sharp(inhalt).metadata();
      if (!info.width || !info.height || !['png', 'jpeg', 'webp'].includes(info.format ?? '')) throw new Error();
      const gedreht = (info.orientation ?? 1) >= 5;
      masse = gedreht ? { breite: info.height, hoehe: info.width } : { breite: info.width, hoehe: info.height };
    } catch {
      return antwort.code(400).send({ fehler: 'Die Datei ist kein lesbares PNG-, JPEG- oder WEBP-Bild.' });
    }
    await mkdir(wurzel.vorlagen, { recursive: true });
    const name = `${randomUUID()}${endung === '.jpeg' ? '.jpg' : endung}`;
    await writeFile(join(wurzel.vorlagen, name), inhalt);
    return { datei: name, ...masse };
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
      // Nach Aufnahmenummer, wie in der echten Sitzung - siehe fotoPlaetze().
      for (let nummer = 1; nummer <= fotoEbenen(vorlage).length; nummer += 1) {
        fotos.set(nummer, await platzhalterFoto(nummer));
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

  app.put<{ Body: unknown }>('/api/admin/filter', async (anfrage, antwort) => {
    const koerper = FILTER_EINGABE.parse(anfrage.body);
    const vorhanden = koerper.id ? holeFilter(koerper.id) : null;
    if (vorhanden?.eingebaut) {
      return antwort.code(409).send({ fehler: 'Eingebaute Filter bleiben, wie sie sind. Leg eine Kopie an.' });
    }
    const gespeichert = speichereFilter({
      id: koerper.id ?? randomUUID(),
      name: koerper.name,
      operationen: koerper.operationen as FilterOperation[],
    });
    // Die Vorschaukachel im Kiosk zeigt sonst weiter den alten Look.
    leereVorschauLager();
    return gespeichert;
  });

  app.delete<{ Params: { id: string } }>('/api/admin/filter/:id', async (anfrage, antwort) => {
    const filter = holeFilter(anfrage.params.id);
    if (!filter) return antwort.code(404).send({ fehler: 'Filter nicht gefunden.' });
    if (filter.eingebaut) return antwort.code(409).send({ fehler: 'Eingebaute Filter lassen sich nicht löschen.' });
    loescheFilter(filter.id);
    // Die LUT-Datei mit, wenn kein anderer Filter sie nutzt.
    for (const op of filter.operationen) {
      if (op.op !== 'lut') continue;
      const nochGenutzt = listeFilter().some((f) => f.operationen.some((o) => o.op === 'lut' && o.datei === op.datei));
      if (!nochGenutzt) await rm(join(wurzel.luts, op.datei), { force: true });
    }
    leereVorschauLager();
    return { ok: true };
  });

  /**
   * Eigene Looks als .cube-LUT importieren - aus Lightroom, Photoshop oder
   * DaVinci. Laut Plan gehoerte das von Anfang an dazu; der Renderer konnte
   * LUTs anwenden, aber es gab keinen Weg, eine hineinzubekommen.
   */
  app.post('/api/admin/filter/lut', async (anfrage, antwort) => {
    const datei = await anfrage.file?.();
    if (!datei) return antwort.code(400).send({ fehler: 'Keine Datei empfangen.' });
    if (extname(datei.filename).toLowerCase() !== '.cube') {
      return antwort.code(400).send({ fehler: 'Nur .cube-Dateien.' });
    }
    const inhalt = (await datei.toBuffer()).toString('utf8');
    try {
      parseCube(inhalt);
    } catch (fehler) {
      return antwort.code(400).send({ fehler: `Die Datei ist keine brauchbare LUT: ${(fehler as Error).message}` });
    }
    await mkdir(wurzel.luts, { recursive: true });
    const name = `${randomUUID()}.cube`;
    await writeFile(join(wurzel.luts, name), inhalt, 'utf8');
    const anzeigename =
      basename(datei.filename, extname(datei.filename)).replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Eigener Look';
    const preset = speichereFilter({
      id: randomUUID(),
      name: anzeigename,
      operationen: [{ op: 'lut', datei: name }],
    });
    protokolliere('info', 'filter', `LUT "${anzeigename}" importiert.`);
    return preset;
  });

  /** Vorschau eines Filters am Muster - fuer die Filterseite der Verwaltung. */
  app.get<{ Params: { id: string } }>('/api/admin/filter/:id/vorschau.jpg', async (anfrage, antwort) => {
    const filter = holeFilter(anfrage.params.id);
    if (!filter) return antwort.code(404).send({ fehler: 'Filter nicht gefunden.' });
    const bild = await filterVorschau(filter, wurzel.luts);
    return antwort.type('image/jpeg').header('Cache-Control', 'no-cache').send(bild);
  });

  // --------------------------------------------------------- Veranstaltungen

  /**
   * Eine Veranstaltung, wie sie der Browser sehen darf. Die Antworten auf
   * Speichern, Statuswechsel und Co. gaben vorher das rohe Objekt zurueck -
   * samt Hash der Betreuer-PIN.
   */
  function eventFuerBrowser(event: Veranstaltung) {
    return { ...event, betreuerPinHash: undefined, betreuerPinGesetzt: event.betreuerPinHash !== null };
  }
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

  app.post<{ Body: unknown }>('/api/admin/events', async (anfrage, antwort) => {
    const geprueft = z.object({ name: EVENT_NAME, datum: EVENT_DATUM }).safeParse(anfrage.body);
    if (!geprueft.success) return antwort.code(400).send({ fehler: ersteMeldung(geprueft.error) });
    return eventFuerBrowser(erstelleEvent(geprueft.data, wurzel.events));
  });

  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id',
    async (anfrage, antwort) => {
      const geprueft = z
        .object({
          name: EVENT_NAME.optional(),
          datum: EVENT_DATUM.optional(),
          betreuerPin: PIN_EINGABE.optional(),
          einstellungen: EINSTELLUNGEN_EINGABE.optional(),
        })
        .strict()
        .safeParse(anfrage.body);
      if (!geprueft.success) return antwort.code(400).send({ fehler: ersteMeldung(geprueft.error) });
      const koerper = geprueft.data;

      try {
        return eventFuerBrowser(aktualisiereEvent(anfrage.params.id, {
          name: koerper.name,
          datum: koerper.datum,
          einstellungen: koerper.einstellungen as never,
          ...(koerper.betreuerPin ? { betreuerPinHash: await hashePin(koerper.betreuerPin) } : {}),
        }));
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
        const vorher = holeEvent(anfrage.params.id)?.status;
        const event = setzeStatus(anfrage.params.id, koerper.status);
        if (koerper.status === 'abgeschlossen') await schreibeAuslagenCsv(event);
        if (koerper.status === 'aktiv' && vorher !== 'pausiert' && vorher !== 'aktiv') {
          // Liegengebliebene Drucke frueherer Feiern gehen hier nicht mehr raus.
          const zurueck = stelleFremdeZurueck(event.id);
          if (zurueck > 0) {
            protokolliere('warnung', 'druck', `${zurueck} wartende Drucke frueherer Veranstaltungen zurueckgestellt.`);
          }
        }
        if (koerper.status === 'aktiv') await betrieb.starteLiveView();
        protokolliere('info', 'event', `"${event.name}" ist jetzt ${koerper.status}.`);
        return eventFuerBrowser(event);
      } catch (fehler) {
        return antwort.code(409).send({ fehler: (fehler as Error).message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id/probelauf',
    async (anfrage) => {
      const koerper = z.object({ an: z.boolean() }).parse(anfrage.body);
      return eventFuerBrowser(setzeProbelauf(anfrage.params.id, koerper.an));
    },
  );

  /**
   * Eine Veranstaltung samt allen Fotos von der Box loeschen - nach der
   * Uebergabe an den Gastgeber. Die Fotos fremder Leute sollen nicht
   * monatelang auf einem Rechner liegen, der herumgereicht wird. Laut Plan
   * gehoerte das dazu; bisher gab es keinen Weg.
   *
   * Nur fuer abgeschlossene oder archivierte Veranstaltungen, und nur, wenn der
   * Name zur Bestaetigung genau eingetippt wird.
   */
  app.delete<{ Params: { id: string }; Body: unknown }>('/api/admin/events/:id', async (anfrage, antwort) => {
    const { bestaetigung } = z.object({ bestaetigung: z.string() }).parse(anfrage.body ?? {});
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    if (event.status !== 'abgeschlossen' && event.status !== 'archiviert') {
      return antwort.code(409).send({ fehler: 'Nur abgeschlossene oder archivierte Veranstaltungen lassen sich löschen.' });
    }
    if (bestaetigung.trim() !== event.name) {
      return antwort.code(400).send({ fehler: 'Zur Bestätigung bitte den Namen genau so eintippen, wie er dasteht.' });
    }
    // Nur innerhalb des Event-Ordners loeschen - nie etwas anderes.
    const ordner = resolve(event.ordner);
    const wurzelEvents = resolve(wurzel.events);
    if (!ordner.startsWith(wurzelEvents + sep) || ordner === wurzelEvents) {
      return antwort.code(409).send({ fehler: 'Der Ordner liegt nicht im Event-Verzeichnis - er wird nicht angefasst.' });
    }
    await rm(ordner, { recursive: true, force: true });
    loescheEvent(event.id);
    protokolliere('info', 'event', `"${event.name}" samt Fotos von der Box gelöscht.`);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/events/:id/galerie-token', async (anfrage) =>
    eventFuerBrowser(erneuereGalerieToken(anfrage.params.id)),
  );

  app.post<{ Params: { id: string } }>('/api/admin/events/:id/status-token', async (anfrage) =>
    eventFuerBrowser(erneuereStatusToken(anfrage.params.id)),
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
          betreuerPin: z.string().max(8),
          telefon: z.string().max(40).default(''),
          wlanName: z.string().max(64).optional(),
          wlanPasswort: z.string().max(64).optional(),
        })
        .parse(anfrage.body ?? {});
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });

      // Die Kurzanleitung ist der Zettel, mit dem der Gastgeber allein
      // zurechtkommen muss - die PIN darauf muss stimmen. Gespeichert ist sie
      // nur als Hash; vorher stand bei einem spaeter erzeugten Zettel deshalb
      // "(im Admin gesetzt)" statt einer PIN darauf.
      if (!event.betreuerPinHash) {
        return antwort.code(409).send({ fehler: 'Erst unter "Aussehen & PIN" eine Betreuer-PIN setzen.' });
      }
      if (!(await pruefePin(koerper.betreuerPin, event.betreuerPinHash))) {
        return antwort
          .code(400)
          .send({ fehler: 'Diese PIN stimmt nicht mit der gesetzten Betreuer-PIN überein - sie kommt so auf den Zettel.' });
      }

      const galerieUrl = event.einstellungen.galerieAktiv
        ? (galerieAdresse(event.galerieToken, konfig.portOeffentlich) ?? undefined)
        : undefined;

      const angaben = { ...koerper, galerieUrl };
      const kurzanleitung = await schreibeKurzanleitung(event, angaben);
      const aushang = event.einstellungen.galerieAktiv
        ? await schreibeAushang(event, angaben)
        : null;
      return {
        kurzanleitung,
        aushang,
        links: {
          kurzanleitung: `/api/admin/events/${event.id}/unterlagen/kurzanleitung.pdf`,
          aushang: aushang ? `/api/admin/events/${event.id}/unterlagen/aushang.pdf` : null,
        },
      };
    },
  );

  /** Die erzeugten Zettel zum Ansehen und Drucken - ohne sie auf der Platte zu suchen. */
  app.get<{ Params: { id: string; art: string } }>(
    '/api/admin/events/:id/unterlagen/:art',
    async (anfrage, antwort) => {
      const event = holeEvent(anfrage.params.id);
      const datei = { 'kurzanleitung.pdf': 'kurzanleitung.pdf', 'aushang.pdf': 'qr-aushang.pdf' }[anfrage.params.art];
      if (!event || !datei) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      const pfad = join(eventpfade(event.ordner).cache, 'unterlagen', datei);
      if (!existsSync(pfad)) return antwort.code(404).send({ fehler: 'Noch nicht erzeugt.' });
      return antwort.type('application/pdf').header('Cache-Control', 'no-store').send(createReadStream(pfad));
    },
  );

  /** Erfasste E-Mail-Adressen einer Veranstaltung - fuer Auskunft und Loeschung. */
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/adressen', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    return { loeschfristTage: event.einstellungen.emailLoeschfristTage, adressen: listeAdressen(event.id) };
  });

  /** Eine Adresse sofort loeschen - etwa wenn ein Gast darum bittet. */
  app.delete<{ Params: { id: string; versandId: string } }>(
    '/api/admin/events/:id/adressen/:versandId',
    async (anfrage, antwort) => {
      const eintrag = listeAdressen(anfrage.params.id).find((a) => a.id === anfrage.params.versandId);
      if (!eintrag) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      loescheAdresse(eintrag.id);
      protokolliere('info', 'email', 'Eine E-Mail-Adresse auf Wunsch geloescht.');
      return { ok: true };
    },
  );

  /** Alle Adressen einer Veranstaltung sofort loeschen. */
  app.delete<{ Params: { id: string } }>('/api/admin/events/:id/adressen', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    const geloescht = loescheAlleAdressen(event.id);
    protokolliere('info', 'email', `${geloescht} E-Mail-Adresse(n) von "${event.name}" geloescht.`);
    return { geloescht };
  });

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

  /**
   * Was schiefging: Warnungen und Fehler aus dem Protokoll, neueste zuerst.
   * Die Box steht meist ohne ihren Besitzer beim Kunden - hier liest er
   * hinterher nach, ob die Kamera gehakt hat oder der Server neu starten musste.
   */
  app.get('/api/admin/protokoll', async () =>
    holeDb()
      .prepare(
        `SELECT zeit, ebene, bereich, text FROM protokoll
          WHERE ebene IN ('warnung', 'fehler')
          ORDER BY zeit DESC LIMIT 50`,
      )
      .all(),
  );
}
