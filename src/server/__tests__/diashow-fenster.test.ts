import { describe, expect, it } from 'vitest';
import { oeffneDiashowFenster, schliesseDiashowFenster } from '../fach/kiosk-browser.js';

/*
 * Das Diashow-Fenster fuer den zweiten Bildschirm entsteht ueber PowerShell.
 * Der Windows-Lauf der CI hat keinen zweiten Bildschirm - die Antwort muss
 * dann "kein zweiter Bildschirm" sein, kein Fehler im Skript.
 */
describe.runIf(process.platform === 'win32')('Diashow-Fenster unter Windows', () => {
  it('meldet ohne zweiten Bildschirm sauber zurueck', async () => {
    const ergebnis = await oeffneDiashowFenster('http://127.0.0.1:9/diashow');
    expect(['kein-zweiter-bildschirm', 'kein-browser', 'geoeffnet']).toContain(ergebnis);
    expect(await schliesseDiashowFenster()).toBeGreaterThanOrEqual(0);
  }, 60_000);
});
