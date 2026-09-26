import type { FastifyInstance } from 'fastify';
import type { Betrieb } from '../betrieb.js';

/**
 * Live-View als MJPEG.
 *
 * liveview.jpg von digiCamControl liefert immer nur ein einzelnes Bild. Der
 * Betrieb holt es in festem Takt fuer alle Zuschauer gemeinsam, und die
 * JPEG-Daten gehen unveraendert weiter - kein Neucodieren, keine Skalierung.
 */
const GRENZE = 'fotoboxgrenze';

export function registriereStream(app: FastifyInstance, betrieb: Betrieb): void {
  app.get('/stream/liveview', (anfrage, antwort) => {
    const leitung = antwort.raw;
    leitung.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${GRENZE}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'close',
      Pragma: 'no-cache',
    });
    // Kopfzeilen sofort senden: Sonst wartet der Browser bis zum ersten Bild,
    // und das kommt bei abgesteckter Kamera womoeglich nie.
    leitung.flushHeaders();

    const abmelden = betrieb.schaueLiveBild((bild) => {
      if (leitung.destroyed) return;
      // Kommt der Browser nicht hinterher - etwa weil der N100 gerade ein
      // Layout rechnet -, wird dieses Bild ausgelassen statt angestellt.
      // Vorher stauten sich die Bilder in der Leitung, und der Gast sah sich
      // mit wachsender Verzoegerung: winkt, und die Hand kommt eine Sekunde
      // spaeter.
      if (leitung.writableNeedDrain) return;
      leitung.write(
        `--${GRENZE}\r\nContent-Type: image/jpeg\r\nContent-Length: ${bild.length}\r\n\r\n`,
      );
      leitung.write(bild);
      leitung.write('\r\n');
    });

    anfrage.raw.on('close', abmelden);
    leitung.on('close', abmelden);
    leitung.on('error', abmelden);
    // Fastify soll die Antwort nicht selbst abschliessen - sie gehoert jetzt
    // dem Strom und endet, wenn der Browser die Verbindung schliesst.
    antwort.hijack();
  });

  /** Einzelbild, etwa fuer die Vorschau im Admin. */
  app.get('/stream/standbild.jpg', async (_anfrage, antwort) => {
    const bild = await betrieb.liveBild();
    if (!bild) return antwort.code(503).send();
    return antwort.header('Content-Type', 'image/jpeg').header('Cache-Control', 'no-store').send(bild);
  });
}
