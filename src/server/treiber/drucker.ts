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

/** Zustaende, in denen ein neuer Auftrag nur haengen bliebe. */
export function druckerBlockiert(zustand: DruckerZustand): boolean {
  return zustand === 'papier-leer' || zustand === 'offline' || zustand === 'klappe';
}

export interface DruckerStatus {
  zustand: DruckerZustand;
  meldung?: string;
  /**
   * Auftraege, die schon beim Betriebssystem liegen, aber noch nicht gedruckt
   * sind. Unter Windows kehrt der Druckbefehl zurueck, sobald der Auftrag in
   * der Windows-Warteschlange liegt - nicht, wenn das Blatt draussen ist.
   */
  auftraegeBeimSystem?: number;
}

export interface DruckerTreiber {
  readonly name: string;
  pruefe(): Promise<DruckerStatus>;
  /** Druckt die PDF-Datei. Wirft bei Fehlschlag, damit der Auftrag in der
   *  Warteschlange stehen bleibt statt still verloren zu gehen. */
  drucke(pdfPfad: string, kopien: number): Promise<void>;
}
