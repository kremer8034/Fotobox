import { useCallback, useRef, useState } from 'react';
import { api } from '../api.js';

/*
 * Drucken aus dem Kiosk - an einer Stelle statt an zweien.
 *
 * Ergebnisseite und Galerie haben vorher jede fuer sich gedruckt, und die
 * Galerie hatte dabei weder Doppeltipp-Schutz noch Quittung: Zwei schnelle
 * Tipper auf "Noch einmal drucken" ergaben zwei berechnete Drucke, und die
 * Rueckmeldung schob als Textzeile das Layout zur Seite.
 */

export type Druckquelle = 'kiosk' | 'galerie' | 'servicemenue';

export interface Druckzustand {
  beschaeftigt: boolean;
  quittung: { text: string; fehlgeschlagen: boolean } | null;
  drucke: (kopien: number) => Promise<void>;
  schliesseQuittung: () => void;
}

export function useDrucken(
  ausgabeId: string,
  quelle: Druckquelle,
  beiErfolg: () => void,
): Druckzustand {
  const [beschaeftigt, setzeBeschaeftigt] = useState(false);
  const [quittung, setzeQuittung] = useState<Druckzustand['quittung']>(null);
  // Der eigentliche Schutz ist ein Ref, kein Zustand: Zwei Tipper, die im
  // selben Bildaufbau ankommen, saehen beide noch den alten Zustand "frei" und
  // loesten zwei berechnete Drucke aus. Ein Ref ist sofort gesetzt.
  const laeuft = useRef(false);

  const drucke = useCallback(
    async (kopien: number) => {
      if (laeuft.current) return;
      laeuft.current = true;
      setzeBeschaeftigt(true);
      try {
        const antwort = await api.sende<{ druckerSteht?: boolean; vorDir?: number }>('/api/kiosk/drucken', {
          ausgabeId,
          kopien,
          quelle,
        });
        const eins = kopien === 1;
        const vorDir = antwort?.vorDir ?? 0;
        setzeQuittung({
          // Steht der Drucker, stimmt "gleich abholen" nicht - dann die Ansage
          // aus dem Plan: gespeichert, wird nachgeholt, bitte Bescheid sagen.
          // Und bei langer Schlange (12,4 s je Blatt) soll niemand eine Minute
          // vor dem Drucker stehen und denken, es sei etwas kaputt.
          text: antwort?.druckerSteht
            ? `${eins ? 'Dein Bild ist' : `${kopien} Bilder sind`} gespeichert und ${eins ? 'wird' : 'werden'} gedruckt, sobald der Drucker wieder bereit ist. Sag bitte kurz jemandem Bescheid.`
            : vorDir >= 2
              ? `${eins ? 'Dein Bild wird' : `${kopien} Bilder werden`} gedruckt. Vorher ${vorDir === 1 ? 'kommt noch ein Bild' : `kommen noch ${vorDir} Bilder`} aus dem Drucker – etwa ${warteMinuten(vorDir)}.`
              : eins
                ? 'Dein Bild wird gedruckt. Du kannst es gleich am Drucker abholen.'
                : `${kopien} Bilder werden gedruckt. Du kannst sie gleich am Drucker abholen.`,
          fehlgeschlagen: false,
        });
        setTimeout(() => {
          setzeQuittung(null);
          setzeBeschaeftigt(false);
          laeuft.current = false;
          beiErfolg();
        }, 3500);
      } catch (fehler) {
        setzeQuittung({
          text: fehler instanceof Error ? fehler.message : 'Drucken hat nicht geklappt.',
          fehlgeschlagen: true,
        });
        setzeBeschaeftigt(false);
        laeuft.current = false;
      }
    },
    [ausgabeId, quelle, beiErfolg],
  );

  return { beschaeftigt, quittung, drucke, schliesseQuittung: () => setzeQuittung(null) };
}

/** Der RX1HS braucht 12,4 Sekunden je Blatt. */
function warteMinuten(blatt: number): string {
  const minuten = Math.max(1, Math.round((blatt * 12.4) / 60));
  return minuten === 1 ? 'eine Minute' : `${minuten} Minuten`;
}

export function Mengenwahl({
  kopien,
  max,
  beiAendern,
}: {
  kopien: number;
  max: number;
  beiAendern: (kopien: number) => void;
}) {
  // Bei einer Obergrenze von 1 gibt es nichts zu waehlen - dann steht auch
  // kein Zaehler mit zwei gesperrten Knoepfen da.
  if (max <= 1) return null;
  return (
    <div className="menge">
      <button
        className="knopf knopf--neben"
        onClick={() => beiAendern(Math.max(1, kopien - 1))}
        disabled={kopien <= 1}
        aria-label="Eine Kopie weniger"
      >
        −
      </button>
      <span className="menge__zahl">{kopien}</span>
      <button
        className="knopf knopf--neben"
        onClick={() => beiAendern(Math.min(max, kopien + 1))}
        disabled={kopien >= max}
        aria-label="Eine Kopie mehr"
      >
        +
      </button>
    </div>
  );
}

/**
 * Die Rueckmeldung legt sich ueber die Seite, statt als Zeile darunter zu
 * erscheinen: Sonst springt das Layout, genau in dem Moment, in dem der Gast
 * noch die Finger auf dem Schirm hat.
 */
export function Quittung({
  text,
  fehlgeschlagen,
  beiZurueck,
}: {
  text: string;
  fehlgeschlagen: boolean;
  beiZurueck: () => void;
}) {
  return (
    <div className="quittung">
      <div className="quittung__karte">
        <Zeichen art={fehlgeschlagen ? 'warnung' : 'drucker'} />
        <p className="quittung__text">{text}</p>
        {fehlgeschlagen && (
          <button className="knopf" onClick={beiZurueck}>
            Zurück
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Gezeichnet statt als Emoji: Ein Emoji haengt an der Schriftart des Systems
 * und kommt auf einem frisch aufgesetzten Windows als leeres Kaestchen heraus -
 * ausgerechnet in dem Moment, in dem der Gast wissen will, ob gedruckt wird.
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
