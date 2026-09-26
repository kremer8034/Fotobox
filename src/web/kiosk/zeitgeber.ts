import { useEffect, useRef } from 'react';

/**
 * Ein Zeitgeber, der abläuft - auch wenn der Aufrufer bei jedem Neuzeichnen
 * eine neue Funktion übergibt.
 *
 * Der Kiosk fragt alle 5 Sekunden den Status ab und zeichnet dabei neu. Hing
 * ein setTimeout an einer übergebenen Funktion, bekam er bei jedem
 * Neuzeichnen eine neue und startete von vorn - er lief nie ab. So blieben
 * nachweislich die Ergebnisseite (eingestellt 20 s), das PIN-Feld (10 s) und
 * die E-Mail-Maske (60 s) für immer stehen, und das Schloss brauchte manchmal
 * länger als die 2 Sekunden Gedrückthalten.
 *
 * Hier steckt die Aktion in einem Ref: Sie ist immer die aktuelle, aber ihr
 * Wechsel startet die Uhr nicht neu. Neu gestartet wird nur, wenn sich einer
 * der `ausloeser` ändert - also bei echter Aktivität.
 *
 * @param ms Laufzeit; null oder <= 0 schaltet den Zeitgeber ab.
 */
export function useZeitgeber(aktion: () => void, ms: number | null, ausloeser: unknown[] = []): void {
  const aktuell = useRef(aktion);
  aktuell.current = aktion;

  useEffect(() => {
    if (ms === null || ms <= 0) return;
    const uhr = setTimeout(() => aktuell.current(), ms);
    return () => clearTimeout(uhr);
    // Die Aktion gehört absichtlich nicht hierher - siehe oben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...ausloeser]);
}
