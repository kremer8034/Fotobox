import { appendFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DruckerStatus, DruckerTreiber } from './drucker.js';

/**
 * Schreibt statt zu drucken eine Datei. Grundlage fuer alle automatisierten
 * Tests und fuer die Entwicklung ohne angeschlossenen DNP.
 */
export class MockDrucker implements DruckerTreiber {
  readonly name = 'Mock-Drucker';
  /** Von Tests umschaltbar, um Papierstau und Co. nachzustellen. */
  zustand: DruckerStatus = { zustand: 'bereit' };

  constructor(private readonly ausgabeordner: string) {}

  async pruefe(): Promise<DruckerStatus> {
    return this.zustand;
  }

  async drucke(pdfPfad: string, kopien: number): Promise<void> {
    if (this.zustand.zustand !== 'bereit') {
      throw new Error(`Drucker nicht bereit: ${this.zustand.zustand}`);
    }
    mkdirSync(this.ausgabeordner, { recursive: true });
    const ziel = join(this.ausgabeordner, `${Date.now()}_${kopien}x_${basename(pdfPfad)}`);
    copyFileSync(pdfPfad, ziel);
    appendFileSync(
      join(this.ausgabeordner, 'druckprotokoll.txt'),
      `${new Date().toISOString()}\t${kopien}x\t${pdfPfad}\n`,
    );
  }
}
