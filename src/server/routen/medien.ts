import sharp from 'sharp';
import { createReadStream, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { holeAusgabe } from '../fach/sitzungen.js';
import { holeEvent } from '../fach/events.js';
import { eventpfade, wurzelpfade } from '../fach/pfade.js';
import { leseGeraet } from '../db/geraet.js';
import { abgeleitet, FASSUNGEN } from '../bild/abgeleitet.js';

/**
 * Medien fuer Kiosk und Admin. Nur ueber 127.0.0.1 erreichbar.
 *
 * Auch hier gilt: Kein Dateipfad aus der URL. Angefordert wird eine Ausgabe-ID,
 * den Pfad setzt der Server aus der Datenbank zusammen und prueft, dass er im
 * Layout-Ordner des zugehoerigen Events liegt.
 */
export function registriereMedien(app: FastifyInstance): void {
  /**
   * Bilddateien der Vorlagen, damit der Editor die echte Gestaltung zeigt statt
   * grauer Kaesten.
   *
   * Hier kommt ausnahmsweise ein Name aus der URL - deshalb wird er auf den
   * reinen Dateinamen reduziert (basename) und der Pfad anschliessend
   * serverseitig zusammengesetzt. Ein "../" kann damit nichts ausrichten. Die
   * Route liegt ohnehin nur auf der lokalen Instanz.
   */
  app.get<{ Params: { datei: string } }>('/medien/vorlage/:datei', async (anfrage, antwort) => {
    const name = basename(anfrage.params.datei);
    if (name !== anfrage.params.datei || name.startsWith('.')) {
      return antwort.code(400).send();
    }
    const ordner = wurzelpfade(leseGeraet().datenpfad).vorlagen;
    const pfad = join(ordner, name);
    if (!pfad.startsWith(ordner) || !existsSync(pfad)) return antwort.code(404).send();

    const daten = await sharp(pfad).png().toBuffer();
    return antwort
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'private, max-age=60')
      .send(daten);
  });

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

      // Die Miniatur wird einmal gerechnet und aufgehoben; das Vollbild ist das
      // fertige Layout selbst und geht unveraendert heraus. Vorher wurden
      // beide bei jedem Abruf neu kodiert - siehe bild/abgeleitet.ts.
      const pfad =
        anfrage.query.klein === '1'
          ? await abgeleitet(ausgabe.pfadLayout, eventpfade(event.ordner).cache, ausgabe.id, FASSUNGEN.kioskKlein)
          : ausgabe.pfadLayout;
      return antwort
        .header('Content-Type', 'image/jpeg')
        // Ein fertiges Layout aendert sich nie - der Browser darf es behalten.
        .header('Cache-Control', 'private, max-age=86400, immutable')
        .send(createReadStream(pfad));
    },
  );
}
