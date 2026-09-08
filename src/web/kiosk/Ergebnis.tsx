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
  const [fehlgeschlagen, setzeFehlgeschlagen] = useState(false);
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
    <div className="seite kiosk" style={{ position: 'relative' }}>
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

      {/*
        Die Rueckmeldung legt sich ueber die Seite, statt als Zeile darunter zu
        erscheinen: Vorher ist beim Drucken das ganze Layout gesprungen, genau
        in dem Moment, in dem der Gast noch die Finger auf dem Schirm hatte.
      */}
      {meldung && (
        <div className="quittung">
          <div className="quittung__karte">
            <Zeichen art={fehlgeschlagen ? 'warnung' : 'drucker'} />
            <p className="quittung__text">{meldung}</p>
            {fehlgeschlagen && (
              <button className="knopf" onClick={() => setzeMeldung(null)}>
                Zurück
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  async function drucke() {
    setzeBeschaeftigt(true);
    try {
      await api.sende('/api/kiosk/drucken', { ausgabeId, kopien, quelle: 'kiosk' });
      // Der Gast bekommt sofort Rueckmeldung und macht Platz - der Druck
      // laeuft im Hintergrund weiter.
      setzeFehlgeschlagen(false);
      setzeMeldung('Dein Bild wird gedruckt. Du kannst es gleich am Drucker abholen.');
      setTimeout(beiFertig, 3500);
    } catch (fehler) {
      setzeFehlgeschlagen(true);
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Drucken hat nicht geklappt.');
      setzeBeschaeftigt(false);
    }
  }
}

/**
 * Die beiden Zeichen der Quittung, gezeichnet statt als Emoji: Ein Emoji haengt
 * an der Schriftart des Systems und kommt auf einem frisch aufgesetzten Windows
 * als leeres Kaestchen heraus - ausgerechnet in dem Moment, in dem der Gast
 * wissen will, ob sein Bild jetzt gedruckt wird.
 */
function Zeichen({ art }: { art: 'drucker' | 'warnung' }) {
  return (
    <svg
      className="quittung__zeichen"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {art === 'drucker' ? (
        <>
          <path d="M7 9V3h10v6" />
          <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
          <rect x="7" y="15" width="10" height="6" rx="1" />
        </>
      ) : (
        <>
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 9v5" />
          <path d="M12 17.5v.5" />
        </>
      )}
    </svg>
  );
}
