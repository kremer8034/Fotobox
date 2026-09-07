/**
 * Drucker-Anbindung.
 *
 * Windows kann aus Node heraus nicht ohne Weiteres dialogfrei drucken. Deshalb
 * geht der Druck ueber ein Hilfsprogramm; die Schnittstelle ist so geschnitten,
 * dass spaeter ein eigener .NET-Druckhelfer daneben treten kann, ohne dass sich
 * am uebrigen Code etwas aendert.
 */

export type DruckerZustand =
  | 'bereit'
  | 'papier-leer'
  | 'offline'
  | 'klappe'
  | 'unbekannt';

export interface DruckerStatus {
  zustand: DruckerZustand;
  meldung?: string;
}

export interface DruckerTreiber {
  readonly name: string;
  pruefe(): Promise<DruckerStatus>;
  /** Druckt die PDF-Datei. Wirft bei Fehlschlag, damit der Auftrag in der
   *  Warteschlange stehen bleibt statt still verloren zu gehen. */
  drucke(pdfPfad: string, kopien: number): Promise<void>;
}
