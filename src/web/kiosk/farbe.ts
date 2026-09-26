/**
 * Die Akzentfarbe steht pro Veranstaltung im Admin. Die Schrift darauf war
 * bisher fest auf ein dunkles Braun gesetzt - bei einem dunklen Akzent stand
 * damit dunkle Schrift auf dunklem Grund und der Hauptknopf war unlesbar.
 * Deshalb wird die Schriftfarbe aus der Helligkeit des Akzents gerechnet.
 */
export function schriftAuf(hex: string): string {
  const rgb = zuRgb(hex);
  if (!rgb) return '#191307';
  // Wahrgenommene Helligkeit nach ITU-R BT.601 - fuer diese Entscheidung
  // genauer als der schlichte Mittelwert der drei Kanaele.
  const helligkeit = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return helligkeit > 150 ? '#191307' : '#ffffff';
}

/** Derselbe Farbton als halbdurchsichtiger Schimmer fuer den Schein am Knopf. */
export function schimmerAus(hex: string): string {
  const rgb = zuRgb(hex);
  if (!rgb) return 'rgba(208, 160, 74, 0.28)';
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`;
}

function zuRgb(hex: string): { r: number; g: number; b: number } | null {
  const sauber = hex.trim().replace('#', '');
  const voll =
    sauber.length === 3
      ? sauber
          .split('')
          .map((z) => z + z)
          .join('')
      : sauber;
  if (!/^[0-9a-fA-F]{6}$/.test(voll)) return null;
  return {
    r: parseInt(voll.slice(0, 2), 16),
    g: parseInt(voll.slice(2, 4), 16),
    b: parseInt(voll.slice(4, 6), 16),
  };
}
