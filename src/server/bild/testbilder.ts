import sharp from 'sharp';
import { DRUCK_DPI, type Canvas } from '../../shared/typen.js';
import { layoutMasse } from './layout.js';

/**
 * Testbilder fuer den Drucker.
 *
 * Zu unterscheiden sind zwei Dinge:
 *  - Der Layout-Testdruck aus dem Vorlagen-Editor prueft, ob die Proportionen
 *    einer Vorlage stimmen. Er nutzt Platzhalter statt echter Fotos.
 *  - Das Kalibrier-Testbild hier gehoert zum Drucker, nicht zur Vorlage. Mit
 *    der Millimeterskala an allen vier Raendern liest man ab, wie viel der
 *    randlose Druck tatsaechlich wegschneidet.
 *
 * Beide zaehlen nicht in den Auslagenersatz.
 */

/** Farbige, nummerierte Platzhalter fuer den Layout-Testdruck. */
export async function platzhalterFoto(nummer: number, breite = 1200, hoehe = 800): Promise<Buffer> {
  const farben = ['#7c9cbf', '#bf7c7c', '#8dbf7c', '#bfae7c', '#a97cbf', '#7cbfb4'];
  const farbe = farben[(nummer - 1) % farben.length] ?? '#888888';
  const svg = `<svg width="${breite}" height="${hoehe}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${breite}" height="${hoehe}" fill="${farbe}"/>
    <text x="${breite / 2}" y="${hoehe / 2}" font-family="DejaVu Sans, sans-serif"
          font-size="${Math.round(hoehe * 0.4)}" fill="#ffffff" text-anchor="middle"
          dominant-baseline="central" opacity="0.85">${nummer}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Kalibrier-Testbild: Millimeterskala an allen vier Raendern, Beschriftung alle
 * 5 mm, Fadenkreuz in der Mitte und ein Rahmen auf der exakten Sollkante.
 */
export async function kalibrierTestbild(canvas: Canvas): Promise<Buffer> {
  const { breitePx, hoehePx } = layoutMasse({ canvas } as never);
  const pxJeMm = DRUCK_DPI / 25.4;
  const teile: string[] = [];

  const strichLang = Math.round(pxJeMm * 6);
  const strichKurz = Math.round(pxJeMm * 3);

  const breiteMm = canvas.breiteMm;
  const hoeheMm = canvas.hoeheMm;

  // Waagerechte Skalen oben und unten
  for (let mm = 0; mm <= Math.floor(breiteMm); mm += 1) {
    const x = Math.round(mm * pxJeMm);
    const lang = mm % 5 === 0;
    const laenge = lang ? strichLang : strichKurz;
    teile.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${laenge}" stroke="#000" stroke-width="${lang ? 2 : 1}"/>`,
      `<line x1="${x}" y1="${hoehePx}" x2="${x}" y2="${hoehePx - laenge}" stroke="#000" stroke-width="${lang ? 2 : 1}"/>`,
    );
    if (mm % 5 === 0 && mm > 0 && mm < breiteMm) {
      teile.push(
        `<text x="${x + 3}" y="${laenge + 26}" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#000">${mm}</text>`,
        `<text x="${x + 3}" y="${hoehePx - laenge - 8}" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#000">${mm}</text>`,
      );
    }
  }

  // Senkrechte Skalen links und rechts
  for (let mm = 0; mm <= Math.floor(hoeheMm); mm += 1) {
    const y = Math.round(mm * pxJeMm);
    const lang = mm % 5 === 0;
    const laenge = lang ? strichLang : strichKurz;
    teile.push(
      `<line x1="0" y1="${y}" x2="${laenge}" y2="${y}" stroke="#000" stroke-width="${lang ? 2 : 1}"/>`,
      `<line x1="${breitePx}" y1="${y}" x2="${breitePx - laenge}" y2="${y}" stroke="#000" stroke-width="${lang ? 2 : 1}"/>`,
    );
    if (mm % 5 === 0 && mm > 0 && mm < hoeheMm) {
      teile.push(
        `<text x="${laenge + 6}" y="${y + 8}" font-family="DejaVu Sans, sans-serif" font-size="22" fill="#000">${mm}</text>`,
      );
    }
  }

  const mitteX = breitePx / 2;
  const mitteY = hoehePx / 2;
  const kreuz = Math.round(pxJeMm * 10);

  const svg = `<svg width="${breitePx}" height="${hoehePx}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${breitePx}" height="${hoehePx}" fill="#ffffff"/>
    <rect x="1" y="1" width="${breitePx - 2}" height="${hoehePx - 2}" fill="none" stroke="#d00" stroke-width="3"/>
    ${teile.join('')}
    <line x1="${mitteX - kreuz}" y1="${mitteY}" x2="${mitteX + kreuz}" y2="${mitteY}" stroke="#000" stroke-width="2"/>
    <line x1="${mitteX}" y1="${mitteY - kreuz}" x2="${mitteX}" y2="${mitteY + kreuz}" stroke="#000" stroke-width="2"/>
    <text x="${mitteX}" y="${mitteY - kreuz - 20}" font-family="DejaVu Sans, sans-serif" font-size="34"
          fill="#000" text-anchor="middle">Kalibrier-Testbild ${breiteMm} x ${hoeheMm} mm</text>
    <text x="${mitteX}" y="${mitteY + kreuz + 46}" font-family="DejaVu Sans, sans-serif" font-size="26"
          fill="#444" text-anchor="middle">Roter Rahmen = Sollkante. Fehlende Millimeter an den Skalen ablesen.</text>
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
}
