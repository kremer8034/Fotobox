/** Schmaler Zugriff auf die Server-Schnittstelle. */

async function anfrage<T>(pfad: string, optionen?: RequestInit): Promise<T> {
  const antwort = await fetch(pfad, {
    ...optionen,
    headers: { 'content-type': 'application/json', ...optionen?.headers },
  });
  if (!antwort.ok) {
    let text = `HTTP ${antwort.status}`;
    try {
      const daten = (await antwort.json()) as { fehler?: string };
      if (daten.fehler) text = daten.fehler;
    } catch {
      // Keine JSON-Antwort.
    }
    throw new Error(text);
  }
  if (antwort.status === 204) return undefined as T;
  return (await antwort.json()) as T;
}

export const api = {
  hole: <T>(pfad: string) => anfrage<T>(pfad),
  sende: <T>(pfad: string, koerper: unknown) =>
    anfrage<T>(pfad, { method: 'POST', body: JSON.stringify(koerper ?? {}) }),
  aendere: <T>(pfad: string, koerper: unknown) =>
    anfrage<T>(pfad, { method: 'PUT', body: JSON.stringify(koerper) }),
  loesche: <T>(pfad: string) => anfrage<T>(pfad, { method: 'DELETE' }),
  /**
   * Datei-Upload. Bewusst ohne den JSON-Kopf von "anfrage": Bei FormData muss
   * der Browser den content-type samt boundary selbst setzen.
   */
  sendeDatei: async <T>(pfad: string, datei: File): Promise<T> => {
    const formular = new FormData();
    formular.append('datei', datei);
    const antwort = await fetch(pfad, { method: 'POST', body: formular });
    if (!antwort.ok) {
      let text = `HTTP ${antwort.status}`;
      try {
        const daten = (await antwort.json()) as { fehler?: string };
        if (daten.fehler) text = daten.fehler;
      } catch {
        // Keine JSON-Antwort.
      }
      throw new Error(text);
    }
    return (await antwort.json()) as T;
  },
};

// --------------------------------------------------------------------- Typen

export interface Zeiten {
  bereitmachenErstes: number;
  bereitmachenZwischen: number;
  countdown: number;
  bestaetigung: number;
  rueckkehrStart: number;
  galerieLeerlauf: number;
  liveViewAbschaltung: number;
  sitzungAbbruch: number;
}

export interface Toene {
  countdownPiep: boolean;
  ausloeser: boolean;
  ergebnis: boolean;
}

export interface Stoerungstext {
  titel: string;
  folge: string;
  tun: string;
}

export interface KioskStart {
  bereit: boolean;
  pausiert?: boolean;
  grund?: string;
  status: {
    kamera: string;
    drucker: string;
    stoerung: string | null;
    warteschlangeOffen: number;
    materialRest: number;
    speicherFreiGb: number;
  };
  veranstaltung?: { id: string; name: string; probelauf: boolean };
  darstellung?: {
    titel: string;
    untertitel: string;
    akzent: string;
    qrAufStartseite: boolean;
    galerieToken: string | null;
  };
  zeiten?: Zeiten;
  toene?: Toene;
  ausgabe?: {
    druckAktiv: boolean;
    emailAktiv: boolean;
    kopienVorgabe: number;
    kopienMax: number;
    druckLimitErreicht: boolean;
  };
  vorlagen?: { id: string; name: string; fotos: number; canvas: { breiteMm: number; hoeheMm: number } }[];
  filter?: { id: string; name: string }[];
}

export interface SitzungStart {
  sitzungId: string;
  benoetigteFotos: number;
  vorlage: { id: string; name: string; canvas: { breiteMm: number; hoeheMm: number } };
  seitenverhaeltnisse: Record<string, number>;
}
