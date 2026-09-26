import { z } from 'zod';

/*
 * Was die Verwaltung in einer Veranstaltung speichern darf.
 *
 * Vorher nahm der Server jede Einstellung ungeprueft an. Die Verwaltung
 * speichert sofort bei jeder Eingabe - wer ein Zahlenfeld leerte, um eine neue
 * Zahl zu tippen, speicherte damit eine 0. Beim Sitzungsabbruch hiess das:
 * Jede Aufnahme wurde nach wenigen Sekunden verworfen. Beim Countdown: Die
 * Kamera loeste ohne Vorwarnung aus. Bei "Kopien hoechstens": Niemand konnte
 * mehr drucken. Jetzt hat jedes Feld seine Grenzen, und was ausserhalb liegt,
 * wird mit einer verstaendlichen Meldung abgelehnt statt gespeichert.
 */

const ganz = (name: string, min: number, max: number) =>
  z
    .number({ error: `${name}: bitte eine Zahl eintragen.` })
    .int(`${name}: bitte eine ganze Zahl.`)
    .min(min, `${name}: mindestens ${min}.`)
    .max(max, `${name}: höchstens ${max}.`);

const text = (name: string, max: number) => z.string().max(max, `${name}: höchstens ${max} Zeichen.`);

export const ZEITEN_EINGABE = z
  .object({
    bereitmachenErstes: ganz('Bereitmachen vor dem ersten Foto', 0, 60),
    bereitmachenZwischen: ganz('Bereitmachen zwischen den Fotos', 0, 60),
    countdown: ganz('Countdown-Dauer', 1, 10),
    bestaetigung: ganz('Bestätigung des Fotos', 0, 10),
    rueckkehrStart: ganz('Rückkehr zum Startbildschirm', 5, 600),
    galerieLeerlauf: ganz('Leerlauf in der Galerie', 10, 600),
    liveViewAbschaltung: ganz('Live-View-Abschaltung', 0, 86_400),
    sitzungAbbruch: ganz('Sitzungsabbruch bei Untätigkeit', 30, 1800),
  })
  .partial()
  .strict();

export const EINSTELLUNGEN_EINGABE = z
  .object({
    zeiten: ZEITEN_EINGABE,
    toene: z
      .object({ countdownPiep: z.boolean(), ausloeser: z.boolean(), ergebnis: z.boolean() })
      .partial()
      .strict(),
    druckAktiv: z.boolean(),
    emailAktiv: z.boolean(),
    galerieAktiv: z.boolean(),
    qrAufStartseite: z.boolean(),
    kopienVorgabe: ganz('Kopien vorausgewählt', 1, 10),
    kopienMax: ganz('Kopien je Foto höchstens', 1, 10),
    druckLimit: ganz('Druck-Limit gesamt', 0, 100_000),
    ersatzJeDruck: z
      .number({ error: 'Ersatz je Druck: bitte eine Zahl eintragen.' })
      .min(0, 'Ersatz je Druck: nicht negativ.')
      .max(100, 'Ersatz je Druck: höchstens 100 €.'),
    materialStart: ganz('Material Start', 0, 100_000),
    startTitel: text('Titel', 80),
    startUntertitel: text('Untertitel', 160),
    logoDatei: z.string().regex(/^[A-Za-z0-9._-]{1,120}$/).optional(),
    farbeAkzent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Akzentfarbe als #RRGGBB.'),
    fokus: z.enum(['fest', 'vor-jedem-foto']),
    einwilligungstext: z
      .string()
      .trim()
      .min(20, 'Der Einwilligungstext ist zu kurz - der Gast muss lesen können, wozu er zustimmt.')
      .max(1000, 'Einwilligungstext: höchstens 1000 Zeichen.'),
    emailLoeschfristTage: ganz('Adressen löschen nach', 1, 365),
    vorlagen: z.array(z.string().max(64)).max(50),
    filter: z.array(z.string().max(64)).max(50),
  })
  .partial()
  .strict();

/** 4 bis 8 Ziffern - genau das, was das Tastenfeld am Kiosk eingeben kann. */
export const PIN_EINGABE = z
  .string()
  .regex(/^\d{4,8}$/, 'Die PIN besteht aus 4 bis 8 Ziffern - mehr kann das Tastenfeld am Kiosk nicht eingeben.');

export const EVENT_NAME = z.string().trim().min(1, 'Die Veranstaltung braucht einen Namen.').max(80, 'Name: höchstens 80 Zeichen.');

export const EVENT_DATUM = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT.')
  // Date.parse allein reicht nicht: JavaScript macht aus dem 31. Februar
  // stillschweigend den 3. Maerz. Also zurueckrechnen und vergleichen.
  .refine((d) => {
    const [jahr, monat, tag] = d.split('-').map(Number) as [number, number, number];
    const echt = new Date(Date.UTC(jahr, monat - 1, tag));
    return echt.getUTCFullYear() === jahr && echt.getUTCMonth() === monat - 1 && echt.getUTCDate() === tag;
  }, 'Dieses Datum gibt es nicht.');

/** Die erste Meldung eines Pruefergebnisses - schon in Worten fuer den Besitzer. */
export function ersteMeldung(fehler: z.ZodError): string {
  const erstes = fehler.issues[0];
  if (!erstes) return 'Ungültige Eingabe.';
  if (erstes.code === 'unrecognized_keys') return `Unbekannte Einstellung: ${erstes.keys.join(', ')}.`;
  return erstes.message;
}
