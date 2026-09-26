import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { api, ApiFehler, KEINE_VERBINDUNG, type SitzungStart, type Toene, type Zeiten } from '../api.js';
import { toene } from './toene.js';

type Phase =
  | 'bereitmachen'
  | 'kamerasuche'
  | 'countdown'
  | 'ausloesen'
  | 'verarbeiten'
  | 'nochmal'
  | 'bestaetigung'
  | 'stoerung';

/*
 * Wenn die Kamera nicht mitspielt.
 *
 * Vorher warf ein einziger Ausloeser, der nicht klappte - bei der 600D reicht
 * ein Autofokus, der nicht greift -, die ganze Gruppe auf den Startbildschirm
 * zurueck, mit dem Wort "aufnahme-fehlgeschlagen" als einziger Erklaerung. Und
 * der Countdown lief auch dann, wenn die Kamera gar kein Bild lieferte: Die
 * Gaeste zaehlten vor einer schwarzen Flaeche herunter.
 *
 * Jetzt wird vor jedem Countdown geprueft, ob ein frisches Live-Bild da ist,
 * und notfalls gewartet. Ein Foto, das nicht klappt, wird wiederholt. Erst wenn
 * die Kamera gar nicht zurueckkommt, endet die Sitzung - mit einem Satz, den
 * ein Gast versteht.
 */
const VERSUCHE_JE_FOTO = 3;
const KAMERA_GEDULD_MS = 90_000;
const TEXT_KAMERA =
  'Die Kamera hat gerade nicht mitgemacht. Bitte startet gleich noch einmal.';
const TEXT_UNTERBROCHEN = 'Die Fotobox musste sich kurz sortieren. Bitte startet noch einmal.';

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
  // Der Auslöseblitz ist das Signal, das jeder aus jeder Fotobox kennt. Ohne
  // ihn ist auf dem Bildschirm gar nicht zu sehen, wann es soweit war.
  const [blitzt, setzeBlitzt] = useState(false);
  const abgebrochen = useRef(false);
  // Seit wann auf die Kamera gewartet wird - nach einer Weile soll jemand Bescheid bekommen.
  const [kameraWartetSeit, setzeKameraWartetSeit] = useState<number | null>(null);
  const [jetzt, setzeJetzt] = useState(Date.now());
  useEffect(() => {
    if (kameraWartetSeit === null) return;
    const uhr = setInterval(() => setzeJetzt(Date.now()), 1000);
    return () => clearInterval(uhr);
  }, [kameraWartetSeit]);

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

        let versuch = 1;
        for (;;) {
          // Nie vor einem schwarzen oder eingefrorenen Bild herunterzaehlen.
          const kamera = await warteAufKamera();
          if (gestoppt || abgebrochen.current) return;
          if (kamera !== 'da') {
            setzePhase('stoerung');
            beiAbbruch(kamera === 'weg' ? TEXT_KAMERA : TEXT_UNTERBROCHEN);
            return;
          }

          // Countdown mit Ton je Sekunde.
          setzePhase('countdown');
          if (!(await zaehleHerunter(zeiten.countdown, klaenge.countdownPiep))) return;

          setzePhase('ausloesen');
          if (klaenge.ausloeser) toene.ausloeser();
          setzeBlitzt(true);
          setTimeout(() => setzeBlitzt(false), 420);
          // Braucht die Kamera laenger, soll niemand minutenlang weiterlaecheln.
          const langsam = setTimeout(() => setzePhase('verarbeiten'), 4000);

          try {
            await api.sende(`/api/kiosk/sitzung/${sitzung.sitzungId}/foto`, { index: i });
            clearTimeout(langsam);
            break;
          } catch (fehler) {
            clearTimeout(langsam);
            if (gestoppt || abgebrochen.current) return;
            const status = fehler instanceof ApiFehler ? fehler.status : KEINE_VERBINDUNG;
            // 409: Die Sitzung gibt es nicht mehr - etwa nach einem Neustart
            // des Servers. Wiederholen hat dann keinen Sinn.
            if (status === 409) {
              setzePhase('stoerung');
              beiAbbruch(TEXT_UNTERBROCHEN);
              return;
            }
            if (versuch >= VERSUCHE_JE_FOTO) {
              setzePhase('stoerung');
              beiAbbruch(TEXT_KAMERA);
              return;
            }
            versuch += 1;
            setzePhase('nochmal');
            await pause(2500);
          }
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

    /**
     * Wartet auf ein frisches Live-Bild. "weg": Die Kamera kam in der ganzen
     * Wartezeit nicht zurueck. "sitzung-weg": Der Server kennt die Sitzung
     * nicht mehr.
     */
    async function warteAufKamera(): Promise<'da' | 'weg' | 'sitzung-weg'> {
      const bis = Date.now() + KAMERA_GEDULD_MS;
      let seit: number | null = null;
      while (Date.now() < bis) {
        if (gestoppt || abgebrochen.current) return 'sitzung-weg';
        try {
          const { bereit } = await api.hole<{ bereit: boolean }>(
            `/api/kiosk/sitzung/${sitzung.sitzungId}/kamera`,
          );
          if (bereit) {
            setzeKameraWartetSeit(null);
            return 'da';
          }
        } catch (fehler) {
          if (fehler instanceof ApiFehler && fehler.status === 409) return 'sitzung-weg';
          // Keine Antwort: Der Server startet womoeglich gerade neu - weiter warten.
        }
        setzePhase('kamerasuche');
        if (seit === null) {
          seit = Date.now();
          setzeKameraWartetSeit(seit);
        }
        await pause(700);
      }
      setzeKameraWartetSeit(null);
      return 'weg';
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
            // Liefert die Kamera gerade kein Standbild, lieber weiter das
            // Live-Bild als ein zerbrochenes Bildsymbol.
            onError={() => setzeLetztesFoto(null)}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Ausschnitt>

        <div className="hinweis-oben">
          <span>
            Foto {index} von {sitzung.benoetigteFotos}
          </span>
          {/* Dieselbe Aussage als Punkte: auf einen Blick erfassbar, ohne
              zwei Zahlen miteinander zu vergleichen. */}
          <span className="fortschritt">
            {Array.from({ length: sitzung.benoetigteFotos }, (_, i) => (
              <span
                key={i}
                className={
                  'fortschritt__punkt' +
                  (i + 1 < index ? ' fortschritt__punkt--fertig' : '') +
                  (i + 1 === index ? ' fortschritt__punkt--jetzt' : '')
                }
              />
            ))}
          </span>
        </div>

        {phase === 'countdown' && restSekunden > 0 && (
          // Der Schluessel wechselt mit der Sekunde: Damit startet die
          // Puls-Animation bei jeder Zahl neu statt nur einmal am Anfang.
          <div className="countdown" key={restSekunden}>
            {restSekunden}
          </div>
        )}
        {phase === 'bereitmachen' && (
          <div className="bereitmachen">
            {index === 1 ? 'Gleich geht es los — stellt euch auf!' : 'Neue Pose!'}
          </div>
        )}
        {phase === 'ausloesen' && <div className="bereitmachen">Bitte lächeln!</div>}
        {phase === 'verarbeiten' && (
          <div className="bereitmachen bereitmachen--ruhig">Einen Moment …</div>
        )}
        {phase === 'kamerasuche' && (
          <div className="bereitmachen bereitmachen--ruhig">
            Einen Moment — die Kamera macht sich bereit.
            {kameraWartetSeit !== null && jetzt - kameraWartetSeit > 15_000 && (
              <>
                <br />
                <small>Dauert es länger, sagt bitte jemandem Bescheid, dass die Kamera hakt.</small>
              </>
            )}
          </div>
        )}
        {phase === 'nochmal' && (
          <div className="bereitmachen">Hoppla — das hat nicht geklappt. Gleich noch einmal!</div>
        )}
        {phase === 'bestaetigung' && (
          <div className="bereitmachen bereitmachen--ruhig">So sieht es aus!</div>
        )}
        {blitzt && <div className="blitz" />}
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
