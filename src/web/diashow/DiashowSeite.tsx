import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Diashow, useDiashowBilder, type DiashowBild } from './Diashow.js';

/** So lange bleibt der Vollbild-Knopf nach der letzten Mausbewegung sichtbar. */
const KNOPF_MS = 4000;

/**
 * Die Diashow fuer Beamer und Fernseher.
 *
 *  - /diashow an der Box selbst: fuer den zweiten Bildschirm am HDMI-Anschluss.
 *    Die Verwaltung oeffnet sie dort per Knopfdruck im Vollbild.
 *  - /g/<token>/diashow im WLAN: fuer einen Fernseher oder Beamer mit eigenem
 *    Browser. Dieselbe Freigabe wie die Handy-Galerie - nur, solange die
 *    Galerie der laufenden Feier an ist. Mit Captive Portal genuegt
 *    "192.168.254.1/diashow".
 *
 * Gezeigt wird nur, was auch in der Galerie steht: kein Probelauf, nichts,
 * was der Betreuer herausgenommen hat - und nie das Gaestebuch.
 */
export function DiashowSeite({ token }: { token?: string }) {
  const [titel, setzeTitel] = useState('');
  const [wechsel, setzeWechsel] = useState(7);
  const [wlan, setzeWlan] = useState<string | null>(null);
  const [fehlt, setzeFehlt] = useState(false);
  // Fuer diese Feier nicht eingeschaltet: Dann bleibt die Leinwand leer.
  const [aus, setzeAus] = useState(false);
  const [knopf, setzeKnopf] = useState(true);

  const bilder = useDiashowBilder(async (): Promise<DiashowBild[]> => {
    if (token) {
      try {
        const daten = await api.hole<{
          veranstaltung: string;
          diashowExtern?: boolean;
          diashowWechselSekunden?: number;
          bilder: { id: string; erstellt: string }[];
        }>(`/api/galerie/${encodeURIComponent(token)}`);
        setzeFehlt(false);
        setzeTitel(daten.veranstaltung);
        setzeAus(!daten.diashowExtern);
        if (!daten.diashowExtern) return [];
        if (daten.diashowWechselSekunden) setzeWechsel(daten.diashowWechselSekunden);
        return daten.bilder.map((b) => ({
          id: b.id,
          erstellt: b.erstellt,
          url: `/medien/galerie/${encodeURIComponent(token)}/${b.id}.jpg?gross=1`,
        }));
      } catch {
        setzeFehlt(true);
        return [];
      }
    }
    const daten = await api.hole<{
      veranstaltung: string | null;
      extern: boolean;
      wechselSekunden?: number;
      portalWlan?: string | null;
      bilder: { id: string; erstellt: string }[];
    }>('/api/kiosk/diashow');
    setzeFehlt(!daten.veranstaltung);
    setzeTitel(daten.veranstaltung ?? '');
    setzeAus(Boolean(daten.veranstaltung) && !daten.extern);
    if (!daten.extern) return [];
    if (daten.wechselSekunden) setzeWechsel(daten.wechselSekunden);
    setzeWlan(typeof daten.portalWlan === 'string' ? daten.portalWlan : null);
    return daten.bilder.map((b) => ({ id: b.id, erstellt: b.erstellt, url: `/medien/ausgabe/${b.id}.jpg` }));
  });

  // Der Mauszeiger und der Vollbild-Knopf stoeren auf der Leinwand - beides
  // verschwindet, solange niemand die Maus bewegt.
  useEffect(() => {
    let uhr = setTimeout(() => setzeKnopf(false), KNOPF_MS);
    const bewegt = () => {
      setzeKnopf(true);
      clearTimeout(uhr);
      uhr = setTimeout(() => setzeKnopf(false), KNOPF_MS);
    };
    window.addEventListener('pointermove', bewegt);
    return () => {
      clearTimeout(uhr);
      window.removeEventListener('pointermove', bewegt);
    };
  }, []);

  /*
   * Als Fenster auf dem zweiten Bildschirm geoeffnet (?fenster=1): Wird der
   * Beamer abgezogen, schiebt Windows das Fenster auf den Touchscreen - ueber
   * den Kiosk. Dann bittet es die Box, es zu schliessen.
   */
  const alsFenster = !token && new URLSearchParams(window.location.search).has('fenster');
  useEffect(() => {
    if (!alsFenster) return;
    const bildschirm = window.screen as Screen & { isExtended?: boolean };
    if (bildschirm.isExtended === undefined) return;
    const pruefe = () => {
      if (bildschirm.isExtended === false) void api.sende('/api/kiosk/diashow/fenster-zu', {}).catch(() => undefined);
    };
    const uhr = setInterval(pruefe, 3000);
    return () => clearInterval(uhr);
  }, [alsFenster]);

  // Der Vollbild-Knopf verschwindet, sobald das Vollbild steht.
  const [vollbild, setzeVollbild] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const wechsel = () => setzeVollbild(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', wechsel);
    return () => document.removeEventListener('fullscreenchange', wechsel);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('diashow-seite');
    return () => document.documentElement.classList.remove('diashow-seite');
  }, []);

  const leer = bilder !== null && bilder.length === 0;
  return (
    <div className={`diashow-rahmen${knopf ? '' : ' diashow-rahmen--ruhig'}`}>
      {bilder && bilder.length > 0 && (
        <Diashow
          bilder={bilder}
          wechselSekunden={wechsel}
          kinder={
            <>
              {titel && <div className="diashow__titel">{titel}</div>}
              {wlan !== null && (
                <div className="diashow__hinweis">
                  Eure Fotos aufs Handy: WLAN {wlan ? <strong>„{wlan}“</strong> : 'der Fotobox'} antippen
                </div>
              )}
            </>
          }
        />
      )}
      {(leer || bilder === null) && (
        <div className="diashow__leer">
          {titel && <div className="diashow__leer-titel">{titel}</div>}
          <p>
            {bilder === null
              ? 'Einen Moment …'
              : fehlt
                ? 'Die Diashow startet, sobald die Feier läuft.'
                : aus
                  ? 'Die Diashow ist bei dieser Feier nicht eingeschaltet.'
                : 'Gleich geht es los – die ersten Fotos erscheinen hier von selbst.'}
          </p>
        </div>
      )}
      {knopf && !vollbild && !alsFenster && (
        <button
          className="knopf knopf--neben diashow__vollbild"
          onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
        >
          Vollbild
        </button>
      )}
    </div>
  );
}
