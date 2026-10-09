/**
 * Symbole fuer das Gaestebuch - eine feste Auswahl, die zu Hochzeiten wie zu
 * Geburtstagen passt.
 *
 * Bewusst keine Emojis: Die saehen je nach Schriftart anders aus und wirkten
 * im ausgedruckten Gaestebuch billig. Stattdessen schlichte Strichzeichnungen
 * in der gewaehlten Tintenfarbe - sie fuegen sich in die Handschrift ein.
 *
 * Jeder Pfad liegt in einem Feld von 100 x 100 und wird nur nachgezogen, nie
 * gefuellt.
 */
export interface GaestebuchSymbol {
  name: string;
  pfad: string;
}

export const SYMBOLE: GaestebuchSymbol[] = [
  {
    name: 'Herz',
    pfad: 'M50 84 C 22 64, 10 48, 13 32 C 16 17, 35 13, 50 29 C 65 13, 84 17, 87 32 C 90 48, 78 64, 50 84 Z',
  },
  {
    name: 'Ringe',
    pfad:
      'M40 62 m -22 0 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0 ' +
      'M62 62 m -22 0 a 22 22 0 1 0 44 0 a 22 22 0 1 0 -44 0 ' +
      'M33 31 L40 22 L47 31 L40 39 Z',
  },
  {
    name: 'Sektgläser',
    pfad:
      'M20 22 L36 17 L41 48 Q37 57 30 51 Z M35 55 L39 80 M30 83 L47 78 ' +
      'M80 22 L64 17 L59 48 Q63 57 70 51 Z M65 55 L61 80 M70 83 L53 78 ' +
      'M50 5 L50 14 M45 9 L55 9',
  },
  {
    name: 'Torte',
    pfad:
      'M14 86 L86 86 M20 86 L20 62 L80 62 L80 86 M28 62 L28 46 L72 46 L72 62 ' +
      'M20 72 Q30 79 40 72 Q50 65 60 72 Q70 79 80 72 ' +
      'M50 46 L50 33 M50 28 Q45 22 50 14 Q55 22 50 28 Z',
  },
  {
    name: 'Geschenk',
    pfad:
      'M20 46 L80 46 L80 86 L20 86 Z M15 34 L85 34 L85 46 L15 46 Z M50 34 L50 86 ' +
      'M50 34 Q36 14 28 24 Q24 33 50 34 M50 34 Q64 14 72 24 Q76 33 50 34',
  },
  {
    name: 'Luftballons',
    pfad:
      'M36 52 C 18 50, 17 20, 36 16 C 55 20, 54 50, 36 52 Z M36 52 L33 56 L39 56 Z ' +
      'M66 46 C 50 44, 49 16, 66 12 C 83 16, 82 44, 66 46 Z M66 46 L63 50 L69 50 Z ' +
      'M36 56 Q30 72 47 90 M66 50 Q72 70 47 90',
  },
  {
    name: 'Blume',
    pfad:
      'M50 38 m -8 0 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0 ' +
      'M50 20 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 ' +
      'M66 32 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 ' +
      'M60 51 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 ' +
      'M40 51 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 ' +
      'M34 32 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 ' +
      'M50 60 Q47 76 50 92 M50 76 Q37 64 28 69 Q37 78 50 76',
  },
  {
    name: 'Sterne',
    pfad:
      'M42 14 Q45 42 72 46 Q45 50 42 78 Q39 50 12 46 Q39 42 42 14 Z ' +
      'M76 12 Q77 22 86 23 Q77 24 76 34 Q75 24 66 23 Q75 22 76 12 Z ' +
      'M76 64 Q77 70 82 71 Q77 72 76 78 Q75 72 70 71 Q75 70 76 64 Z',
  },
  {
    name: 'Smiley',
    pfad: 'M50 50 m -36 0 a 36 36 0 1 0 72 0 a 36 36 0 1 0 -72 0 M38 38 L38 44 M62 38 L62 44 M31 57 Q50 78 69 57',
  },
];
