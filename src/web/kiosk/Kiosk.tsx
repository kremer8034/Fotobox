import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { api, type KioskStart, type SitzungStart, type Stoerungstext } from '../api.js';
import { Aufnahme } from './Aufnahme.js';
import { Ergebnis } from './Ergebnis.js';
import { Galerie } from './Galerie.js';
import { PinAbfrage, Schloss, Servicemenue } from './Sperre.js';
import { Stoerungshinweis } from './Stoerung.js';
import { schimmerAus, schriftAuf } from './farbe.js';

type Schirm =
  | { art: 'start' }
  | { art: 'vorlagen' }
  | { art: 'aufnahme'; sitzung: SitzungStart }
  | { art: 'filter'; sitzungId: string }
  | { art: 'ergebnis'; ausgabeId: string }
  | { art: 'galerie' }
  | { art: 'pin' }
  | { art: 'service'; ebene: 'betreuer' | 'besitzer' };

/**
 * Der Kiosk-Ablauf:
 *   Start -> Vorlage waehlen -> Aufnahmen -> Filter -> Ergebnis und Ausgabe
 *
 * Vorlagen- und Filterauswahl haben bewusst kein Zeitlimit: Dort muss der Gast
 * entscheiden, und eine weglaufende Uhr wuerde ihn nur hetzen. Die Rettungsleine
 * gegen haengengebliebene Sitzungen ist der serverseitige Abbruch nach der
 * eingestellten Zeit.
 */
export function Kiosk({ navigiere }: { navigiere: (ziel: string) => void }) {
  const [start, setzeStart] = useState<KioskStart | null>(null);
  const [schirm, setzeSchirm] = useState<Schirm>({ art: 'start' });
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [stoerungstext, setzeStoerungstext] = useState<Stoerungstext | null>(null);

  const ladeStart = useCallback(async () => {
    try {
      const daten = await api.hole<KioskStart>('/api/kiosk/start');
      setzeStart(daten);
      if (daten.status.stoerung) {
        const w = await api.hole<{ stoerungstext: Stoerungstext | null }>('/api/kiosk/wasistlos');
        setzeStoerungstext(w.stoerungstext);
      } else {
        setzeStoerungstext(null);
      }
    } catch (ursache) {
      setzeFehler(ursache instanceof Error ? ursache.message : 'Keine Verbindung.');
    }
  }, []);

  useEffect(() => {
    void ladeStart();
    const uhr = setInterval(() => void ladeStart(), 5000);
    return () => clearInterval(uhr);
  }, [ladeStart]);

  // Die Akzentfarbe der Veranstaltung stand bisher im Admin, ohne dass sie im
  // Kiosk je angekommen waere. Jetzt setzt sie die Variablen, aus denen sich
  // Hauptknopf, Kachelrand und Countdown-Punkt bedienen.
  useEffect(() => {
    const akzent = start?.darstellung?.akzent;
    if (!akzent) return;
    const wurzel = document.documentElement;
    wurzel.style.setProperty('--akzent', akzent);
    wurzel.style.setProperty('--akzent-schrift', schriftAuf(akzent));
    wurzel.style.setProperty('--akzent-schimmer', schimmerAus(akzent));
  }, [start?.darstellung?.akzent]);

  // Tastenkuerzel abfangen, damit Gaeste den Kiosk nicht verlassen.
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === 'F11' || (e.ctrlKey && ['w', 'W', 'n', 'N'].includes(e.key))) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', beiTaste);
    const beiMenue = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', beiMenue);
    return () => {
      window.removeEventListener('keydown', beiTaste);
      window.removeEventListener('contextmenu', beiMenue);
    };
  }, []);

  const schloss = <Schloss beiOeffnen={() => setzeSchirm({ art: 'pin' })} />;

  if (schirm.art === 'pin') {
    return (
      <PinAbfrage
        beiErfolg={(ebene) => setzeSchirm({ art: 'service', ebene })}
        beiAbbruch={() => setzeSchirm({ art: 'start' })}
      />
    );
  }

  if (schirm.art === 'service') {
    return (
      <Servicemenue
        ebene={schirm.ebene}
        beiSchliessen={() => setzeSchirm({ art: 'start' })}
        beiGalerie={() => setzeSchirm({ art: 'galerie' })}
        beiAdmin={() => navigiere('/admin')}
      />
    );
  }

  if (!start) {
    return (
      <div className="seite kiosk">
        {schloss}
        <div className="mitte">
          <p className="untertitel">{fehler ?? 'Einen Moment…'}</p>
        </div>
      </div>
    );
  }

  // Keine Veranstaltung aktiv oder pausiert: freundlicher Hinweis statt
  // Startseite, die Box bleibt betriebsbereit.
  if (!start.bereit) {
    return (
      <div className="seite kiosk">
        {schloss}
        <div className="mitte">
          <h1 className="titel">{start.pausiert ? 'Kleine Pause' : 'Die Fotobox ruht gerade'}</h1>
          <p className="untertitel">
            {start.pausiert ? 'Gleich geht es weiter.' : (start.grund ?? '')}
          </p>
        </div>
      </div>
    );
  }

  if (schirm.art === 'galerie') {
    return (
      <>
        {schloss}
        <Galerie beiZurueck={() => setzeSchirm({ art: 'start' })} />
      </>
    );
  }

  if (schirm.art === 'aufnahme') {
    return (
      <>
        {schloss}
        <Aufnahme
          sitzung={schirm.sitzung}
          zeiten={start.zeiten!}
          klaenge={start.toene!}
          beiFertig={() => setzeSchirm({ art: 'filter', sitzungId: schirm.sitzung.sitzungId })}
          beiAbbruch={(grund) => {
            setzeFehler(grund);
            setzeSchirm({ art: 'start' });
            void ladeStart();
          }}
        />
      </>
    );
  }

  if (schirm.art === 'filter') {
    return (
      <>
        {schloss}
        <div className="seite kiosk">
          <div className="kopf">
            <h1 className="titel">Wie soll es aussehen?</h1>
            <p className="untertitel">Nimm dir Zeit — hier läuft keine Uhr.</p>
          </div>
          <div className="raster" style={spalten(start.filter?.length ?? 1)}>
            {start.filter?.map((f) => (
              <button
                key={f.id}
                className="kachel"
                onClick={() => void waehleFilter(schirm.sitzungId, f.id)}
              >
                {/* Am Muster sieht der Gast, was der Filter tut - bei blossen
                    Namen sehen Sepia und Schwarzweiss gleich aus. */}
                <img
                  className="kachel__bild kachel__bild--fuellend"
                  src={`/api/kiosk/filter/${f.id}/vorschau.jpg?sitzung=${schirm.sitzungId}`}
                  alt=""
                />
                <span className="kachel__name">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  if (schirm.art === 'ergebnis') {
    return (
      <>
        {schloss}
        <Ergebnis
          ausgabeId={schirm.ausgabeId}
          ausgabe={start.ausgabe!}
          rueckkehrSekunden={start.zeiten!.rueckkehrStart}
          tonAn={start.toene!.ergebnis}
          beiFertig={() => {
            setzeSchirm({ art: 'start' });
            void ladeStart();
          }}
        />
      </>
    );
  }

  if (schirm.art === 'vorlagen') {
    return (
      <>
        {schloss}
        <div className="seite kiosk">
          <div className="kopf">
            <h1 className="titel">Welches Layout?</h1>
            <p className="untertitel">Die Auswahl bestimmt, wie viele Fotos gemacht werden.</p>
          </div>
          <div className="raster" style={spalten(start.vorlagen?.length ?? 1)}>
            {start.vorlagen?.map((v) => (
              <button key={v.id} className="kachel" onClick={() => void starteSitzung(v.id)}>
                {/* Die Vorlage mit nummerierten Platzhaltern: Der Gast sieht
                    vor der Wahl, wie viele Bilder wo sitzen. */}
                <img
                  className="kachel__bild"
                  src={`/api/kiosk/vorlage/${v.id}/vorschau.jpg`}
                  alt=""
                />
                <span className="kachel__name">{v.name}</span>
                <span className="kachel__info">
                  {v.fotos} {v.fotos === 1 ? 'Foto' : 'Fotos'}
                </span>
              </button>
            ))}
          </div>
          <div className="reihe reihe--ende">
            <button className="knopf knopf--neben" onClick={() => setzeSchirm({ art: 'start' })}>
              Zurück
            </button>
          </div>
        </div>
      </>
    );
  }

  // Startbildschirm - ruhig und immer gleich, kein Attract-Modus.
  return (
    <>
      {schloss}
      <div className="seite kiosk">
        <div className="mitte">
          <h1 className="titel" style={{ fontSize: '2.8rem' }}>
            {start.darstellung?.titel}
          </h1>
          <p className="untertitel">{start.darstellung?.untertitel}</p>

          {stoerungstext && <Stoerungshinweis text={stoerungstext} />}
          {fehler && <p className="untertitel">{fehler}</p>}

          <button
            className="knopf knopf--haupt knopf--riesig"
            style={{ minWidth: 'calc(90 * var(--mm))' }}
            onClick={() => {
              setzeFehler(null);
              setzeSchirm({ art: 'vorlagen' });
            }}
          >
            Foto starten
          </button>
          <button className="knopf" onClick={() => setzeSchirm({ art: 'galerie' })}>
            Bisherige Fotos ansehen
          </button>

          {start.veranstaltung?.probelauf && (
            <p className="untertitel">Probelauf — diese Bilder zählen nicht mit.</p>
          )}
        </div>

        {/* Klein in der Ecke, fuer alle, die den Aushang uebersehen. */}
        {start.darstellung?.qrAufStartseite && start.darstellung.galerieToken && (
          <div className="qr-ecke">
            <img
              src={`/api/qr?text=${encodeURIComponent(`http://${window.location.hostname}:8787/g/${start.darstellung.galerieToken}`)}`}
              alt=""
            />
            <div>Alle Fotos aufs Handy</div>
          </div>
        )}
      </div>
    </>
  );

  async function starteSitzung(vorlageId: string) {
    try {
      const sitzung = await api.sende<SitzungStart>('/api/kiosk/sitzung', { vorlageId });
      setzeSchirm({ art: 'aufnahme', sitzung });
    } catch (ursache) {
      setzeFehler(ursache instanceof Error ? ursache.message : 'Start hat nicht geklappt.');
      setzeSchirm({ art: 'start' });
    }
  }

  async function waehleFilter(sitzungId: string, filterId: string) {
    try {
      const antwort = await api.sende<{ ausgabeId: string }>(
        `/api/kiosk/sitzung/${sitzungId}/fertig`,
        { filterId: filterId === 'ohne' ? null : filterId },
      );
      setzeSchirm({ art: 'ergebnis', ausgabeId: antwort.ausgabeId });
      void ladeStart();
    } catch (ursache) {
      setzeFehler(ursache instanceof Error ? ursache.message : 'Hat nicht geklappt.');
      setzeSchirm({ art: 'start' });
    }
  }
}

/**
 * Spaltenaufteilung der Auswahlraster.
 *
 * Bis zu vier Kacheln stehen nebeneinander, danach wird umgebrochen. Die Zeilen
 * strecken sich auf die volle Hoehe, damit die Vorschaubilder gross werden -
 * vorher standen die Kacheln als schmaler Streifen in der Bildschirmmitte.
 */
function spalten(anzahl: number): React.CSSProperties {
  return {
    gridTemplateColumns: `repeat(${Math.min(Math.max(anzahl, 1), 4)}, 1fr)`,
    // Gleich hohe Zeilen: Sonst wird die letzte, halb gefuellte Zeile hoeher
    // als die darueber, weil sie sich den uebrigen Platz nimmt.
    gridAutoRows: '1fr',
    flex: 1,
    minHeight: 0,
    alignContent: 'stretch',
  };
}
