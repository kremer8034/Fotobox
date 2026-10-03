import { describe, expect, it } from 'vitest';
import { statusEintraege, type Boxzustand } from '../Statusliste.js';

const grund: Boxzustand = {
  kamera: 'bereit',
  drucker: 'bereit',
  warteschlangeOffen: 0,
  materialRest: 501,
  speicherFreiGb: 160,
  sitzungen: 19,
  drucke: 6,
};

describe('Papierstand im Servicemenue', () => {
  it('zeigt die Blattzahl laut Drucker', () => {
    expect(statusEintraege(grund).map((e) => e.text)).toContain('Noch 501 Blatt Papier');
  });

  it('warnt, wenn nur noch wenig auf der Rolle ist', () => {
    const papier = statusEintraege({ ...grund, materialRest: 10 }).find((e) => e.text.includes('Papier'));
    expect(papier).toEqual({ ampel: 'warnung', text: 'Nur noch 10 Blatt Papier' });
  });

  it('meldet der Drucker nichts, bleibt die Zeile - neutral, ohne Warnung', () => {
    const eintraege = statusEintraege({ ...grund, materialRest: null });
    const papier = eintraege.find((e) => e.text.startsWith('Papierstand'));
    expect(papier?.ampel).toBe('offen');
    // Ganz unten, damit "Alles in Ordnung" oben bleibt.
    expect(eintraege.at(-1)).toBe(papier);
  });
});
