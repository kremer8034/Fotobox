import type { FastifyInstance } from 'fastify';
import type { Betrieb } from '../betrieb.js';

/**
 * Live-View als MJPEG.
 *
 * liveview.jpg von digiCamControl liefert immer nur ein einzelnes Bild. Der
 * Server holt es etwa zehnmal pro Sekunde und reicht die JPEG-Daten
 * unveraendert weiter - kein Neucodieren, keine Skalierung. Fuer das Ausrichten
 * reicht das muehelos, ein echter Videostream ist es nicht.
 */
const GRENZE = 'fotoboxgrenze';

export function registriereStream(app: FastifyInstance, betrieb: Betrieb): void {
  app.get('/stream/liveview', async (anfrage, antwort) => {
    antwort.raw.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${GRENZE}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'close',
      Pragma: 'no-cache',
    });

    let offen = true;
    anfrage.raw.on('close', () => {
      offen = false;
    });

    while (offen && !antwort.raw.destroyed) {
      const bild = await betrieb.liveBild();
      if (bild) {
        antwort.raw.write(
          `--${GRENZE}\r\nContent-Type: image/jpeg\r\nContent-Length: ${bild.length}\r\n\r\n`,
        );
        antwort.raw.write(bild);
        antwort.raw.write('\r\n');
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!antwort.raw.destroyed) antwort.raw.end();
    return antwort;
  });

  /** Einzelbild, etwa fuer die Vorschau im Admin. */
  app.get('/stream/standbild.jpg', async (_anfrage, antwort) => {
    const bild = await betrieb.liveBild();
    if (!bild) return antwort.code(503).send();
    return antwort.header('Content-Type', 'image/jpeg').header('Cache-Control', 'no-store').send(bild);
  });
}
