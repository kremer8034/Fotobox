import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ersteMeldung } from './fach/einstellungen-pruefung.js';

/*
 * Zwei Schutzschichten, eine je Instanz.
 */

/** localhost oder 127.0.0.1, mit beliebigem Port (Vite im Entwicklungsbetrieb laeuft auf 5173). */
const LOKALER_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOKALER_URSPRUNG = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Kiosk und Verwaltung: nur fuer Seiten, die selbst von localhost stammen.
 *
 * Die lokale Instanz lauscht nur auf 127.0.0.1 - aus dem WLAN kommt niemand
 * heran. Wohl aber eine fremde Webseite, die jemand auf dem Fotobox-PC
 * oeffnet, etwa beim Gestalten der Vorlagen im Internet:
 *
 *  - DNS-Rebinding: Eine fremde Adresse zeigt ploetzlich auf 127.0.0.1, und die
 *    fremde Seite liest die Verwaltung wie ihre eigene - Veranstaltungen,
 *    Galerie-Links, E-Mail-Adressen der Gaeste. Gegenmittel: Nur Anfragen, die
 *    an "localhost" oder "127.0.0.1" gerichtet sind, werden beantwortet.
 *  - Untergeschobene Formulare (CSRF): Eine fremde Seite schickt still eine
 *    Anfrage "Warteschlange fortsetzen" oder "Kiosk schliessen". Gegenmittel:
 *    Schreibende Anfragen muessen von einer localhost-Seite kommen.
 */
export function schuetzeLokal(app: FastifyInstance): void {
  app.addHook('onRequest', async (anfrage, antwort) => {
    const host = anfrage.headers.host ?? '';
    if (!LOKALER_HOST.test(host)) {
      return antwort.code(403).send({ fehler: 'Nur auf der Fotobox selbst erreichbar.' });
    }
    if (anfrage.method === 'GET' || anfrage.method === 'HEAD' || anfrage.method === 'OPTIONS') return;

    // Moderne Browser sagen selbst, ob eine Anfrage von einer fremden Seite
    // kommt; aeltere schicken wenigstens den Ursprung mit.
    const herkunft = anfrage.headers['sec-fetch-site'];
    if (herkunft === 'cross-site' || herkunft === 'same-site') {
      return antwort.code(403).send({ fehler: 'Anfrage von fremder Seite abgelehnt.' });
    }
    const ursprung = anfrage.headers.origin;
    if (ursprung && ursprung !== 'null' && !LOKALER_URSPRUNG.test(ursprung)) {
      return antwort.code(403).send({ fehler: 'Anfrage von fremder Seite abgelehnt.' });
    }
    if (ursprung === 'null') {
      return antwort.code(403).send({ fehler: 'Anfrage von fremder Seite abgelehnt.' });
    }
  });
}

/**
 * Galerie im WLAN: Kopfzeilen, die dem Browser des Gastes enge Grenzen setzen.
 *
 *  - Content-Security-Policy: Die Seite laedt nur, was von der Box selbst
 *    kommt, und laesst sich nicht in fremde Seiten einbetten.
 *  - Referrer-Policy: Der Galerie-Link steckt im Pfad. Tippt ein Gast von der
 *    Galerie aus auf einen Link nach draussen, wuerde der Browser ihn sonst als
 *    Herkunft mitschicken.
 *  - Antworten der Schnittstelle werden nicht zwischengespeichert: Ein
 *    zurueckgezogener Link soll auch aus dem Browser-Speicher verschwinden.
 */
export function haerteOeffentlich(app: FastifyInstance): void {
  app.addHook('onSend', async (anfrage, antwort, nutzlast) => {
    antwort.header('X-Content-Type-Options', 'nosniff');
    antwort.header('Referrer-Policy', 'no-referrer');
    antwort.header('X-Frame-Options', 'DENY');
    antwort.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'",
    );
    antwort.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (anfrage.url.startsWith('/api/')) antwort.header('Cache-Control', 'no-store');
    return nutzlast;
  });
}

/**
 * Fehler einheitlich beantworten.
 *
 * Vorher kam jede abgelehnte Eingabe als "500 Internal Server Error" mit dem
 * rohen Pruefprotokoll im Text an - in der Verwaltung stand dann "HTTP 500",
 * und niemand wusste, welches Feld nicht stimmte. Jetzt: Eingabefehler als 400
 * mit einem Satz, alles andere als 500 mit einem Hinweis und dem Eintrag im
 * Protokoll - ohne technische Einzelheiten nach draussen.
 */
export function beantworteFehler(
  app: FastifyInstance,
  protokoll: (text: string) => void,
): void {
  app.setErrorHandler((fehler, anfrage, antwort) => {
    if (fehler instanceof ZodError) {
      return antwort.code(400).send({ fehler: ersteMeldung(fehler) });
    }
    const { statusCode: code, message } = fehler as { statusCode?: number; message?: string };
    if (code && code >= 400 && code < 500) {
      return antwort.code(code).send({ fehler: message ?? 'Ungültige Anfrage.' });
    }
    protokoll(`${anfrage.method} ${anfrage.url.split('?')[0]}: ${message ?? String(fehler)}`);
    return antwort.code(500).send({ fehler: 'Da ist etwas schiefgegangen. Details stehen im Protokoll.' });
  });
}
