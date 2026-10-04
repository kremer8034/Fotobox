import { useEffect, useState } from 'react';
import { api, type KioskStart } from '../api.js';
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
  const [knopf, setzeKnopf] = useState(true);

  const bilder = useDiashowBilder(async (): Promise<DiashowBild[]> => {
    if (token) {
      try {
        const daten = await api.hole<{
          veranstaltung: string;
          diashowWechselSekunden?: number;
          bilder: { id: string; erstellt: string }[];
        }>(`/api/galerie/${encodeURIComponent(token)}`);
        setzeFehlt(false);
        setzeTitel(daten.veranstaltung);
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
    const [start, galerie] = await Promise.all([
      api.hole<KioskStart>('/api/kiosk/start'),
      api.hole<{ veranstaltung?: string; bilder: { id: string; erstellt: string }[] }>('/api/kiosk/galerie'),
    ]);
    setzeFehlt(!start.veranstaltung);
    setzeTitel(start.veranstaltung?.name ?? '');
    if (start.darstellung?.diashow?.wechselSekunden) setzeWechsel(start.darstellung.diashow.wechselSekunden);
    const name = start.darstellung?.portalWlan;
    setzeWlan(typeof name === 'string' ? name : null);
    return galerie.bilder.map((b) => ({ id: b.id, erstellt: b.erstellt, url: `/medien/ausgabe/${b.id}.jpg` }));
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
                : 'Gleich geht es los – die ersten Fotos erscheinen hier von selbst.'}
          </p>
        </div>
      )}
      {knopf && !document.fullscreenElement && (
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
