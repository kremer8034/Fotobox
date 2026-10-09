import { useState } from 'react';
import { createPortal } from 'react-dom';
import { DiashowSeite } from '../diashow/DiashowSeite.js';

/**
 * Ein PDF (Kurzanleitung, Aushang, Gaestebuch) innerhalb der Verwaltung
 * ansehen - mit "Schliessen".
 *
 * Vorher oeffneten diese Links ein neues Fenster. Kommt man ueber das
 * Servicemenue in die Verwaltung, laeuft sie im Kiosk-Vollbild: Ein neues
 * Fenster hat dort keinen Schliessen-Knopf, und am Touchscreen ohne Tastatur
 * kam man nicht mehr zurueck.
 */
export function PdfKnopf({ href, beschriftung }: { href: string; beschriftung: string }) {
  const [offen, setzeOffen] = useState(false);
  return (
    <>
      <button className="knopf knopf--neben" onClick={() => setzeOffen(true)}>
        {beschriftung}
      </button>
      {offen &&
        createPortal(
          <div className="pdf-fenster" role="dialog" aria-modal="true">
            <div className="pdf-fenster__leiste">
              <span>Drucken: im PDF oben rechts auf das Drucker-Symbol.</span>
              <button className="knopf knopf--haupt" onClick={() => setzeOffen(false)}>
                Schließen
              </button>
            </div>
            <iframe className="pdf-fenster__inhalt" src={href} title={beschriftung} />
          </div>,
          document.body,
        )}
    </>
  );
}

/** Die Diashow zur Probe - ebenfalls innerhalb der Verwaltung, mit "Schliessen". */
export function DiashowVorschau() {
  const [offen, setzeOffen] = useState(false);
  return (
    <>
      <button className="knopf knopf--neben" onClick={() => setzeOffen(true)}>
        Vorschau
      </button>
      {offen &&
        createPortal(
          <div className="diashow-vorschau" role="dialog" aria-modal="true">
            <DiashowSeite />
            <button className="knopf knopf--haupt diashow-vorschau__zu" onClick={() => setzeOffen(false)}>
              Vorschau schließen
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
