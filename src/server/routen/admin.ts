import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
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
import { PORTAL_ADRESSE, portalNetzEingerichtet } from '../portal/adresse.js';
import { gleichePortalAb, holePortal } from '../portal/steuerung.js';

/** Zustand der Portal-Dienste in diesem Augenblick - die Diagnose fragt mehrmals. */
const portalZustand = () => holePortal()?.zustand() ?? null;
import { leseRohdiagnose, portalDiagnose, richteNetzEin, setzeNetzZurueck, waehleAdapter } from '../portal/diagnose.js';
import { leseGeraet, leseMailPasswort, schreibeGeraet, schreibeMailPasswort, begrenzeKalibrierung } from '../db/geraet.js';
import {
  aktualisiereEvent,
  erneuereGalerieToken,
  erneuereStatusToken,
  dupliziereEvent,
  erstelleEvent,
  holeAktivesEvent,
  holeEvent,
  listeEvents,
  loescheEvent,
  merkeBetreuerPin,
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
import {
  letzteAuftraege,
  listeAuftraege,
  offeneAuftraege,
  reiheEin,
  setzeBerechnen,
  stelleFremdeZurueck,
  verwirfWartende,
} from '../fach/druckwarteschlange.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { hashePin, pruefePin } from '../fach/pin.js';
import { baueLayout, layoutMasse } from '../bild/layout.js';
import { schreibeDruckPdf } from '../bild/pdf.js';
import { kalibrierTestbild, platzhalterFoto } from '../bild/testbilder.js';
import { filterVorschau, leereVorschauLager, vorlagenVorschau } from '../bild/vorschau.js';
import { familieAus, listeSchriften, schriftenOrdner } from '../fach/schriften.js';
import { startbereitPruefung } from '../fach/startbereit.js';
import { uebergebeAufDatentraeger } from '../fach/uebergabe.js';
import { baueGaestebuchPdf, erzeugeGaestebuchPdf, fotosOhneGruss, gruesseVon } from '../fach/gaestebuch.js';
import { oeffneDiashowFenster, schliesseDiashowFenster } from '../fach/kiosk-browser.js';
import { waehleOrdner } from '../fach/ordnerdialog.js';
import { erzeugeKurzanleitung, schreibePortalAushang } from '../fach/unterlagen.js';
import {
  absenderVollstaendig,
  leseMailzugang,
  listeAdressen,
  loescheAdresse,
  loescheAlleAdressen,
  loescheAlteAdressen,
  pruefeAdresse,
  schwaerze,
  sendeTestmail,
} from '../fach/email.js';
import {
  aktualisiereRoutenAdresse,
  galerieBlockiert,
  galerieUrl as galerieAdresse,
  lanAdresse,
  netzDiagnose,
} from '../netzwerk.js';
import { CANVAS_PRESETS, fotoEbenen, type CanvasPreset, type Ebene, type FilterOperation, type Veranstaltung } from '../../shared/typen.js';
import { protokolliere, type Betrieb } from '../betrieb.js';
import { holeDb } from '../db/index.js';
import type { Konfig } from '../konfig.js';
import {
  holeVoreinstellung,
  listeVoreinstellungen,
  loescheVoreinstellung,
  speichereVoreinstellung,
  uebernehmbar,
} from '../fach/voreinstellungen.js';
import { Aktualisierer, pruefeAufUpdate, type UpdateInfo } from '../fach/aktualisierung.js';
import { VERSION } from '../version.js';

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

  // Alle Drucker, die Windows kennt, DNP zuerst - zum Auswaehlen statt Abtippen.
  app.get('/api/admin/drucker/liste', async () => {
    try {
      return { drucker: await betrieb.druckerListe(), fehler: null };
    } catch (fehler) {
      return { drucker: [], fehler: fehler instanceof Error ? fehler.message : String(fehler) };
    }
  });

  /**
   * Wo die Handy-Galerie im Netz steht und ob Windows die Handys durchlaesst:
   * volle Adresse, WLAN-Name, Netzwerkprofil. Damit laesst sich "auf dem
   * Handy laedt nichts" in einem Blick klaeren.
   */
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/galerie-netz', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    await aktualisiereRoutenAdresse();
    const adresse = lanAdresse();
    const diagnose = adresse ? await netzDiagnose(adresse) : null;
    return {
      url: galerieAdresse(event.galerieToken, konfig.portOeffentlich),
      netz: diagnose?.netz ?? null,
      kategorie: diagnose?.kategorie ?? null,
      hinweis: !adresse
        ? 'Die Box hat keine Netzwerkverbindung. Ist das WLAN verbunden?'
        : diagnose
          ? galerieBlockiert(diagnose)
          : null,
    };
  });

  /**
   * Windows-Ordnerdialog fuer die Uebergabe - etwa ein Ordner in OneDrive
   * oder ein USB-Stick. Er erscheint auf dem Bildschirm der Box; die Antwort
   * kommt, sobald dort gewaehlt oder abgebrochen wurde.
   */
  app.post<{ Body: unknown }>('/api/admin/ordner/waehlen', async (anfrage, antwort) => {
    const { start } = z.object({ start: z.string().max(500).default('') }).parse(anfrage.body ?? {});
    try {
      return { pfad: await waehleOrdner('Ziel für die Übergabe wählen', start) };
    } catch (fehler) {
      return antwort.code(409).send({ fehler: (fehler as Error).message });
    }
  });

  /** Papiervorrat laut DNP-Drucker - der zuletzt gelesene Stand. */
  app.get('/api/admin/drucker/vorrat', async () => ({
    vorrat: betrieb.druckerVorrat(),
    hinweis: betrieb.vorratHinweis ?? (betrieb.vorratLesbar() ? null : 'Nur mit einem DNP-Drucker unter Windows.'),
  }));

  /** Papiervorrat jetzt beim Drucker lesen - nur, wenn er gerade nicht druckt. */
  app.post('/api/admin/drucker/vorrat', async () => {
    await betrieb.leseDruckerVorrat();
    return { vorrat: betrieb.druckerVorrat(), hinweis: betrieb.vorratHinweis };
  });

  app.put<{ Body: unknown }>('/api/admin/geraet', async (anfrage, antwort) => {
    const koerper = z
      .object({
        druckerName: z.string().optional(),
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
          .refine((m) => absenderVollstaendig(m.absender, m.benutzer), {
            message:
              'Der Absender braucht eine Mailadresse - etwa „Fotobox <fotobox@example.de>“. Steht als Benutzername eine Mailadresse, reicht auch nur der Name.',
          })
          .nullable()
          .optional(),
        // Leer oder weggelassen: bleibt, wie es ist. Das Feld in der
        // Verwaltung ist immer leer - das gespeicherte Passwort kommt nie zurueck.
        mailPasswort: z.string().max(200).optional(),
        portalAktiv: z.boolean().optional(),
        wlan: z
          .object({ name: z.string().trim().min(1).max(32), passwort: z.string().max(63) })
          .nullable()
          .optional(),
      })
      .parse(anfrage.body);

    const aenderung: Parameters<typeof schreibeGeraet>[0] = {};
    if (koerper.druckerName !== undefined) aenderung.druckerName = koerper.druckerName;
    if (koerper.digicamcontrolPfad !== undefined)
      aenderung.digicamcontrolPfad = koerper.digicamcontrolPfad;
    if (koerper.speicherWarnungGb !== undefined)
      aenderung.speicherWarnungGb = koerper.speicherWarnungGb;
    if (koerper.kamera) aenderung.kamera = koerper.kamera;
    if (koerper.kalibrierung) aenderung.kalibrierung = begrenzeKalibrierung(koerper.kalibrierung);
    if (koerper.besitzerPin) aenderung.besitzerPinHash = await hashePin(koerper.besitzerPin);
    if (koerper.mail !== undefined) aenderung.mail = koerper.mail;
    if (koerper.wlan !== undefined) aenderung.wlan = koerper.wlan;
    if (koerper.portalAktiv !== undefined) {
      // Einschalten nur, wenn das Netz dafuer eingerichtet ist - sonst liefe
      // nichts, und der Schalter taeuschte ein Portal vor.
      if (koerper.portalAktiv && !portalNetzEingerichtet()) {
        return antwort.code(409).send({
          fehler: 'Erst unter „Selbstdiagnose“ das Netzwerk für das Portal einrichten – dann lässt es sich einschalten.',
        });
      }
      aenderung.portalAktiv = koerper.portalAktiv;
    }

    schreibeGeraet(aenderung);
    if (koerper.portalAktiv !== undefined) await gleichePortalAb();
    if (koerper.mail === null) schreibeMailPasswort(null);
    else if (koerper.mailPasswort) schreibeMailPasswort(koerper.mailPasswort);
    betrieb.ladeTreiberNeu();
    if (koerper.kamera) {
      try {
        await betrieb.kamera.setzeBelichtung(koerper.kamera);
      } catch (fehler) {
        // Gespeichert ist der Wert trotzdem, aber die Kamera hat ihn nicht
        // uebernommen - das soll man sehen, statt "Gespeichert." zu lesen.
        // (Meist steht das Moduswahlrad nicht auf M.)
        const text = fehler instanceof Error ? fehler.message : String(fehler);
        protokolliere('warnung', 'kamera', `Belichtung nicht übernommen: ${text}`);
        return { ...geraetFuerBrowser(), kameraHinweis: `Gespeichert, aber die Kamera hat es nicht übernommen: ${text}` };
      }
    }
    return geraetFuerBrowser();
  });

  // ------------------------------------------------------- Captive Portal

  /** Selbstdiagnose: Was ist eingestellt, was fehlt, was laeuft? */
  app.get('/api/admin/portal', async (_anfrage, antwort) => {
    try {
      return { diagnose: await portalDiagnose(portalZustand, leseGeraet().portalAktiv) };
    } catch (fehler) {
      return antwort.code(500).send({ fehler: `Die Selbstdiagnose ging nicht: ${(fehler as Error).message}` });
    }
  });

  /** Feste Adresse und Firewall-Freigaben fuer das Portal - mit Windows-Rueckfrage. */
  app.post('/api/admin/portal/einrichten', async (_anfrage, antwort) => {
    try {
      const adapter = waehleAdapter((await leseRohdiagnose()).adapter);
      if (!adapter) return antwort.code(409).send({ fehler: 'Kein Kabel-Netzwerkanschluss gefunden.' });
      await richteNetzEin(adapter);
      protokolliere('info', 'portal', `Netz für das Portal eingerichtet (Anschluss „${adapter.name}“).`);
      // Windows braucht einen Moment, bis die neue Adresse benutzbar ist.
      await new Promise((r) => setTimeout(r, 3000));
      await gleichePortalAb();
      return { diagnose: await portalDiagnose(portalZustand, leseGeraet().portalAktiv) };
    } catch (fehler) {
      return antwort.code(500).send({ fehler: (fehler as Error).message });
    }
  });

  /** Zurueck auf den Zustand vor dem Portal: automatische Adresse, keine Freigaben, Schalter aus. */
  app.post('/api/admin/portal/zuruecksetzen', async (_anfrage, antwort) => {
    try {
      schreibeGeraet({ portalAktiv: false });
      const adapter = waehleAdapter((await leseRohdiagnose()).adapter);
      if (!adapter) return antwort.code(409).send({ fehler: 'Kein Kabel-Netzwerkanschluss gefunden.' });
      await holePortal()?.stoppeAlles();
      await setzeNetzZurueck(adapter);
      protokolliere('info', 'portal', `Netz zurückgesetzt (Anschluss „${adapter.name}“).`);
      await new Promise((r) => setTimeout(r, 3000));
      await gleichePortalAb();
      return { diagnose: await portalDiagnose(portalZustand, false) };
    } catch (fehler) {
      return antwort.code(500).send({ fehler: (fehler as Error).message });
    }
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
  /**
   * Was in der Druckwarteschlange los ist. Vorher sah man nur "Testbild in der
   * Warteschlange" - und nicht, dass die Schleife nach einem Fehldruck
   * angehalten war oder bei Windows noch Auftraege klemmten.
   */
  app.get('/api/admin/druck/zustand', async () => ({
    angehalten: betrieb.druckschleife.istAngehalten(),
    letzterFehler: betrieb.druckschleife.letzterFehler,
    drucker: betrieb.letzterDruckerStatus,
    offen: offeneAuftraege(),
    auftraege: letzteAuftraege(),
  }));

  /** Fehldrucke nachholen und die Schleife wieder anlaufen lassen. */
  app.post('/api/admin/druck/fortsetzen', async () => ({
    wartend: betrieb.druckschleife.fortsetzen(null),
  }));

  app.post('/api/admin/druck/verwerfen', async () => ({ verworfen: verwirfWartende() }));

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
      (e) => e.status === 'aktiv',
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

  /**
   * Hintergrundbild fuer den Startbildschirm einer Veranstaltung.
   *
   * Es wird gleich beim Hochladen gedreht (EXIF), auf hoechstens 2560 x 1440
   * verkleinert und als JPEG abgelegt: Ein 20-Megapixel-Handyfoto als
   * Hintergrund wuerde den Kiosk bei jedem Start ausbremsen. Der Dateiname
   * wird vergeben, nie aus der Anfrage uebernommen.
   */
  app.post('/api/admin/hintergrund', async (anfrage, antwort) => {
    const datei = await anfrage.file?.();
    if (!datei) return antwort.code(400).send({ fehler: 'Keine Datei empfangen.' });
    let jpeg: Buffer;
    try {
      const inhalt = await datei.toBuffer();
      const info = await sharp(inhalt).metadata();
      if (!['png', 'jpeg', 'webp'].includes(info.format ?? '')) throw new Error();
      jpeg = await sharp(inhalt)
        .rotate()
        .resize({ width: 2560, height: 1440, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#000000' })
        .jpeg({ quality: 88 })
        .toBuffer();
    } catch {
      return antwort.code(400).send({ fehler: 'Die Datei ist kein lesbares PNG-, JPEG- oder WEBP-Bild.' });
    }
    await mkdir(wurzel.hintergruende, { recursive: true });
    const name = `${randomUUID()}.jpg`;
    await writeFile(join(wurzel.hintergruende, name), jpeg);
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

    protokolliere('info', 'schriften', `Schrift "${familie}" hinzugefügt.`);
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

  /*
   * Neue Veranstaltung - leer (Vorgaben), aus einer Voreinstellung oder als
   * Duplikat einer bestehenden. Uebernommen werden in beiden Faellen nur
   * Einstellungen, nie Fotos, Zahlen, Galerie-Links oder die Betreuer-PIN.
   */
  app.post<{ Body: unknown }>('/api/admin/events', async (anfrage, antwort) => {
    const geprueft = z
      .object({
        name: EVENT_NAME,
        datum: EVENT_DATUM,
        voreinstellungId: z.string().max(64).optional(),
        wieEventId: z.string().max(64).optional(),
      })
      .strict()
      .safeParse(anfrage.body);
    if (!geprueft.success) return antwort.code(400).send({ fehler: ersteMeldung(geprueft.error) });
    const { name, datum, voreinstellungId, wieEventId } = geprueft.data;

    if (wieEventId) {
      if (!holeEvent(wieEventId)) return antwort.code(404).send({ fehler: 'Die Veranstaltung zum Übernehmen gibt es nicht mehr.' });
      const neu = dupliziereEvent(wieEventId, { name, datum }, wurzel.events, uebernehmbar);
      protokolliere('info', 'event', `"${neu.name}" als Kopie der Einstellungen angelegt.`);
      return eventFuerBrowser(neu);
    }
    if (voreinstellungId) {
      const vorlage = holeVoreinstellung(voreinstellungId);
      if (!vorlage) return antwort.code(404).send({ fehler: 'Die Voreinstellung gibt es nicht mehr.' });
      return eventFuerBrowser(
        erstelleEvent({ name, datum, einstellungen: uebernehmbar(vorlage.einstellungen) }, wurzel.events),
      );
    }
    return eventFuerBrowser(erstelleEvent({ name, datum }, wurzel.events));
  });

  app.get('/api/admin/voreinstellungen', async () =>
    listeVoreinstellungen().map((v) => ({ id: v.id, name: v.name, geaendert: v.geaendert })),
  );

  /** Die Einstellungen einer Veranstaltung als Voreinstellung aufheben (gleicher Name ueberschreibt). */
  app.post<{ Body: unknown }>('/api/admin/voreinstellungen', async (anfrage, antwort) => {
    const geprueft = z
      .object({
        eventId: z.string().max(64),
        name: z.string().trim().min(1, 'Die Voreinstellung braucht einen Namen.').max(60, 'Höchstens 60 Zeichen.'),
      })
      .strict()
      .safeParse(anfrage.body);
    if (!geprueft.success) return antwort.code(400).send({ fehler: ersteMeldung(geprueft.error) });
    const event = holeEvent(geprueft.data.eventId);
    if (!event) return antwort.code(404).send({ fehler: 'Veranstaltung nicht gefunden.' });
    const gespeichert = speichereVoreinstellung(geprueft.data.name, event.einstellungen);
    return { id: gespeichert.id, name: gespeichert.name, geaendert: gespeichert.geaendert };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/voreinstellungen/:id', async (anfrage, antwort) => {
    if (!loescheVoreinstellung(anfrage.params.id)) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    return { ok: true };
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
        const event = aktualisiereEvent(anfrage.params.id, {
          name: koerper.name,
          datum: koerper.datum,
          einstellungen: koerper.einstellungen as never,
          ...(koerper.betreuerPin ? { betreuerPinHash: await hashePin(koerper.betreuerPin) } : {}),
        });
        // Lesbar mitmerken - sie kommt automatisch auf die Kurzanleitung.
        if (koerper.betreuerPin) merkeBetreuerPin(event.id, koerper.betreuerPin);
        return eventFuerBrowser(event);
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
          status: z.enum(['entwurf', 'startbereit', 'aktiv', 'abgeschlossen', 'archiviert']),
        })
        .parse(anfrage.body);
      try {
        const vorher = holeEvent(anfrage.params.id)?.status;
        const event = setzeStatus(anfrage.params.id, koerper.status);
        if (koerper.status === 'abgeschlossen') await schreibeAuslagenCsv(event);
        if (koerper.status === 'aktiv' && vorher !== 'aktiv') {
          // Liegengebliebene Drucke frueherer Feiern gehen hier nicht mehr raus.
          const zurueck = stelleFremdeZurueck(event.id);
          if (zurueck > 0) {
            protokolliere('warnung', 'druck', `${zurueck} wartende Drucke früherer Veranstaltungen zurückgestellt.`);
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
        // Das Gaestebuch kommt immer als fertiges PDF mit - auch ohne
        // Gruesse, dann als Album der Fotos. Frisch erzeugt, damit auch das
        // letzte Foto und der letzte Gruss des Abends darin stehen.
        await erzeugeGaestebuchPdf(event).catch((fehler: Error) =>
          protokolliere('warnung', 'gaestebuch', `Gästebuch-PDF nicht erzeugt: ${fehler.message}`),
        );
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

  // ------------------------------------------------------- Gaestebuch
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/gaestebuch', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    return {
      anzahl: gruesseVon(event.id).length,
      // Die Fotos ohne Gruss kommen immer mit - als "Momente des Abends".
      fotos: fotosOhneGruss(event.id).length,
    };
  });

  /** Das Gaestebuch als PDF - jedes Mal frisch, mit allen Gruessen (und Fotos) bis jetzt. */
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/gaestebuch.pdf', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    // Im Speicher gebaut und direkt geschickt - die Datei fuer die Uebergabe
    // bleibt davon unberuehrt.
    const pdf = await baueGaestebuchPdf(event);
    if (!pdf) return antwort.code(404).send({ fehler: 'Im Gästebuch steht noch nichts.' });
    return antwort
      .type('application/pdf')
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', 'inline; filename="Gaestebuch.pdf"')
      .send(pdf.daten);
  });

  // --------------------------------------------------------- Diashow
  /**
   * Wo die Diashow zu sehen ist: am zweiten Bildschirm der Box und - mit
   * Galerie im WLAN - auf jedem Fernseher oder Beamer mit eigenem Browser.
   * Laeuft das Captive Portal, genuegt dort die kurze Adresse.
   */
  app.get<{ Params: { id: string } }>('/api/admin/events/:id/diashow', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    if (!event.einstellungen.diashowExtern) return { wlan: null, kurz: false };
    const galerie = event.einstellungen.galerieAktiv ? galerieAdresse(event.galerieToken, konfig.portOeffentlich) : null;
    const kurz = portalZustand()?.portal && event.einstellungen.galerieAktiv ? `http://${PORTAL_ADRESSE}/diashow` : null;
    return { wlan: kurz ?? (galerie ? `${galerie}/diashow` : null), kurz: kurz !== null };
  });

  /** Diashow auf dem zweiten Bildschirm oeffnen oder schliessen. */
  app.post<{ Body: unknown }>('/api/admin/diashow/fenster', async (anfrage, antwort) => {
    const { an } = z.object({ an: z.boolean() }).parse(anfrage.body);
    if (an && !holeAktivesEvent()?.einstellungen.diashowExtern) {
      return antwort.code(409).send({
        fehler: 'Erst bei der laufenden Veranstaltung die Diashow „Auf einem zweiten Bildschirm“ einschalten.',
      });
    }
    if (process.platform !== 'win32' || !konfig.echteHardware) {
      protokolliere('info', 'diashow', `Diashow-Fenster ${an ? 'öffnen' : 'schließen'} (Entwicklungsbetrieb - nur protokolliert).`);
      return { ok: true, simuliert: true };
    }
    try {
      if (!an) {
        await schliesseDiashowFenster();
        return { ok: true };
      }
      const ergebnis = await oeffneDiashowFenster(`http://localhost:${konfig.portLokal}/diashow?fenster=1`);
      if (ergebnis === 'kein-zweiter-bildschirm') {
        return antwort.code(409).send({
          fehler: 'Windows meldet keinen zweiten Bildschirm. Den zweiten Bildschirm per HDMI anschließen und unter „Anzeige“ auf „Erweitern“ stellen.',
        });
      }
      if (ergebnis === 'kein-browser') {
        return antwort.code(409).send({ fehler: 'Weder Chrome noch Edge gefunden.' });
      }
      protokolliere('info', 'diashow', 'Diashow auf dem zweiten Bildschirm geöffnet.');
      return { ok: true };
    } catch (fehler) {
      return antwort.code(500).send({ fehler: `Hat nicht geklappt: ${(fehler as Error).message}` });
    }
  });

  // ------------------------------------------------------ Unterlagen
  /**
   * Die Kurzanleitung mit der Betreuer-PIN - ohne Eingaben: PIN aus der
   * Veranstaltung, Notfall-Telefon und WLAN aus den Geraeteeinstellungen. Ein
   * mitgeschicktes Telefon wird fuer alle kuenftigen Zettel gemerkt.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/events/:id/unterlagen',
    async (anfrage, antwort) => {
      const koerper = z.object({ telefon: z.string().trim().max(40).optional() }).parse(anfrage.body ?? {});
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      if (koerper.telefon !== undefined) schreibeGeraet({ notfallTelefon: koerper.telefon });
      const ergebnis = await erzeugeKurzanleitung(event);
      if ('fehler' in ergebnis) return antwort.code(409).send({ fehler: ergebnis.fehler });
      return { link: `/api/admin/events/${event.id}/unterlagen/kurzanleitung.pdf` };
    },
  );

  /** Die erzeugte Kurzanleitung zum Ansehen und Drucken - ohne sie auf der Platte zu suchen. */
  app.get<{ Params: { id: string } }>(
    '/api/admin/events/:id/unterlagen/kurzanleitung.pdf',
    async (anfrage, antwort) => {
      const event = holeEvent(anfrage.params.id);
      if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
      const pfad = join(eventpfade(event.ordner).cache, 'unterlagen', 'kurzanleitung.pdf');
      if (!existsSync(pfad)) return antwort.code(404).send({ fehler: 'Noch nicht erzeugt.' });
      return antwort.type('application/pdf').header('Cache-Control', 'no-store').send(createReadStream(pfad));
    },
  );

  /**
   * Der Aushang fuer die Gaeste - fuer jede Feier derselbe (offenes WLAN,
   * Captive Portal), deshalb unter "WLAN & Portal" statt in der Veranstaltung.
   */
  app.post('/api/admin/portal/aushang', async () => {
    await schreibePortalAushang(konfig.datenpfad, leseGeraet().wlan?.name || undefined);
    return { link: '/api/admin/portal/aushang.pdf' };
  });

  app.get('/api/admin/portal/aushang.pdf', async (_anfrage, antwort) => {
    const pfad = join(konfig.datenpfad, 'unterlagen', 'aushang.pdf');
    if (!existsSync(pfad)) return antwort.code(404).send({ fehler: 'Noch nicht erzeugt.' });
    return antwort.type('application/pdf').header('Cache-Control', 'no-store').send(createReadStream(pfad));
  });

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
      protokolliere('info', 'email', 'Eine E-Mail-Adresse auf Wunsch gelöscht.');
      return { ok: true };
    },
  );

  /** Alle Adressen einer Veranstaltung sofort loeschen. */
  app.delete<{ Params: { id: string } }>('/api/admin/events/:id/adressen', async (anfrage, antwort) => {
    const event = holeEvent(anfrage.params.id);
    if (!event) return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    const geloescht = loescheAlleAdressen(event.id);
    protokolliere('info', 'email', `${geloescht} E-Mail-Adresse(n) von "${event.name}" gelöscht.`);
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

  app.get('/api/admin/status', async () => ({ ...(await betrieb.status()), version: VERSION }));

  /*
   * Software-Update - nur auf Knopfdruck des Besitzers, siehe
   * fach/aktualisierung.ts. Installiert wird ausschliesslich, was die letzte
   * Pruefung hier auf dem Server gefunden hat; eine Adresse aus dem Browser
   * wird nie geladen.
   */
  const aktualisierer = new Aktualisierer({
    ordner: join(konfig.datenpfad, 'updates'),
    starten: process.platform === 'win32' && konfig.echteHardware,
  });
  let letztePruefung: UpdateInfo | null = null;

  app.post('/api/admin/update/pruefen', async (_anfrage, antwort) => {
    try {
      letztePruefung = await pruefeAufUpdate(VERSION);
      return letztePruefung;
    } catch (fehler) {
      return antwort.code(503).send({ fehler: (fehler as Error).message });
    }
  });

  app.post('/api/admin/update/installieren', async (_anfrage, antwort) => {
    if (!letztePruefung?.neuerVerfuegbar) {
      return antwort.code(409).send({ fehler: 'Bitte zuerst nach Updates suchen.' });
    }
    // Mitten in einer Aufnahme wuerde das Update die Gruppe hinauswerfen.
    if (betrieb.aktiveSitzung) {
      return antwort.code(409).send({ fehler: 'Gerade fotografiert jemand. Bitte warten, bis die Sitzung fertig ist.' });
    }
    if (aktualisierer.laeuft()) return antwort.code(409).send({ fehler: 'Es läuft schon ein Update.' });
    protokolliere('info', 'update', `Update von ${VERSION} auf ${letztePruefung.neueste} angefordert.`);
    // Laeuft im Hintergrund; den Fortschritt fragt die Verwaltung ab.
    aktualisierer.installiere(letztePruefung).catch((fehler: Error) => {
      protokolliere('warnung', 'update', `Update fehlgeschlagen: ${fehler.message}`);
    });
    return { ok: true };
  });

  app.get('/api/admin/update/stand', async () => ({ ...aktualisierer.stand, aktuell: VERSION }));

  /**
   * Ausweg, falls die Windows-Rueckfrage nicht erscheint: den Ordner mit der
   * schon geladenen und geprueften Setup-Datei im Explorer zeigen. Ein
   * Doppelklick dort kommt aus dem Vordergrund - dann zeigt Windows die
   * Rueckfrage zuverlaessig vorne. Geoeffnet wird nur die Datei, die der
   * Aktualisierer selbst geladen hat, nie ein Pfad aus der Anfrage.
   */
  app.post('/api/admin/update/von-hand', async (_anfrage, antwort) => {
    const datei = aktualisierer.stand.datei;
    if (!datei || !existsSync(datei)) {
      return antwort.code(409).send({ fehler: 'Es liegt keine geprüfte Setup-Datei bereit. Bitte zuerst „Jetzt installieren“.' });
    }
    if (process.platform !== 'win32') return { datei, geoeffnet: false };
    // Ohne "error"-Handler wuerde ein Startfehler den ganzen Server beenden.
    spawn('explorer.exe', [`/select,${datei}`], { stdio: 'ignore' }).on('error', (f) =>
      protokolliere('warnung', 'update', `Explorer nicht geöffnet: ${f.message}`),
    );
    return { datei, geoeffnet: true };
  });

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

  /**
   * "Was zuletzt gehakt hat" leeren - etwa nach dem Einrichten oder vor dem
   * Verleih, damit danach nur steht, was beim Kunden passiert ist. Geloescht
   * werden genau die angezeigten Warnungen und Fehler.
   */
  app.delete('/api/admin/protokoll', async () => {
    const geloescht = holeDb().prepare("DELETE FROM protokoll WHERE ebene IN ('warnung', 'fehler')").run().changes;
    protokolliere('info', 'verwaltung', `${geloescht} Meldung(en) aus "Was zuletzt gehakt hat" gelöscht.`);
    return { geloescht };
  });
}
