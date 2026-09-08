import { describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Der Schriftenordner muss fontconfig bekannt sein, BEVOR sharp geladen wird -
 * die Bibliothek liest FONTCONFIG_PATH beim Initialisieren und schaut danach
 * nicht mehr hin. vi.hoisted laeuft vor den Importen dieser Datei und stellt
 * damit dieselbe Reihenfolge her wie schriften-start.ts im echten Server.
 * Ohne diesen Kniff wuerde der Test gruen sein und die Software trotzdem
 * kaputt - genau so ist der Fehler ueberhaupt aufgefallen.
 */
const umgebung = await vi.hoisted(async () => {
  const { mkdtempSync, existsSync: gibtEs, readFileSync: lies, writeFileSync: schreib } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: verbinde } = await import('node:path');
  const { richteSchriftenEin } = await import('../fach/schriften.js');

  const daten = mkdtempSync(verbinde(tmpdir(), 'fb-schrift-'));
  const ordner = richteSchriftenEin(daten);

  /*
   * Eine Schrift, die es sonst nirgends gibt: eine Kopie mit geaendertem
   * Familiennamen. Mit einer systemweit installierten Schrift bewiese der Test
   * nichts - sie waere so oder so da. Der neue Name ist genau so lang wie der
   * alte, damit die Sprungmarken in der Datei gueltig bleiben.
   */
  const quelle = '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf';
  const eigenerName = 'Fotobox Testxyz';
  let eigeneDatei: string | null = null;
  if (gibtEs(quelle)) {
    const utf16 = (text: string) =>
      text
        .split('')
        .map((z) => '\u0000' + z)
        .join('');
    const inhalt = lies(quelle)
      .toString('latin1')
      .split('Liberation Mono')
      .join(eigenerName)
      .split(utf16('Liberation Mono'))
      .join(utf16(eigenerName));
    eigeneDatei = verbinde(ordner, 'nur-hier.ttf');
    schreib(eigeneDatei, Buffer.from(inhalt, 'latin1'));
  }

  return { daten, ordner, eigenerName, eigeneDatei };
});

import sharp from 'sharp';
import { familieAus } from '../fach/schriften.js';
import { baueLayout } from '../bild/layout.js';

/**
 * Der Familienname muss aus der Datei kommen, nicht aus dem Dateinamen:
 * "DejaVuSerif.ttf" heisst innen "DejaVu Serif", und genau das muss
 * font-family treffen.
 */
describe('Schriftdateien', () => {
  const pfade = existsSync('/usr/share/fonts')
    ? execSync('find /usr/share/fonts -name "*.ttf" | head -5', { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean)
    : [];

  it('liest den Familiennamen aus der Datei', () => {
    if (pfade.length === 0) return; // Ohne Systemschriften nicht pruefbar.
    const namen = pfade.map((p) => familieAus(p));
    expect(namen.filter((n) => n && n.length > 0).length).toBe(pfade.length);
    // Kein Name darf auf .ttf enden - das waere der durchgereichte Dateiname.
    expect(namen.some((n) => n?.endsWith('.ttf'))).toBe(false);
  });

  it('gibt bei einer Datei, die keine Schrift ist, null zurueck statt zu werfen', () => {
    expect(familieAus('/etc/hostname')).toBeNull();
    expect(familieAus('/gibt/es/nicht.ttf')).toBeNull();
  });
});

/**
 * Der eigentliche Punkt der Schriftauswahl: Sie muss den Ausdruck aendern,
 * nicht nur die Vorschau. Gemessen wird die Zahl dunkler Pixel im gerenderten
 * Layout - eine grobe, aber eindeutige Signatur der Buchstabenform.
 */
describe('Schriftwahl im Druckweg', () => {
  function vorlage(schrift?: string) {
    return {
      id: 't',
      name: 't',
      canvas: { preset: '10x15-quer', breiteMm: 152.4, hoeheMm: 101.6 },
      ebenen: [
        {
          id: 'a',
          typ: 'text' as const,
          x: 0.05,
          y: 0.3,
          w: 0.9,
          h: 0.4,
          text: 'Anna & Ben',
          groesse: 0.18,
          farbe: '#000000',
          ...(schrift ? { schrift } : {}),
        },
      ],
      hintergrundFarbe: '#ffffff',
    };
  }

  async function dunklePixel(schrift?: string): Promise<number> {
    const bild = await baueLayout(
      vorlage(schrift) as never,
      { fotos: new Map(), assetsOrdner: umgebung.daten, platzhalter: {} },
      { breitePx: 600, hoehePx: 400 },
    );
    const roh = await sharp(bild).greyscale().raw().toBuffer();
    let dunkel = 0;
    for (const wert of roh) if (wert < 128) dunkel += 1;
    return dunkel;
  }

  it('rendert mit verschiedenen Schriften verschieden', async () => {
    const vorgabe = await dunklePixel();
    const serif = await dunklePixel('DejaVu Serif, serif');
    const mono = await dunklePixel('DejaVu Sans Mono, monospace');

    expect(vorgabe).toBeGreaterThan(0);
    expect(serif).not.toBe(vorgabe);
    expect(mono).not.toBe(vorgabe);
    expect(mono).not.toBe(serif);
  });

  /*
   * Der Kern der Sache: Eine Schrift, die NUR im Schriftenordner liegt, muss
   * der Renderer finden. Mit einer Schrift, die auch systemweit installiert
   * ist, bewiese der Test nichts - sie waere so oder so da. Deshalb bekommt
   * eine Kopie einen Familiennamen, den es sonst nirgends gibt. Der neue Name
   * ist genau so lang wie der alte, damit die Sprungmarken in der Datei
   * gueltig bleiben.
   */
  it('findet eine Schrift, die es nur im Schriftenordner gibt', async () => {
    if (!umgebung.eigeneDatei) return; // Ohne die Systemschrift nicht pruefbar.
    expect(familieAus(umgebung.eigeneDatei)).toBe(umgebung.eigenerName);

    // Gefunden heisst: sieht anders aus als ein Name, den es nicht gibt (der
    // auf die Ersatzschrift faellt).
    const gefunden = await dunklePixel(umgebung.eigenerName);
    const unbekannt = await dunklePixel('Gibtesnichtxyz123');
    expect(gefunden).not.toBe(unbekannt);
  });
});
