import Fastify, { type FastifyInstance } from 'fastify';
import { PORTAL_ADRESSE } from './adresse.js';

/**
 * Das Portal auf Port 80.
 *
 * Jede Anfrage - egal an welchen Namen, egal welcher Pfad - bekommt eine
 * Weiterleitung auf die Galerie (nur /diashow auf deren Diashow). Nie "Success" und nie 204: Genau daran
 * erkennen iPhone und Android ein Anmeldeportal und oeffnen das Fenster.
 * Weil die Box nie "Internet ok" meldet, bleibt das Handy fuer alles andere
 * bei seinen mobilen Daten - WhatsApp & Co. laufen weiter.
 *
 * Mehr kann diese Instanz nicht: keine Galerie-Daten, kein Kiosk, keine
 * Verwaltung. Die Galerie selbst kommt wie bisher von der oeffentlichen
 * Instanz mit ihrer Haertung.
 */
export function bauePortal(ziel: () => string | null): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1024, connectionTimeout: 10_000 });
  app.all('/*', async (anfrage, antwort) => {
    const galerie = ziel();
    // Eine einzige Ausnahme: "192.168.254.1/diashow" fuehrt Fernseher und
    // Beamer mit eigenem Browser zur Diashow - die lange Galerie-Adresse
    // tippt dort niemand mit der Fernbedienung ein.
    const url = galerie && anfrage.url.replace(/\/+$/, '').toLowerCase() === '/diashow' ? `${galerie}/diashow` : galerie;
    antwort.header('Cache-Control', 'no-store');
    if (!url) {
      // Keine laufende Galerie: freundlich sagen, statt ins Leere zu leiten.
      return antwort
        .type('text/html; charset=utf-8')
        .send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
          '<p style="font-family:sans-serif;padding:1em">Die Fotobox-Galerie ist gerade nicht geöffnet.</p>');
    }
    return antwort.redirect(url, 302);
  });
  return app;
}

export class PortalDienst {
  private app: FastifyInstance | null = null;

  constructor(
    private readonly ziel: () => string | null,
    private readonly adresse = PORTAL_ADRESSE,
    private readonly port = 80,
  ) {}

  get laeuft(): boolean {
    return this.app !== null;
  }

  async starte(): Promise<void> {
    if (this.app) return;
    const app = bauePortal(this.ziel);
    await app.listen({ host: this.adresse, port: this.port });
    this.app = app;
  }

  async stoppe(): Promise<void> {
    const app = this.app;
    this.app = null;
    if (app) await app.close();
  }
}
