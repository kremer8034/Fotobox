import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Betriebskonfiguration aus Umgebungsvariablen.
 *
 * Der Server bindet standardmaessig NUR auf 127.0.0.1. Die LAN-Adresse kommt
 * ausschliesslich dann dazu, wenn in einem Event die Galerie aktiv ist - und
 * dann auch nur fuer die oeffentlichen Routen.
 */
export interface Konfig {
  datenpfad: string;
  portLokal: number;
  portOeffentlich: number;
  /** true schaltet auf digiCamControl und den Windows-Druck um. */
  echteHardware: boolean;
  webOrdner: string;
}

export function leseKonfig(): Konfig {
  const standardDaten =
    process.platform === 'win32'
      ? join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Fotobox-Daten')
      : join(homedir(), 'Fotobox-Daten');

  return {
    datenpfad: process.env.FOTOBOX_DATEN ?? standardDaten,
    portLokal: Number(process.env.FOTOBOX_PORT ?? 8787),
    portOeffentlich: Number(process.env.FOTOBOX_PORT_OEFFENTLICH ?? 8787),
    echteHardware:
      (process.env.FOTOBOX_HARDWARE ?? (process.platform === 'win32' ? 'echt' : 'mock')) === 'echt',
    webOrdner: process.env.FOTOBOX_WEB ?? 'dist/web',
  };
}
