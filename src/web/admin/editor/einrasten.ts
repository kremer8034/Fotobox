/**
 * Einrasten an Kanten und Mitten.
 *
 * Der Editor rechnet in normalisierten Koordinaten (0..1). Beim Ziehen werden
 * die Kanten und die Mitte der bewegten Ebene mit denen aller anderen Ebenen
 * und der Leinwand verglichen. Liegt etwas naeher als die Toleranz, rastet es
 * ein - und die Stelle wird als Hilfslinie gezeigt, damit man sieht, woran.
 */

export interface Rechteck {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Einrastergebnis {
  x: number;
  y: number;
  hilfslinienX: number[];
  hilfslinienY: number[];
}

/** Sammelt die Werte, an denen eingerastet werden kann. */
export function kandidaten(andere: Rechteck[], achse: 'x' | 'y'): number[] {
  const liste = [0, 0.5, 1];
  for (const r of andere) {
    const anfang = achse === 'x' ? r.x : r.y;
    const laenge = achse === 'x' ? r.w : r.h;
    liste.push(anfang, anfang + laenge / 2, anfang + laenge);
  }
  return liste;
}

/**
 * Rastet eine bewegte Ebene ein. Verglichen werden linke Kante, Mitte und
 * rechte Kante - so richtet sich ein Element auch dann sauber aus, wenn man es
 * an seiner Mitte orientiert.
 */
export function raste(bewegt: Rechteck, andere: Rechteck[], toleranz: number): Einrastergebnis {
  const ergebnis: Einrastergebnis = {
    x: bewegt.x,
    y: bewegt.y,
    hilfslinienX: [],
    hilfslinienY: [],
  };

  for (const achse of ['x', 'y'] as const) {
    const anfang = achse === 'x' ? bewegt.x : bewegt.y;
    const laenge = achse === 'x' ? bewegt.w : bewegt.h;
    const punkte = [0, laenge / 2, laenge];

    let besteAbweichung = toleranz;
    let besterAnfang: number | null = null;
    let besteLinie: number | null = null;

    for (const versatz of punkte) {
      for (const kandidat of kandidaten(andere, achse)) {
        const abweichung = Math.abs(anfang + versatz - kandidat);
        if (abweichung < besteAbweichung) {
          besteAbweichung = abweichung;
          besterAnfang = kandidat - versatz;
          besteLinie = kandidat;
        }
      }
    }

    if (besterAnfang !== null && besteLinie !== null) {
      if (achse === 'x') {
        ergebnis.x = besterAnfang;
        ergebnis.hilfslinienX.push(besteLinie);
      } else {
        ergebnis.y = besterAnfang;
        ergebnis.hilfslinienY.push(besteLinie);
      }
    }
  }

  return ergebnis;
}

/** Haelt eine Ebene in sinnvollen Grenzen, ohne sie zwanghaft einzusperren. */
export function begrenze(r: Rechteck): Rechteck {
  const mindest = 0.02;
  return {
    x: Math.min(1, Math.max(-0.5, r.x)),
    y: Math.min(1, Math.max(-0.5, r.y)),
    w: Math.max(mindest, Math.min(2, r.w)),
    h: Math.max(mindest, Math.min(2, r.h)),
  };
}

/** Ausrichten mehrerer Ebenen an der Leinwand. */
export type Ausrichtung = 'links' | 'mitte-x' | 'rechts' | 'oben' | 'mitte-y' | 'unten';

export function richteAus(r: Rechteck, wohin: Ausrichtung): Rechteck {
  switch (wohin) {
    case 'links':
      return { ...r, x: 0 };
    case 'mitte-x':
      return { ...r, x: (1 - r.w) / 2 };
    case 'rechts':
      return { ...r, x: 1 - r.w };
    case 'oben':
      return { ...r, y: 0 };
    case 'mitte-y':
      return { ...r, y: (1 - r.h) / 2 };
    case 'unten':
      return { ...r, y: 1 - r.h };
  }
}

/** Gleiche Abstaende zwischen drei oder mehr Ebenen. */
export function verteile<T extends Rechteck>(ebenen: T[], achse: 'x' | 'y'): T[] {
  if (ebenen.length < 3) return ebenen;
  const sortiert = [...ebenen].sort((a, b) => (achse === 'x' ? a.x - b.x : a.y - b.y));
  const erste = sortiert[0]!;
  const letzte = sortiert[sortiert.length - 1]!;

  const anfang = achse === 'x' ? erste.x : erste.y;
  const ende = achse === 'x' ? letzte.x + letzte.w : letzte.y + letzte.h;
  const summe = sortiert.reduce((s, r) => s + (achse === 'x' ? r.w : r.h), 0);
  const luecke = (ende - anfang - summe) / (sortiert.length - 1);

  let lauf = anfang;
  return sortiert.map((r) => {
    const neu = achse === 'x' ? { ...r, x: lauf } : { ...r, y: lauf };
    lauf += (achse === 'x' ? r.w : r.h) + luecke;
    return neu;
  });
}
