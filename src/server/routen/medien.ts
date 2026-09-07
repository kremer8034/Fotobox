import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { holeAusgabe } from '../fach/sitzungen.js';
import { holeEvent } from '../fach/events.js';
import { eventpfade } from '../fach/pfade.js';

/**
 * Medien fuer Kiosk und Admin. Nur ueber 127.0.0.1 erreichbar.
 *
 * Auch hier gilt: Kein Dateipfad aus der URL. Angefordert wird eine Ausgabe-ID,
 * den Pfad setzt der Server aus der Datenbank zusammen und prueft, dass er im
 * Layout-Ordner des zugehoerigen Events liegt.
 */
export function registriereMedien(app: FastifyInstance): void {
  app.get<{ Params: { id: string }; Querystring: { klein?: string } }>(
    '/medien/ausgabe/:id.jpg',
    async (anfrage, antwort) => {
      const ausgabe = holeAusgabe(anfrage.params.id);
      if (!ausgabe) return antwort.code(404).send();
      const event = holeEvent(ausgabe.eventId);
      if (!event) return antwort.code(404).send();

      const layouts = eventpfade(event.ordner).layouts;
      const layoutsTest = eventpfade(event.ordner, true).layouts;
      if (!ausgabe.pfadLayout.startsWith(layouts) && !ausgabe.pfadLayout.startsWith(layoutsTest)) {
        return antwort.code(404).send();
      }

      const klein = anfrage.query.klein === '1';
      const bild = sharp(ausgabe.pfadLayout);
      const daten = await (klein ? bild.resize(480, 480, { fit: 'inside' }) : bild)
        .jpeg({ quality: klein ? 78 : 92 })
        .toBuffer();
      return antwort.header('Content-Type', 'image/jpeg').send(daten);
    },
  );
}
