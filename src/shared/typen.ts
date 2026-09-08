/**
 * Gemeinsame Typen fuer Server und Weboberflaeche.
 *
 * Bewusst auf Deutsch benannt: Die Software hat genau einen Nutzer, die Oberflaeche
 * ist deutsch, und die Begriffe aus dem Plan (Vorlage, Ebene, Veranstaltung) sollen
 * sich im Code eins zu eins wiederfinden.
 */

// ---------------------------------------------------------------------------
// Vorlagen (Templates)
// ---------------------------------------------------------------------------

/**
 * Papierformate. Der DNP DS-RX1HS druckt 4x6 Zoll = 152,4 x 101,6 mm, verkauft
 * als "10x15 cm". Die krummen Millimeterwerte sind Absicht: Mit runden 150x100
 * wuerde der Treiber skalieren und das Layout beschneiden.
 */
export type CanvasPreset = '10x15-quer' | '10x15-hoch';

export interface Canvas {
  preset: CanvasPreset;
  breiteMm: number;
  hoeheMm: number;
}

export const CANVAS_PRESETS: Record<CanvasPreset, Canvas> = {
  '10x15-quer': { preset: '10x15-quer', breiteMm: 152.4, hoeheMm: 101.6 },
  '10x15-hoch': { preset: '10x15-hoch', breiteMm: 101.6, hoeheMm: 152.4 },
};

/** Druckaufloesung: 300 dpi auf 4x6 Zoll ergibt exakt 1800 x 1200 Pixel. */
export const DRUCK_DPI = 300;

/**
 * Alle Ebenen-Koordinaten sind auf 0..1 normalisiert und beziehen sich auf die
 * Canvas-Flaeche. Damit bleibt eine Vorlage aufloesungsunabhaengig: dieselbe
 * Definition rendert die Bildschirmvorschau und die 1800x1200-Druckdatei.
 */
export interface EbeneBasis {
  id: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drehung in Grad, im Uhrzeigersinn. */
  rotation?: number;
  /** Ausgeblendete Ebenen bleiben in der Datei, werden aber nicht gerendert. */
  sichtbar?: boolean;
  /** Gesperrte Ebenen lassen sich im Editor nicht versehentlich verschieben. */
  gesperrt?: boolean;
}

export interface BildEbene extends EbeneBasis {
  typ: 'bild';
  /** Pfad relativ zum Vorlagen-Ordner. */
  datei: string;
  /** 0..1, fuer dezente Wasserzeichen oder Farbschleier. */
  deckkraft?: number;
}

export type Einpassung = 'cover' | 'contain';

export interface FotoEbene extends EbeneBasis {
  typ: 'foto';
  /** 1-basierte Aufnahmereihenfolge. Bestimmt, welches Foto hier landet. */
  index: number;
  einpassung?: Einpassung;
  /** Eckenradius, normalisiert auf die kuerzere Canvas-Kante. */
  radius?: number;
}

export type TextAusrichtung = 'links' | 'mitte' | 'rechts';

export interface TextEbene extends EbeneBasis {
  typ: 'text';
  /**
   * Darf Platzhalter enthalten: {veranstaltung}, {datum}, {uhrzeit}, {nummer}.
   * Sie werden erst beim Zusammensetzen ersetzt, damit dieselbe Vorlage bei
   * jeder Feier passt.
   */
  text: string;
  /** Schriftgroesse, normalisiert auf die Canvas-Hoehe. */
  groesse: number;
  farbe: string;
  ausrichtung?: TextAusrichtung;
  /**
   * Schriftfamilie, wie sie an den Renderer und den Browser geht. Leer heisst
   * die Vorgabe. Bei einer selbst hinzugefuegten Schrift steht hier der Name
   * aus der Datei, nicht der Dateiname.
   */
  schrift?: string;
  /**
   * Nur bei selbst hinzugefuegten Schriften: die Datei in Fotobox-Daten/schriften.
   * Der Startbereit-Check prueft damit, ob sie noch da ist - eine Vorlage mit
   * verschwundener Schrift faellt sonst erst beim Druck auf.
   */
  schriftDatei?: string;
}

export type Ebene = BildEbene | FotoEbene | TextEbene;

/**
 * Auswahlschriften fuer Textebenen.
 *
 * Alles Schriften, die Windows seit Jahren mitbringt - der Editor und der
 * Renderer laufen auf demselben Rechner, also sieht der Ausdruck aus wie die
 * Vorschau. Die Ersatzangaben dahinter sind fuer die Entwicklung unter Linux,
 * wo die Windows-Schriften fehlen.
 *
 * Reicht die Liste nicht, laesst sich unter Vorlagen eine eigene Schriftdatei
 * hinzufuegen; sie erscheint dann zusaetzlich in dieser Auswahl.
 */
export interface Schriftwahl {
  /** Was in der Auswahl steht. */
  name: string;
  /** Was an SVG und CSS geht, mit Ersatzangaben. */
  familie: string;
}

export const SCHRIFT_VORGABE = 'Segoe UI, DejaVu Sans, sans-serif';

export const SCHRIFTEN: Schriftwahl[] = [
  { name: 'Segoe UI (Vorgabe)', familie: SCHRIFT_VORGABE },
  { name: 'Arial', familie: 'Arial, Liberation Sans, DejaVu Sans, sans-serif' },
  { name: 'Verdana', familie: 'Verdana, DejaVu Sans, sans-serif' },
  { name: 'Tahoma', familie: 'Tahoma, DejaVu Sans, sans-serif' },
  { name: 'Trebuchet MS', familie: 'Trebuchet MS, DejaVu Sans, sans-serif' },
  { name: 'Century Gothic', familie: 'Century Gothic, URW Gothic, DejaVu Sans, sans-serif' },
  { name: 'Franklin Gothic', familie: 'Franklin Gothic Medium, DejaVu Sans, sans-serif' },
  { name: 'Georgia', familie: 'Georgia, DejaVu Serif, serif' },
  { name: 'Times New Roman', familie: 'Times New Roman, Liberation Serif, DejaVu Serif, serif' },
  { name: 'Garamond', familie: 'Garamond, EB Garamond, DejaVu Serif, serif' },
  { name: 'Palatino', familie: 'Palatino Linotype, Book Antiqua, DejaVu Serif, serif' },
  { name: 'Courier New', familie: 'Courier New, Liberation Mono, DejaVu Sans Mono, monospace' },
  { name: 'Impact', familie: 'Impact, DejaVu Sans, sans-serif' },
  { name: 'Comic Sans MS', familie: 'Comic Sans MS, DejaVu Sans, sans-serif' },
  { name: 'Brush Script', familie: 'Brush Script MT, DejaVu Serif, cursive' },
  { name: 'Segoe Script', familie: 'Segoe Script, DejaVu Serif, cursive' },
  { name: 'Segoe Print', familie: 'Segoe Print, DejaVu Sans, cursive' },
  { name: 'Lucida Handwriting', familie: 'Lucida Handwriting, DejaVu Serif, cursive' },
];

export interface Vorlage {
  id: string;
  name: string;
  canvas: Canvas;
  /** Reihenfolge im Array = Stapelreihenfolge, erstes Element ganz unten. */
  ebenen: Ebene[];
  hintergrundFarbe?: string;
  erstellt?: string;
  geaendert?: string;
}

/** Die Anzahl der Foto-Ebenen bestimmt, wie viele Fotos aufgenommen werden. */
export function anzahlFotos(vorlage: Vorlage): number {
  return vorlage.ebenen.filter((e): e is FotoEbene => e.typ === 'foto').length;
}

/** Foto-Ebenen in Aufnahmereihenfolge, unabhaengig von der Stapelreihenfolge. */
export function fotoEbenen(vorlage: Vorlage): FotoEbene[] {
  return vorlage.ebenen
    .filter((e): e is FotoEbene => e.typ === 'foto')
    .sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Ein Filter ist eine Kette benannter Operationen. Alles ausser der 3D-LUT
 * erledigt sharp direkt; fuer .cube-Dateien gibt es eine eigene Routine.
 */
export type FilterOperation =
  | { op: 'graustufen' }
  | { op: 'saettigung'; wert: number }
  | { op: 'helligkeit'; wert: number }
  | { op: 'kontrast'; wert: number }
  | { op: 'farbton'; grad: number }
  | { op: 'tonung'; farbe: string; staerke: number }
  | { op: 'farbmatrix'; matrix: [number, number, number, number, number, number, number, number, number] }
  | { op: 'vignette'; staerke: number }
  | { op: 'lut'; datei: string };

export interface FilterPreset {
  id: string;
  name: string;
  operationen: FilterOperation[];
  /** Eingebaute Presets lassen sich nicht loeschen. */
  eingebaut?: boolean;
}

/** "Ohne Filter" ist immer die erste Kachel und immer vorausgewaehlt. */
export const FILTER_OHNE = 'ohne';

// ---------------------------------------------------------------------------
// Zeiten und Toene
// ---------------------------------------------------------------------------

/**
 * Jede Zeitspanne, die ein Gast erlebt, ist einstellbar. Werte in Sekunden.
 * 0 bedeutet "ueberspringen", wo das sinnvoll ist.
 *
 * Bewusst NICHT enthalten: Vorlagen- und Filterauswahl. Dort muss der Gast
 * entscheiden, eine weglaufende Uhr wuerde ihn nur hetzen. Die Rettungsleine
 * gegen haengengebliebene Sitzungen ist stattdessen sitzungAbbruch.
 */
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

export const ZEITEN_VORGABE: Zeiten = {
  bereitmachenErstes: 5,
  bereitmachenZwischen: 5,
  countdown: 3,
  bestaetigung: 2,
  rueckkehrStart: 20,
  galerieLeerlauf: 60,
  liveViewAbschaltung: 600,
  sitzungAbbruch: 180,
};

export interface Toene {
  countdownPiep: boolean;
  ausloeser: boolean;
  ergebnis: boolean;
}

export const TOENE_VORGABE: Toene = {
  countdownPiep: true,
  ausloeser: true,
  ergebnis: true,
};

// ---------------------------------------------------------------------------
// Veranstaltungen
// ---------------------------------------------------------------------------

export type EventStatus =
  | 'entwurf'
  | 'startbereit'
  | 'aktiv'
  | 'pausiert'
  | 'abgeschlossen'
  | 'archiviert';

/**
 * Erlaubte Statuswechsel. Alles andere wird abgewiesen.
 *
 * Steht hier und nicht im Server, damit die Verwaltung dieselben Regeln kennt:
 * Sie kann damit nur die Wechsel anbieten, die auch durchgehen, statt den
 * Nutzer in eine Fehlermeldung laufen zu lassen.
 */
export const UEBERGAENGE: Record<EventStatus, EventStatus[]> = {
  entwurf: ['startbereit', 'archiviert'],
  startbereit: ['aktiv', 'entwurf', 'archiviert'],
  aktiv: ['pausiert', 'abgeschlossen'],
  pausiert: ['aktiv', 'abgeschlossen'],
  abgeschlossen: ['archiviert', 'aktiv'],
  archiviert: ['entwurf'],
};

/** Was der Status im Klartext heisst - "entwurf" ist ein Datenbankwert, kein Wort fuer eine Oberflaeche. */
export const STATUS_NAME: Record<EventStatus, string> = {
  entwurf: 'Entwurf',
  startbereit: 'Startbereit',
  aktiv: 'Aktiv',
  pausiert: 'Pausiert',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert',
};

/** Die Beschriftung des Knopfes, der dorthin fuehrt - ein Wechsel ist eine Handlung, kein Zustand. */
export const STATUS_WECHSEL: Record<EventStatus, string> = {
  entwurf: 'Zurück in den Entwurf',
  startbereit: 'Als startbereit markieren',
  aktiv: 'Veranstaltung starten',
  pausiert: 'Pause einlegen',
  abgeschlossen: 'Veranstaltung abschließen',
  archiviert: 'Archivieren',
};

export type Fokusverhalten = 'fest' | 'vor-jedem-foto';

export interface EventEinstellungen {
  zeiten: Zeiten;
  toene: Toene;

  /** Ausgabekanaele. Abgeschaltete Knoepfe fehlen auf der Ergebnisseite ganz. */
  druckAktiv: boolean;
  emailAktiv: boolean;
  galerieAktiv: boolean;
  /** Kleiner QR-Code in der Ecke des Startbildschirms. */
  qrAufStartseite: boolean;

  /** Standard 1 vorausgewaehlt; die Obergrenze wird je nach Publikum gesetzt. */
  kopienVorgabe: number;
  kopienMax: number;
  /** 0 = kein Limit. Ist es erreicht, verschwindet die Druck-Schaltflaeche. */
  druckLimit: number;

  ersatzJeDruck: number;
  materialStart: number;

  startTitel: string;
  startUntertitel: string;
  logoDatei?: string;
  farbeAkzent: string;

  fokus: Fokusverhalten;
  einwilligungstext: string;
  /** Tage, nach denen erfasste E-Mail-Adressen automatisch geloescht werden. */
  emailLoeschfristTage: number;

  /** Freigegebene Vorlagen und Filter, in Anzeigereihenfolge. */
  vorlagen: string[];
  filter: string[];
}

export const EINSTELLUNGEN_VORGABE: EventEinstellungen = {
  zeiten: ZEITEN_VORGABE,
  toene: TOENE_VORGABE,
  druckAktiv: true,
  emailAktiv: false,
  galerieAktiv: false,
  qrAufStartseite: true,
  kopienVorgabe: 1,
  kopienMax: 3,
  druckLimit: 0,
  ersatzJeDruck: 0.2,
  materialStart: 700,
  startTitel: 'Fotobox',
  startUntertitel: 'Tippt auf den Knopf und los geht es!',
  farbeAkzent: '#c8963e',
  fokus: 'fest',
  einwilligungstext:
    'Ich moechte mein Foto per E-Mail erhalten und bin damit einverstanden, ' +
    'dass meine Adresse dafuer gespeichert und nach der Veranstaltung geloescht wird.',
  emailLoeschfristTage: 30,
  vorlagen: [],
  filter: [FILTER_OHNE, 'schwarzweiss', 'sepia', 'warm', 'pop'],
};

export interface Veranstaltung {
  id: string;
  name: string;
  datum: string;
  ordner: string;
  status: EventStatus;
  /** Zufallstoken fuer die Handy-Galerie, jederzeit neu erzeugbar. */
  galerieToken: string;
  statusToken: string;
  betreuerPinHash: string | null;
  materialVerbraucht: number;
  probelauf: boolean;
  erstellt: string;
  geschlossenAm: string | null;
  einstellungen: EventEinstellungen;
}

// ---------------------------------------------------------------------------
// Sitzungen, Ausgaben, Druck
// ---------------------------------------------------------------------------

export interface Sitzung {
  id: string;
  eventId: string;
  vorlageId: string;
  filterId: string | null;
  gestartet: string;
  beendet: string | null;
  istTest: boolean;
}

export interface Foto {
  id: string;
  sitzungId: string;
  ebeneIndex: number;
  pfadOriginal: string;
  pfadBearbeitet: string | null;
}

export interface Ausgabe {
  id: string;
  sitzungId: string;
  pfadLayout: string;
  pfadDruckPdf: string | null;
  erstellt: string;
}

export type DruckQuelle = 'kiosk' | 'galerie' | 'servicemenue' | 'testdruck';
export type DruckStatus = 'wartend' | 'laeuft' | 'gedruckt' | 'fehlgeschlagen';

export interface Druckauftrag {
  id: string;
  eventId: string;
  ausgabeId: string | null;
  kopien: number;
  quelle: DruckQuelle;
  status: DruckStatus;
  /** Fehldrucke und Testdrucke zaehlen nicht in den Auslagenersatz. */
  berechnen: boolean;
  angefordert: string;
  gedruckt: string | null;
  fehlertext: string | null;
}

// ---------------------------------------------------------------------------
// Geraet
// ---------------------------------------------------------------------------

/**
 * Druckkalibrierung. Die PDF-Seite bleibt immer exakt 152,4 x 101,6 mm; nur das
 * eingebettete Bild wird verschoben und skaliert. Die engen Bereiche sind Absicht:
 * Abweichungen von Zentimetern sind ein falsches Papierformat im Treiber, kein
 * Kalibrierproblem.
 */
export interface Druckkalibrierung {
  versatzXMm: number;
  versatzYMm: number;
  skalierungXProzent: number;
  skalierungYProzent: number;
}

export const KALIBRIERUNG_VORGABE: Druckkalibrierung = {
  versatzXMm: 0,
  versatzYMm: 0,
  skalierungXProzent: 100,
  skalierungYProzent: 100,
};

export const KALIBRIERUNG_GRENZEN = {
  versatzMm: { min: -5, max: 5, schritt: 0.1 },
  skalierungProzent: { min: 95, max: 105, schritt: 0.1 },
} as const;

export interface Kameraeinstellungen {
  iso: string;
  blende: string;
  verschlusszeit: string;
}

export interface Geraeteeinstellungen {
  datenpfad: string;
  druckerName: string;
  kalibrierung: Druckkalibrierung;
  kamera: Kameraeinstellungen;
  besitzerPinHash: string | null;
  /** Warnschwelle in Gigabyte, ab der der Speicherplatz gemeldet wird. */
  speicherWarnungGb: number;
  digicamcontrolPfad: string;
  sumatraPfad: string;
}

// ---------------------------------------------------------------------------
// Betriebszustand
// ---------------------------------------------------------------------------

export type GeraeteZustand = 'bereit' | 'gestoert' | 'unbekannt';

/**
 * Stoerungsarten. Jede bekommt einen laienverstaendlichen Text fuer den
 * Gaestebildschirm - kein Fehlercode, kein Geraetename, aber genug, dass ein
 * Gast das Problem weitergeben kann.
 */
export type Stoerung =
  | 'papier-leer'
  | 'drucker-offline'
  | 'drucker-klappe'
  | 'kamera-offline'
  | 'speicher-voll'
  | 'aussetzer';

export interface Betriebsstatus {
  kamera: GeraeteZustand;
  drucker: GeraeteZustand;
  liveViewLaeuft: boolean;
  stoerung: Stoerung | null;
  warteschlangeOffen: number;
  materialRest: number;
  speicherFreiGb: number;
  aktivesEvent: { id: string; name: string; probelauf: boolean } | null;
}

export const STOERUNGSTEXTE: Record<Stoerung, { titel: string; folge: string; tun: string }> = {
  'papier-leer': {
    titel: 'Das Druckerpapier ist leer.',
    folge: 'Dein Foto ist gespeichert und wird gedruckt, sobald neues Papier eingelegt ist.',
    tun: 'Sag bitte kurz jemandem vom Gastgeber Bescheid.',
  },
  'drucker-offline': {
    titel: 'Der Drucker meldet sich gerade nicht.',
    folge: 'Dein Foto ist gespeichert. Sobald er wieder laeuft, wird gedruckt.',
    tun: 'Bitte gib jemandem Bescheid, dass der Drucker aus ist.',
  },
  'drucker-klappe': {
    titel: 'Am Drucker klemmt gerade etwas.',
    folge: 'Dein Foto ist gespeichert.',
    tun: 'Bitte sag jemandem Bescheid.',
  },
  'kamera-offline': {
    titel: 'Die Kamera meldet sich gerade nicht.',
    folge: 'Ich versuche es weiter.',
    tun: 'Wenn es gleich nicht von selbst geht: bitte jemandem sagen, dass die Kamera keine Verbindung hat.',
  },
  'speicher-voll': {
    titel: 'Es wird eng auf dem Speicher.',
    folge: 'Fotografieren geht weiter.',
    tun: 'Bitte gib jemandem Bescheid.',
  },
  aussetzer: {
    titel: 'Kleine Pause.',
    folge: 'Gleich geht es weiter.',
    tun: '',
  },
};
