import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Betrieb } from '../betrieb.js';
import { MockKamera } from '../treiber/kamera-mock.js';
import { MockDrucker } from '../treiber/drucker-mock.js';

/**
 * Stoerungen nachstellen - nur im Entwicklungsbetrieb mit Mock-Hardware.
 *
 * Die Box steht meist allein beim Kunden. Ob sie ein gezogenes Kamerakabel
 * oder leeres Papier uebersteht, laesst sich ohne Hardware nur pruefen, wenn
 * sich solche Ausfaelle auf Knopfdruck ausloesen lassen. Mit echter Hardware
 * wird diese Route gar nicht erst angemeldet.
 */
export function registriereEntwicklung(app: FastifyInstance, betrieb: Betrieb): void {
  app.post<{ Body: unknown }>('/api/entwicklung/stoerung', async (anfrage, antwort) => {
    const k = z
      .object({
        kameraAbgesteckt: z.boolean().optional(),
        scheiterndeAusloeser: z.number().int().min(0).optional(),
        verschluckteAusloeser: z.number().int().min(0).optional(),
        drucker: z.enum(['bereit', 'papier-leer', 'offline', 'klappe', 'unbekannt']).optional(),
      })
      .parse(anfrage.body);
    const kamera = betrieb.kamera;
    const drucker = betrieb.drucker;
    if (!(kamera instanceof MockKamera) || !(drucker instanceof MockDrucker)) {
      return antwort.code(404).send({ fehler: 'Nur mit Mock-Hardware.' });
    }
    if (k.kameraAbgesteckt !== undefined) kamera.abgesteckt = k.kameraAbgesteckt;
    if (k.scheiterndeAusloeser !== undefined) kamera.scheiterndeAusloeser = k.scheiterndeAusloeser;
    if (k.verschluckteAusloeser !== undefined) kamera.verschluckteAusloeser = k.verschluckteAusloeser;
    if (k.drucker !== undefined) drucker.zustand = { zustand: k.drucker };
    return {
      kameraAbgesteckt: kamera.abgesteckt,
      scheiterndeAusloeser: kamera.scheiterndeAusloeser,
      drucker: drucker.zustand.zustand,
    };
  });
}
