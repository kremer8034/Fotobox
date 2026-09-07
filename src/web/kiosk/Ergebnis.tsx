import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { toene } from './toene.js';

/**
 * Ergebnis und Ausgabe auf einer Seite: das fertige Layout gross oben, darunter
 * nur die tatsaechlich freigeschalteten Knoepfe. Kein Zeitlimit fuer die
 * Entscheidung - der Gast sieht sein Bild und entscheidet in Ruhe; erst wenn er
 * gar nichts tut, kehrt die Box nach der eingestellten Zeit zum Start zurueck.
 *
 * Es wird nie ungefragt gedruckt: Ohne bewusstes Antippen bleibt das Layout
 * digital.
 */
export function Ergebnis({
  ausgabeId,
  ausgabe,
  rueckkehrSekunden,
  tonAn,
  beiFertig,
}: {
  ausgabeId: string;
  ausgabe: {
    druckAktiv: boolean;
    emailAktiv: boolean;
    kopienVorgabe: number;
    kopienMax: number;
    druckLimitErreicht: boolean;
  };
  rueckkehrSekunden: number;
  tonAn: boolean;
  beiFertig: () => void;
}) {
  const [kopien, setzeKopien] = useState(ausgabe.kopienVorgabe);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [beschaeftigt, setzeBeschaeftigt] = useState(false);

  useEffect(() => {
    if (tonAn) toene.ergebnis();
  }, [tonAn]);

  // Rueckkehr zum Startbildschirm, wenn der Gast gar nichts tut.
  useEffect(() => {
    const uhr = setTimeout(beiFertig, rueckkehrSekunden * 1000);
    return () => clearTimeout(uhr);
  }, [rueckkehrSekunden, beiFertig, meldung]);

  const druckMoeglich = ausgabe.druckAktiv && !ausgabe.druckLimitErreicht;

  return (
    <div className="seite kiosk">
      <img className="ergebnis__bild" src={`/medien/ausgabe/${ausgabeId}.jpg`} alt="Dein Foto" />

      <div className="ergebnis__leiste">
        {druckMoeglich && (
          <>
            <div className="menge">
              <button
                className="knopf knopf--neben"
                onClick={() => setzeKopien((k) => Math.max(1, k - 1))}
                disabled={kopien <= 1}
              >
                −
              </button>
              <span className="menge__zahl">{kopien}</span>
              <button
                className="knopf knopf--neben"
                onClick={() => setzeKopien((k) => Math.min(ausgabe.kopienMax, k + 1))}
                disabled={kopien >= ausgabe.kopienMax}
              >
                +
              </button>
            </div>
            <button className="knopf knopf--haupt" onClick={() => void drucke()} disabled={beschaeftigt}>
              {kopien === 1 ? 'Drucken' : `${kopien}× drucken`}
            </button>
          </>
        )}

        {/* Ist der E-Mail-Versand aus, ist der Knopf nicht ausgegraut,
            sondern gar nicht da. */}
        {ausgabe.emailAktiv && (
          <button className="knopf" onClick={() => setzeMeldung('E-Mail-Versand folgt.')}>
            Per E-Mail schicken
          </button>
        )}

        <button className="knopf" onClick={beiFertig}>
          Fertig
        </button>
      </div>

      {meldung && <p className="untertitel" style={{ textAlign: 'center' }}>{meldung}</p>}
    </div>
  );

  async function drucke() {
    setzeBeschaeftigt(true);
    try {
      await api.sende('/api/kiosk/drucken', { ausgabeId, kopien, quelle: 'kiosk' });
      // Der Gast bekommt sofort Rueckmeldung und macht Platz - der Druck
      // laeuft im Hintergrund weiter.
      setzeMeldung('Dein Bild wird gedruckt. Du kannst es gleich am Drucker abholen.');
      setTimeout(beiFertig, 3500);
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Drucken hat nicht geklappt.');
      setzeBeschaeftigt(false);
    }
  }
}
