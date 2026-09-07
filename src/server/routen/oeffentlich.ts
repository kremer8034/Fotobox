import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import { findeEventNachGalerieToken, findeEventNachStatusToken } from '../fach/events.js';
import { galerieEintraege, holeAusgabe } from '../fach/sitzungen.js';
import { berechneAuslagen } from '../fach/auslagen.js';
import { eventpfade } from '../fach/pfade.js';
import type { Betrieb } from '../betrieb.js';

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
 */
export function registriereOeffentlich(app: FastifyInstance, betrieb: Betrieb): void {
  app.get<{ Params: { token: string } }>('/api/galerie/:token', async (anfrage, antwort) => {
    const event = findeEventNachGalerieToken(anfrage.params.token);
    if (!event || !event.einstellungen.galerieAktiv) {
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
      const event = findeEventNachGalerieToken(anfrage.params.token);
      if (!event || !event.einstellungen.galerieAktiv) return antwort.code(404).send();

      const ausgabe = holeAusgabe(anfrage.params.id);
      if (!ausgabe || ausgabe.eventId !== event.id) return antwort.code(404).send();

      const layoutsOrdner = eventpfade(event.ordner).layouts;
      if (!ausgabe.pfadLayout.startsWith(layoutsOrdner)) return antwort.code(404).send();

      const gross = anfrage.query.gross === '1';
      const bild = sharp(ausgabe.pfadLayout).rotate();
      const daten = await (gross ? bild : bild.resize(600, 600, { fit: 'inside' }))
        .jpeg({ quality: gross ? 92 : 80, mozjpeg: false })
        .toBuffer();

      return antwort
        .header('Content-Type', 'image/jpeg')
        .header('Cache-Control', 'private, max-age=300')
        .send(daten);
    },
  );

  // Download aufs Handy. Der Gast kann das Bild anschliessend ueber die
  // Systemfunktionen weitergeben - WhatsApp und Co. brauchen wir nicht selbst.
  app.get<{ Params: { token: string; id: string } }>(
    '/medien/download/:token/:id.jpg',
    async (anfrage, antwort) => {
      const event = findeEventNachGalerieToken(anfrage.params.token);
      if (!event || !event.einstellungen.galerieAktiv) return antwort.code(404).send();
      const ausgabe = holeAusgabe(anfrage.params.id);
      if (!ausgabe || ausgabe.eventId !== event.id) return antwort.code(404).send();

      const daten = await sharp(ausgabe.pfadLayout).rotate().jpeg({ quality: 95 }).toBuffer();
      const name = `${event.name.replace(/[^\w-]+/g, '_')}_${ausgabe.id.slice(0, 8)}.jpg`;
      return antwort
        .header('Content-Type', 'image/jpeg')
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .send(daten);
    },
  );

  /**
   * Schreibgeschuetzte Statusseite fuer das Handy des Gastgebers. Nur lesen,
   * keine Aktionen - damit er die Box im Blick hat, ohne etwas verstellen zu
   * koennen.
   */
  app.get<{ Params: { token: string } }>('/api/status/:token', async (anfrage, antwort) => {
    const event = findeEventNachStatusToken(anfrage.params.token);
    if (!event) return antwort.code(404).send({ fehler: 'Unbekannt.' });

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

  app.get<{ Querystring: { text?: string } }>('/api/qr', async (anfrage, antwort) => {
    const text = anfrage.query.text ?? '';
    if (!text) return antwort.code(400).send({ fehler: 'Kein Text.' });
    const png = await QRCode.toBuffer(text, { width: 512, margin: 1 });
    return antwort.header('Content-Type', 'image/png').send(png);
  });
}

/** Datei sicher ausliefern, nachdem der Pfad serverseitig geprueft wurde. */
export async function sendeDatei(pfad: string) {
  await stat(pfad);
  return createReadStream(pfad);
}
