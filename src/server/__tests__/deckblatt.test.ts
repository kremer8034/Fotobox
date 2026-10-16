import { describe, expect, it } from 'vitest';
import { titelPunkte, waehleTitelfotos, type TitelKandidat } from '../fach/gaestebuch.js';

/*
 * Das Deckblatt des Gaestebuchs: drei Fotos aus Anfang, Hoehepunkt und Ende -
 * ohne Aufbaufotos, ausgewaehlt nur aus Daten (Kopien, Nachdrucke, Mails,
 * Gruesse, Layout), ohne ein Bild anzusehen.
 */

const START = Date.parse('2026-10-10T17:00:00Z');
const MIN = 60_000;
let nr = 0;
const foto = (minute: number, mehr: Partial<TitelKandidat> = {}): TitelKandidat => ({
  ausgabeId: `f${String(++nr).padStart(3, '0')}`,
  pfadLayout: `/x/${nr}.jpg`,
  zeit: START + minute * MIN,
  kopien: 1,
  nachdrucke: 0,
  mails: 0,
  gruss: false,
  quer: true,
  ...mehr,
});
const ids = (k: TitelKandidat[]) => k.map((f) => f.ausgabeId);

describe('Deckblatt des Gästebuchs', () => {
  it('vergibt Punkte für Kopien, Nachdruck, Mail und Gruß', () => {
    expect(titelPunkte(foto(0, { kopien: 4 }))).toBe(4);
    expect(titelPunkte(foto(0, { kopien: 2, nachdrucke: 2, mails: 1, gruss: true }))).toBe(2 + 3 + 2 + 3);
    expect(titelPunkte(foto(0, { kopien: 0 }))).toBe(0);
  });

  it('lässt den Aufbau vor der ersten langen Pause weg', () => {
    const aufbau = [foto(0, { kopien: 9 }), foto(2, { kopien: 9 }), foto(4, { kopien: 9 })];
    const feier = [60, 70, 80, 90, 100, 110, 120, 130, 140].map((m) => foto(m));
    const auswahl = waehleTitelfotos([...aufbau, ...feier]);
    expect(auswahl).toHaveLength(3);
    for (const f of auswahl) expect(ids(aufbau)).not.toContain(f.ausgabeId);
  });

  it('ohne lange Pause zählen nur die ersten zehn Minuten als Aufbau', () => {
    const frueh = [foto(0, { kopien: 9 }), foto(5, { kopien: 9 })];
    const rest = Array.from({ length: 12 }, (_, i) => foto(12 + i * 8));
    const auswahl = waehleTitelfotos([...frueh, ...rest]);
    for (const f of auswahl) expect(ids(frueh)).not.toContain(f.ausgabeId);
  });

  it('eine lange Pause nach vielen Fotos ist kein Aufbau, sondern eine Essenspause', () => {
    // 12 Fotos vor der Pause: Das war schon die Feier.
    const vorher = Array.from({ length: 12 }, (_, i) => foto(20 + i * 5));
    const nachher = Array.from({ length: 12 }, (_, i) => foto(180 + i * 5));
    const auswahl = waehleTitelfotos([...vorher, ...nachher]);
    // Das erste Drittel liegt vor der Pause.
    expect(ids(vorher)).toContain(auswahl[0]!.ausgabeId);
  });

  it('nimmt aus jedem Drittel das Foto mit den meisten Punkten, in zeitlicher Reihenfolge', () => {
    const f = Array.from({ length: 9 }, (_, i) => foto(20 + i * 10));
    f[1]!.kopien = 5; // Anfang
    f[5]!.nachdrucke = 1; // Hoehepunkt: 1 + 3
    f[7]!.gruss = true; // Ende: 1 + 3
    f[8]!.mails = 1; // Ende: 1 + 2 - verliert gegen den Gruss
    expect(ids(waehleTitelfotos(f))).toEqual(ids([f[1]!, f[5]!, f[7]!]));
  });

  it('bei Gleichstand gewinnt das Querformat, dann die Mitte des Drittels', () => {
    const f = Array.from({ length: 9 }, (_, i) => foto(20 + i * 10, { quer: false }));
    f[2]!.quer = true; // Anfang: einziges Querformat, obwohl am Rand
    const auswahl = waehleTitelfotos(f);
    expect(auswahl[0]!.ausgabeId).toBe(f[2]!.ausgabeId);
    // Mitte und Ende: alles gleich - die Mitte ihres Drittels.
    expect(auswahl[1]!.ausgabeId).toBe(f[4]!.ausgabeId);
    expect(auswahl[2]!.ausgabeId).toBe(f[7]!.ausgabeId);
  });

  it('ohne Drucken: trotzdem Anfang, Mitte und Ende statt der ersten drei', () => {
    const f = Array.from({ length: 30 }, (_, i) => foto(20 + i * 6, { kopien: 0 }));
    const auswahl = waehleTitelfotos(f);
    expect(ids(auswahl)).not.toEqual(ids(f.slice(0, 3)));
    expect(auswahl[0]!.zeit).toBeLessThan(auswahl[1]!.zeit);
    expect(auswahl[1]!.zeit).toBeLessThan(auswahl[2]!.zeit);
  });

  it('wenige Fotos: nichts aussortieren, im Zweifel alle nehmen', () => {
    const zwei = [foto(0), foto(3)];
    expect(ids(waehleTitelfotos(zwei))).toEqual(ids(zwei));
    // 5 Fotos, alle in den ersten Minuten: kein Aufbau-Filter unter 6 Fotos.
    const fuenf = [0, 1, 2, 3, 4].map((m) => foto(m));
    expect(waehleTitelfotos(fuenf)).toHaveLength(3);
    expect(waehleTitelfotos([])).toEqual([]);
  });

  it('bleiben nach dem Aufbau keine drei Fotos, wird nichts weggelassen', () => {
    const f = [foto(0), foto(1), foto(2), foto(3), foto(4), foto(60), foto(61)];
    expect(waehleTitelfotos(f)).toHaveLength(3);
  });

  it('wählt bei gleichen Daten immer dasselbe', () => {
    const f = Array.from({ length: 20 }, (_, i) => foto(20 + i * 7, { kopien: (i * 7) % 4 }));
    expect(ids(waehleTitelfotos(f))).toEqual(ids(waehleTitelfotos([...f].reverse())));
  });
});
