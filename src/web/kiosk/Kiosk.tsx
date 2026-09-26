import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { api, ApiFehler, KEINE_VERBINDUNG, type KioskStart, type SitzungStart, type Stoerungstext } from '../api.js';
import { Aufnahme } from './Aufnahme.js';
import { Ergebnis } from './Ergebnis.js';
import { Galerie } from './Galerie.js';
import { PinAbfrage, Schloss, Servicemenue } from './Sperre.js';
import { Stoerungshinweis } from './Stoerung.js';
import { schimmerAus, schriftAuf } from './farbe.js';
import { useZeitgeber } from './zeitgeber.js';
import { STOERUNGSTEXTE } from '../../shared/typen.js';

type Schirm =
  | { art: 'start' }
  | { art: 'vorlagen' }
  | { art: 'aufnahme'; sitzung: SitzungStart }
  | { art: 'filter'; sitzungId: string }
  | { art: 'ergebnis'; ausgabeId: string }
  | { art: 'galerie'; betreuung?: 'betreuer' | 'besitzer' }
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

  /*
   * Keine Verbindung zum Server - er startet nach einem Absturz neu, oder er
   * faehrt gerade hoch. Vorher stand dann "Failed to fetch" auf der Startseite,
   * und der Knopf "Foto starten" fuehrte ins Leere. Jetzt liegt ein ruhiger
   * Hinweis ueber allem, und sobald der Server wieder antwortet, geht es von
   * selbst am Startbildschirm weiter.
   */
  const [getrennt, setzeGetrennt] = useState(false);
  const warGetrennt = useRef(false);

  // Ein Hinweis auf der Startseite ("Die Kamera hat nicht mitgemacht") gilt der
  // Gruppe, die es gerade erlebt hat - nicht der naechsten eine halbe Stunde
  // spaeter.
  useZeitgeber(() => setzeFehler(null), fehler ? 30_000 : null, [fehler]);

  // Die Vorlagenwahl hat keine Uhr, die den Gast hetzt - aber wer "Foto
  // starten" tippt und geht, soll die Box nicht fuer den Rest des Abends auf
  // dieser Seite stehen lassen. Es greift dieselbe Rettungsleine wie in der
  // Sitzung (Vorgabe drei Minuten); jede Beruehrung dort verlaesst die Seite ohnehin.
  const abbruchMs = (start?.zeiten?.sitzungAbbruch ?? 180) * 1000;
  useZeitgeber(() => setzeSchirm({ art: 'start' }), schirm.art === 'vorlagen' ? abbruchMs : null, [schirm.art]);

  /*
   * Sperre gegen Doppeltipper. Ein Ref, kein Zustand: Zwei Tipper im selben
   * Bildaufbau saehen einen Zustand beide noch als "frei". Vorher gingen bei
   * einem Doppeltipp auf eine Vorlage zwei Anfragen hinaus; die zweite wurde
   * abgelehnt ("laeuft schon"), und diese Ablehnung warf den Kiosk auf den
   * Start zurueck - waehrend der Server die Aufnahme weiterfuehrte. Der
   * naechste Gast war dann bis zum Abbruch nach drei Minuten blockiert.
   */
  const beschaeftigt = useRef(false);
  // Was gerade angetippt wurde - fuer die sofortige Rueckmeldung am Bildschirm.
  const [wartetAuf, setzeWartetAuf] = useState<string | null>(null);
  // Der aktuelle Bildschirm fuer die Statusabfrage, die als stabile Funktion
  // sonst immer nur den Anfangswert saehe.
  const schirmJetzt = useRef(schirm);
  schirmJetzt.current = schirm;

  const ladeStart = useCallback(async () => {
    try {
      const daten = await api.hole<KioskStart>('/api/kiosk/start');
      // Verwaiste Sitzung: Der Server fuehrt eine Aufnahme, der Kiosk steht
      // aber nicht darin - nach einem Neuladen des Browsers, einem Absturz
      // oder einem Fehler im Ablauf. Sie wird verworfen, sonst blockiert sie
      // den naechsten Gast bis zum Abbruch nach drei Minuten.
      const art = schirmJetzt.current.art;
      if (
        daten.aktiveSitzungId &&
        !beschaeftigt.current &&
        art !== 'aufnahme' &&
        art !== 'filter' &&
        art !== 'ergebnis'
      ) {
        await api.sende(`/api/kiosk/sitzung/${daten.aktiveSitzungId}/abbrechen`, {}).catch(() => undefined);
        daten.aktiveSitzungId = null;
      }
      // Die Rettungsleine des Servers hat die Sitzung verworfen (drei Minuten
      // ohne Beruehrung) oder er wurde neu gestartet: Die Filterwahl gehoert
      // dann niemandem mehr. Vorher blieb sie stehen - mit den Fotos der
      // vorigen Gruppe in den Kacheln -, bis jemand tippte und "Sitzung ist
      // nicht mehr aktiv" las.
      const jetzt = schirmJetzt.current;
      if (jetzt.art === 'filter' && !beschaeftigt.current && daten.aktiveSitzungId !== jetzt.sitzungId) {
        setzeSchirm({ art: 'start' });
      }
      // Nur neu zeichnen, wenn sich etwas geaendert hat. Vorher zeichnete jede
      // Abfrage alle 5 s den ganzen Kiosk neu - auch mitten im Countdown.
      setzeStart((alt) => (alt && JSON.stringify(alt) === JSON.stringify(daten) ? alt : daten));
      if (warGetrennt.current) {
        warGetrennt.current = false;
        setzeGetrennt(false);
        // Was vor dem Ausfall offen war, gibt es auf dem Server womoeglich
        // nicht mehr. Also zurueck an den Anfang - ausser jemand steht gerade
        // im Servicemenue.
        const art = schirmJetzt.current.art;
        if (art !== 'pin' && art !== 'service') setzeSchirm({ art: 'start' });
      }
      if (daten.status.stoerung) {
        const w = await api.hole<{ stoerungstext: Stoerungstext | null }>('/api/kiosk/wasistlos');
        setzeStoerungstext(w.stoerungstext);
      } else {
        setzeStoerungstext(null);
      }
    } catch (ursache) {
      if (ursache instanceof ApiFehler && ursache.status === KEINE_VERBINDUNG) {
        warGetrennt.current = true;
        setzeGetrennt(true);
      }
      // Andere Fehler der Statusabfrage gehen den Gast nichts an; die naechste
      // Abfrage kommt in wenigen Sekunden.
    }
  }, []);

  // Waehrend der Aufnahme wird nicht abgefragt: Dort zaehlt jede Millisekunde
  // Rechenzeit fuer ein ruhiges Live-Bild und einen puenktlichen Countdown,
  // und nichts von dem, was die Abfrage liefert, wird dort angezeigt.
  const inAufnahme = schirm.art === 'aufnahme';
  useEffect(() => {
    if (inAufnahme) return;
    void ladeStart();
    // Ohne Verbindung oefter nachsehen, damit es nach dem Neustart zuegig weitergeht.
    const uhr = setInterval(() => void ladeStart(), getrennt ? 2000 : 5000);
    return () => clearInterval(uhr);
  }, [ladeStart, inAufnahme, getrennt]);

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

  // Alles, was der Bildschirm gerade zeigt - darueber liegt bei Bedarf der
  // Hinweis auf die verlorene Verbindung.
  const inhalt = ((): React.ReactElement => {


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
          beiGalerie={() => setzeSchirm({ art: 'galerie', betreuung: schirm.ebene })}
          beiAdmin={() => navigiere('/admin')}
        />
      );
    }

    // Der Betreuer kommt aus dem Servicemenue in die Galerie - auch in der
    // Pause, in der sonst "Kleine Pause" ueber allem steht. Gerade dann hat
    // er Zeit, nachzudrucken oder ein Foto herauszunehmen.
    if (schirm.art === 'galerie' && schirm.betreuung && start) {
      return (
        <>
          {schloss}
          <Galerie
            leerlaufSekunden={start.zeiten?.galerieLeerlauf ?? 60}
            betreuung={Boolean(schirm.betreuung)}
            // Aus dem Servicemenue gekommen: dorthin zurueck, ohne neue PIN.
            beiZurueck={() =>
              setzeSchirm(schirm.betreuung ? { art: 'service', ebene: schirm.betreuung } : { art: 'start' })
            }
          />
        </>
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
            {start.ersteinrichtung && (
              <>
                <p className="untertitel">
                  Die Fotobox ist frisch installiert. Lege in der Verwaltung zuerst unter „Gerät“ deine
                  Besitzer-PIN fest.
                </p>
                <button className="knopf knopf--haupt" onClick={() => navigiere('/admin/geraet')}>
                  Einrichtung fortsetzen
                </button>
              </>
            )}
          </div>
        </div>
      );
    }

    if (schirm.art === 'galerie') {
      return (
        <>
          {schloss}
          <Galerie
            leerlaufSekunden={start.zeiten?.galerieLeerlauf ?? 60}
            betreuung={Boolean(schirm.betreuung)}
            // Aus dem Servicemenue gekommen: dorthin zurueck, ohne neue PIN.
            beiZurueck={() =>
              setzeSchirm(schirm.betreuung ? { art: 'service', ebene: schirm.betreuung } : { art: 'start' })
            }
          />
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
            <div
              className={`raster${wartetAuf ? ' raster--wartet' : ''}`}
              style={spalten(start.filter?.length ?? 1)}
            >
              {start.filter?.map((f) => (
                <button
                  key={f.id}
                  className={`kachel${wartetAuf === f.id ? ' kachel--wartet' : ''}`}
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
            {/* Das Zusammensetzen dauert ein, zwei Sekunden. Vorher stand der
                Bildschirm in dieser Zeit still - wer dann noch einmal tippt, hat
                recht, denn es sah aus, als sei nichts passiert. */}
            {wartetAuf && (
              <div className="zusammensetzen" role="status">
                <div className="kreisel" aria-hidden="true" />
                <p className="zusammensetzen__text">Dein Bild wird zusammengesetzt …</p>
              </div>
            )}
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
            <div
              className={`raster${wartetAuf ? ' raster--wartet' : ''}`}
              style={spalten(start.vorlagen?.length ?? 1)}
            >
              {start.vorlagen?.map((v) => (
                <button
                  key={v.id}
                  className={`kachel${wartetAuf === v.id ? ' kachel--wartet' : ''}`}
                  onClick={() => void starteSitzung(v.id)}
                >
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
          {start.darstellung?.qrAufStartseite && start.darstellung.galerieUrl && (
            <div className="qr-ecke">
              <img
                src={`/api/qr?text=${encodeURIComponent(start.darstellung.galerieUrl)}`}
                alt=""
              />
              <div>Alle Fotos aufs Handy</div>
            </div>
          )}
        </div>
      </>
    );
  })();

  return (
    <>
      {inhalt}
      {getrennt && <Verbindungshinweis />}
    </>
  );

  async function starteSitzung(vorlageId: string) {
    if (beschaeftigt.current) return;
    beschaeftigt.current = true;
    setzeWartetAuf(vorlageId);
    try {
      const sitzung = await api.sende<SitzungStart>('/api/kiosk/sitzung', { vorlageId });
      setzeSchirm({ art: 'aufnahme', sitzung });
    } catch (ursache) {
      setzeFehler(gastText(ursache, 'Der Start hat nicht geklappt. Bitte noch einmal versuchen.'));
      setzeSchirm({ art: 'start' });
    } finally {
      beschaeftigt.current = false;
      setzeWartetAuf(null);
    }
  }

  async function waehleFilter(sitzungId: string, filterId: string) {
    if (beschaeftigt.current) return;
    beschaeftigt.current = true;
    setzeWartetAuf(filterId);
    try {
      const antwort = await api.sende<{ ausgabeId: string }>(
        `/api/kiosk/sitzung/${sitzungId}/fertig`,
        { filterId: filterId === 'ohne' ? null : filterId },
      );
      setzeSchirm({ art: 'ergebnis', ausgabeId: antwort.ausgabeId });
      void ladeStart();
    } catch (ursache) {
      setzeFehler(
        gastText(ursache, 'Das Zusammensetzen hat nicht geklappt. Bitte startet noch einmal.'),
      );
      setzeSchirm({ art: 'start' });
    } finally {
      beschaeftigt.current = false;
      setzeWartetAuf(null);
    }
  }
}

/**
 * Was ein Gast von einem Fehler zu lesen bekommt. Die Texte des Servers zu
 * Anfragen, die er ablehnt (4xx), sind schon fuer Gaeste geschrieben. Bei
 * allem anderen - Serverfehler, keine Verbindung - steht dort sonst "HTTP 500"
 * oder "Failed to fetch".
 */
function gastText(ursache: unknown, ersatz: string): string {
  if (ursache instanceof ApiFehler && ursache.status >= 400 && ursache.status < 500) {
    return ursache.message;
  }
  return ersatz;
}

/** Liegt ueber allem, solange der Server nicht antwortet. */
function Verbindungshinweis() {
  const text = STOERUNGSTEXTE.aussetzer;
  return (
    <div className="verbindung" role="status">
      <div className="kreisel" aria-hidden="true" />
      <p className="verbindung__titel">{text.titel}</p>
      <p className="verbindung__text">{text.folge}</p>
    </div>
  );
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
