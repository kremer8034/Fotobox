import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { api, type SitzungStart, type Toene, type Zeiten } from '../api.js';
import { toene } from './toene.js';

type Phase = 'bereitmachen' | 'countdown' | 'ausloesen' | 'bestaetigung' | 'stoerung';

/**
 * Der Aufnahmebildschirm.
 *
 * Der Countdown liegt direkt ueber dem Live-Bild - die Gaeste sollen sich
 * selbst sehen und wissen, wann es ausloest, ohne den Blick zu wechseln. Das
 * Live-Bild ist im Seitenverhaeltnis der aktuellen Foto-Ebene maskiert, damit
 * sichtbar ist, was tatsaechlich auf dem Ausdruck landet.
 */
export function Aufnahme({
  sitzung,
  zeiten,
  klaenge,
  beiFertig,
  beiAbbruch,
}: {
  sitzung: SitzungStart;
  zeiten: Zeiten;
  klaenge: Toene;
  beiFertig: () => void;
  beiAbbruch: (grund: string) => void;
}) {
  const [index, setzeIndex] = useState(1);
  const [phase, setzePhase] = useState<Phase>('bereitmachen');
  const [restSekunden, setzeRest] = useState(zeiten.bereitmachenErstes);
  const [letztesFoto, setzeLetztesFoto] = useState<string | null>(null);
  const abgebrochen = useRef(false);

  useEffect(() => () => { abgebrochen.current = true; }, []);

  useEffect(() => {
    let gestoppt = false;

    async function durchlauf() {
      for (let i = 1; i <= sitzung.benoetigteFotos; i += 1) {
        if (gestoppt || abgebrochen.current) return;
        setzeIndex(i);

        // Bereitmachen: Live-Bild laeuft, die Gruppe sortiert sich.
        setzePhase('bereitmachen');
        const bereit = i === 1 ? zeiten.bereitmachenErstes : zeiten.bereitmachenZwischen;
        if (!(await zaehleHerunter(bereit, false))) return;

        // Countdown mit Ton je Sekunde.
        setzePhase('countdown');
        if (!(await zaehleHerunter(zeiten.countdown, klaenge.countdownPiep))) return;

        setzePhase('ausloesen');
        if (klaenge.ausloeser) toene.ausloeser();

        try {
          await api.sende(`/api/kiosk/sitzung/${sitzung.sitzungId}/foto`, { index: i });
        } catch (fehler) {
          setzePhase('stoerung');
          beiAbbruch(fehler instanceof Error ? fehler.message : 'Aufnahme fehlgeschlagen');
          return;
        }
        if (gestoppt || abgebrochen.current) return;

        // Kurze Bestaetigung, bewusst ohne Rueckfrage und ohne "Nochmal" -
        // reine Anzeige, der Ablauf laeuft durch.
        if (zeiten.bestaetigung > 0) {
          setzeLetztesFoto(`/stream/standbild.jpg?t=${Date.now()}`);
          setzePhase('bestaetigung');
          await pause(zeiten.bestaetigung * 1000);
          setzeLetztesFoto(null);
        }
      }
      if (!gestoppt && !abgebrochen.current) beiFertig();
    }

    async function zaehleHerunter(sekunden: number, mitTon: boolean): Promise<boolean> {
      for (let s = sekunden; s > 0; s -= 1) {
        if (gestoppt || abgebrochen.current) return false;
        setzeRest(s);
        if (mitTon) toene.countdown();
        await pause(1000);
      }
      setzeRest(0);
      return !gestoppt && !abgebrochen.current;
    }

    void durchlauf();
    return () => {
      gestoppt = true;
    };
    // Absichtlich nur einmal: Der Ablauf steuert sich selbst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verhaeltnis = sitzung.seitenverhaeltnisse[String(index)] ?? 1.5;

  return (
    <div className="seite kiosk">
      <div className="aufnahme">
        {/*
          Das Bild fuellt genau den Rahmen und wird dabei beschnitten wie
          spaeter im Layout. Was hier zu sehen ist, landet also tatsaechlich auf
          dem Ausdruck - genau dafuer ist die Maske da.
        */}
        <Ausschnitt verhaeltnis={verhaeltnis}>
          <img
            className="aufnahme__bild"
            src={letztesFoto ?? '/stream/liveview'}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Ausschnitt>

        <div className="hinweis-oben">
          Foto {index} von {sitzung.benoetigteFotos}
        </div>

        {phase === 'countdown' && restSekunden > 0 && (
          <div className="countdown">{restSekunden}</div>
        )}
        {phase === 'bereitmachen' && (
          <div className="bereitmachen">
            {index === 1 ? 'Gleich geht es los — stellt euch auf!' : 'Neue Pose!'}
          </div>
        )}
        {phase === 'ausloesen' && <div className="bereitmachen">Bitte lächeln!</div>}
        {phase === 'bestaetigung' && <div className="bereitmachen">So sieht es aus!</div>}
      </div>
    </div>
  );
}

/**
 * Der sichtbare Ausschnitt im Seitenverhaeltnis der aktuellen Foto-Ebene.
 *
 * Die Fotos sind 3:2, der Bildschirm ist 16:9. Auf volle Hoehe skaliert bleibt
 * links und rechts Platz - genau dort steht die Zeile "Foto 2 von 3", ohne das
 * Bild zu ueberdecken.
 */
function Ausschnitt({
  verhaeltnis,
  children,
}: {
  verhaeltnis: number;
  children: React.ReactNode;
}) {
  const [masse, setzeMasse] = useState({ breite: 0, hoehe: 0 });

  useEffect(() => {
    const berechne = () => {
      const verfuegbarBreite = window.innerWidth * 0.92;
      const verfuegbarHoehe = window.innerHeight * 0.84;
      let breite = verfuegbarHoehe * verhaeltnis;
      let hoehe = verfuegbarHoehe;
      if (breite > verfuegbarBreite) {
        breite = verfuegbarBreite;
        hoehe = verfuegbarBreite / verhaeltnis;
      }
      setzeMasse({ breite, hoehe });
    };
    berechne();
    window.addEventListener('resize', berechne);
    return () => window.removeEventListener('resize', berechne);
  }, [verhaeltnis]);

  return (
    <div
      className="aufnahme__rahmen"
      style={{ width: `${masse.breite}px`, height: `${masse.hoehe}px` }}
    >
      {children}
    </div>
  );
}

function pause(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
