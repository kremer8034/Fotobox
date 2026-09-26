import { useEffect, useRef, useState } from 'react';
import { useZeitgeber } from './zeitgeber.js';
import { Statusliste, type Boxzustand } from '../Statusliste.js';
import { api } from '../api.js';

type Ebene = 'betreuer' | 'besitzer';

/** sessionStorage-Schluessel: Die Verwaltung wurde aus dem Servicemenue geoeffnet. */
export const VOM_KIOSK = 'fotobox-verwaltung-vom-kiosk';

interface WasIstLos {
  stand: string;
  veranstaltung: { id: string; name: string; status: string } | null;
  kamera: string;
  drucker: string;
  stoerung: string | null;
  stoerungstext: { titel: string; folge: string; tun: string } | null;
  betreuerHinweis: string | null;
  warteschlangeOffen: number;
  materialRest: number;
  speicherFreiGb: number;
  drucke: number;
  sitzungen: number;
}

function alsZustand(w: WasIstLos): Boxzustand {
  return {
    kamera: w.kamera,
    drucker: w.drucker,
    druckerStoerung: w.drucker === 'bereit' ? null : (w.stoerungstext?.titel ?? null),
    stoerungArt: w.stoerung,
    warteschlangeOffen: w.warteschlangeOffen,
    materialRest: w.materialRest,
    speicherFreiGb: w.speicherFreiGb,
    sitzungen: w.sitzungen,
    drucke: w.drucke,
  };
}

/**
 * Kiosk-Sperre mit zwei PIN-Ebenen.
 *
 * Das Schloss oben rechts ist kaum sichtbar und reagiert erst auf langes
 * Druecken (2 Sekunden) - ein neugieriger Gast tippt einmal drauf und es
 * passiert nichts.
 *
 * Nach der PIN kommt nicht der Windows-Desktop, sondern ein Servicemenue. Und
 * welches, haengt von der eingegebenen PIN ab: Der Kunde bekommt die
 * Betreuer-PIN und damit nur die Handgriffe des Alltags.
 */
export function Schloss({ beiOeffnen }: { beiOeffnen: () => void }) {
  const [gedruecktSeit, setzeGedruecktSeit] = useState<number | null>(null);

  // Fiel die Statusabfrage des Kiosks in die zwei Sekunden, begann die
  // Zaehlung vorher von vorn - das Schloss ging "manchmal nicht auf".
  useZeitgeber(beiOeffnen, gedruecktSeit === null ? null : 2000, [gedruecktSeit]);

  return (
    <div
      className="schloss"
      onPointerDown={() => setzeGedruecktSeit(Date.now())}
      onPointerUp={() => setzeGedruecktSeit(null)}
      onPointerLeave={() => setzeGedruecktSeit(null)}
      aria-hidden
    >
      🔒
    </div>
  );
}

export function PinAbfrage({
  beiErfolg,
  beiAbbruch,
}: {
  beiErfolg: (ebene: Ebene) => void;
  beiAbbruch: () => void;
}) {
  const [pin, setzePin] = useState('');
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [wasIstLos, setzeWasIstLos] = useState<WasIstLos | null>(null);
  // Ein Doppeltipp auf OK schickte dieselbe PIN zweimal - eine falsche
  // zaehlte dann als zwei Fehlversuche, und die Sperre kam einen Versuch zu frueh.
  const prueftGerade = useRef(false);

  // Abbruch automatisch nach 10 Sekunden Untaetigkeit - das lief vorher nie
  // ab (siehe zeitgeber.ts). "Was ist los?" bleibt eine Minute: Der Gastgeber
  // soll die Seite lesen und abfotografieren koennen, und zehn Sekunden
  // reichen dafuer nicht.
  useZeitgeber(beiAbbruch, wasIstLos ? 60_000 : 10_000, [pin, wasIstLos]);

  if (wasIstLos) {
    return (
      <div className="seite kiosk">
        <div className="kopf">
          <h1 className="titel">Was ist los?</h1>
          <p className="untertitel">
            {wasIstLos.veranstaltung?.name ?? 'Keine Veranstaltung aktiv'} — ein Foto dieser Seite
            beantwortet die meisten Fragen.
          </p>
        </div>
        {/* Linksbuendig mit der Ueberschrift: Eine mittig eingerueckte Liste
            unter einer linken Ueberschrift sah aus wie verrutscht. */}
        <div style={{ flex: 1, maxWidth: 'calc(200 * var(--mm))' }}>
          <Statusliste zustand={alsZustand(wasIstLos)} stand={wasIstLos.stand} />
        </div>
        <div className="reihe reihe--ende">
          <button className="knopf knopf--neben" onClick={() => setzeWasIstLos(null)}>
            Zurück
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="seite kiosk">
      <div className="mitte">
        <h1 className="titel">PIN eingeben</h1>
        <div className="pin-punkte">{'•'.repeat(pin.length)}</div>
        {meldung && <p className="untertitel">{meldung}</p>}
        <div className="pinfeld">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((z) => (
            <button key={z} onClick={() => tippe(z)}>
              {z}
            </button>
          ))}
          <button onClick={() => setzePin('')}>C</button>
          <button onClick={() => tippe('0')}>0</button>
          <button onClick={() => void pruefe()}>OK</button>
        </div>
      </div>
      <div className="reihe reihe--ende">
        {/* Ohne PIN erreichbar, damit auch ein Gast das Problem weitergeben kann. */}
        <button className="knopf knopf--neben" onClick={() => void ladeWasIstLos()}>
          Was ist los?
        </button>
        <button className="knopf knopf--neben" onClick={beiAbbruch}>
          Abbrechen
        </button>
      </div>
    </div>
  );

  function tippe(ziffer: string) {
    setzeMeldung(null);
    setzePin((alt) => (alt.length >= 8 ? alt : alt + ziffer));
  }

  async function pruefe() {
    if (prueftGerade.current) return;
    // Eine PIN hat 4 bis 8 Ziffern. Ein OK auf zu wenige Ziffern kostete
    // vorher einen der drei Versuche vor der Sperre - bei leerem Feld kam
    // sogar eine englische Pruefmeldung des Servers.
    if (pin.length < 4) {
      setzeMeldung(pin.length === 0 ? 'Bitte zuerst die PIN eintippen.' : 'Die PIN hat mindestens 4 Ziffern.');
      return;
    }
    prueftGerade.current = true;
    try {
      const antwort = await api.sende<{ ebene: Ebene }>('/api/kiosk/pin', { pin });
      beiErfolg(antwort.ebene);
    } catch (fehler) {
      setzePin('');
      setzeMeldung(fehler instanceof Error ? fehler.message : 'PIN stimmt nicht.');
    } finally {
      prueftGerade.current = false;
    }
  }

  async function ladeWasIstLos() {
    // Ohne Fehlerbehandlung passierte beim Tippen einfach nichts, wenn der
    // Server gerade neu startete - genau dann, wenn jemand wissen will, was los ist.
    try {
      setzeWasIstLos(await api.hole<WasIstLos>('/api/kiosk/wasistlos'));
    } catch {
      setzeMeldung('Die Box antwortet gerade nicht. Bitte gleich noch einmal versuchen.');
    }
  }
}

/**
 * Servicemenue. Der Kunde kann alles erledigen, was im Alltag anfaellt, aber
 * nichts kaputt machen.
 *
 * Links der Zustand der Box mit dem naechsten Handgriff, falls etwas nicht
 * stimmt - der Betreuer ist ja der "Jemand", dem der Gast Bescheid sagt.
 * Rechts die Handgriffe, jeder mit einer Zeile, was er tut.
 *
 * Es schliesst sich nach einer Minute ohne Beruehrung. Vorher blieb es offen,
 * bis jemand "Zurueck" drueckte - und ein offen gelassenes Besitzer-Menue
 * fuehrte jeden Gast mit einem Tipper in die Verwaltung.
 */
export function Servicemenue({
  ebene,
  beiSchliessen,
  beiGalerie,
  beiAdmin,
}: {
  ebene: Ebene;
  beiSchliessen: () => void;
  beiGalerie: () => void;
  beiAdmin: () => void;
}) {
  const [zustand, setzeZustand] = useState<WasIstLos | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [rueckfrage, setzeRueckfrage] = useState<Rueckfrage | null>(null);
  const [beruehrt, setzeBeruehrt] = useState(0);
  // Ein Handgriff zur Zeit: Ein Doppeltipp auf "Herunterfahren" oder
  // "Pause" schickte den Befehl sonst zweimal.
  const beschaeftigt = useRef(false);

  useZeitgeber(beiSchliessen, 60_000, [beruehrt, rueckfrage]);
  useZeitgeber(() => setzeMeldung(null), meldung ? 4000 : null, [meldung]);

  useEffect(() => {
    const laden = () =>
      api.hole<WasIstLos>('/api/kiosk/wasistlos').then(setzeZustand).catch(() => undefined);
    void laden();
    const uhr = setInterval(laden, 5000);
    return () => clearInterval(uhr);
  }, [meldung]);

  const pausiert = zustand?.veranstaltung?.status === 'pausiert';

  return (
    <div
      className="seite kiosk"
      style={{ position: 'relative' }}
      onPointerDown={() => setzeBeruehrt((n) => n + 1)}
    >
      <div className="kopf">
        <h1 className="titel">Servicemenü</h1>
        <p className="untertitel">
          {ebene === 'besitzer' ? 'Besitzer — voller Zugriff' : 'Betreuer — die Handgriffe des Alltags'}
          {zustand?.veranstaltung && ` · ${zustand.veranstaltung.name}`}
        </p>
      </div>

      <div className="service">
        <div className="service__spalte">
          {zustand ? (
            <>
              <Statusliste zustand={alsZustand(zustand)} stand={zustand.stand} />
              {zustand.betreuerHinweis && <p className="betreuer-hinweis">{zustand.betreuerHinweis}</p>}
            </>
          ) : (
            <p className="untertitel">Einen Moment…</p>
          )}
        </div>

        <div className="service__knoepfe">
          <button className="knopf knopf--haupt" onClick={beiSchliessen}>
            Zurück zum Kiosk
          </button>

          <p className="service__trenner">Alltag</p>
          <Handgriff
            titel={pausiert ? 'Pause beenden' : 'Pause einlegen'}
            zeile={pausiert ? 'Gäste können wieder fotografieren' : 'Etwa während des Essens'}
            beiTipp={() =>
              void tue('/api/kiosk/service/pause', { an: !pausiert }, pausiert ? 'Es geht weiter.' : 'Pause läuft.')
            }
          />
          <Handgriff
            titel="Papier gewechselt"
            zeile="Wartende Fotos weiter drucken"
            beiTipp={() => void papierGewechselt()}
          />
          <Handgriff titel="Galerie" zeile="Nachdrucken oder ein Foto herausnehmen" beiTipp={beiGalerie} />
          <Handgriff
            titel="Neue Rolle eingelegt"
            zeile="Papierzähler auf voll zurücksetzen"
            beiTipp={() =>
              setzeRueckfrage({
                titel: 'Neue Rolle eingelegt?',
                text:
                  'Der Papierzähler springt auf eine volle Rolle zurück. Wenn noch die alte ' +
                  'Rolle drin ist, zeigt die Box danach zu viel Papier an und warnt nicht rechtzeitig.',
                ja: 'Ja, neue Rolle ist drin',
                aktion: () => void tue('/api/kiosk/service/neue-rolle', {}, 'Papierzähler steht wieder auf voll.'),
              })
            }
          />

          {ebene === 'besitzer' && (
            <>
              <p className="service__trenner">Besitzer</p>
              <Handgriff
                titel="Verwaltung öffnen"
                zeile="Einstellungen, Vorlagen, Gerät"
                beiTipp={() => {
                  // Merkt sich, dass die Verwaltung am Kiosk offen ist: Dort
                  // kehrt sie nach Leerlauf von selbst zurueck (siehe Admin.tsx).
                  try {
                    sessionStorage.setItem(VOM_KIOSK, '1');
                  } catch {
                    // Ohne Speicher bleibt nur die Rueckkehr von Hand.
                  }
                  beiAdmin();
                }}
              />
              <Handgriff
                titel="Veranstaltung abschließen"
                zeile="Zahlen einfrieren, Auslagen-CSV schreiben"
                beiTipp={() => {
                  const ev = zustand?.veranstaltung;
                  // Vorher passierte ohne laufende Veranstaltung beim Tippen gar nichts.
                  if (!ev) {
                    setzeMeldung(zustand ? 'Es läuft gerade keine Veranstaltung.' : 'Einen Moment, der Zustand wird noch geladen.');
                    return;
                  }
                  const offen = zustand.warteschlangeOffen;
                  setzeRueckfrage({
                    titel: `„${ev.name}“ abschließen?`,
                    text:
                      'Die Zahlen werden eingefroren und die Auslagenaufstellung geschrieben. ' +
                      'Danach zeigt der Kiosk keine Startseite mehr. Wieder öffnen geht in der Verwaltung.' +
                      (offen > 0
                        ? ` ${offen === 1 ? 'Ein Foto wartet' : `${offen} Fotos warten`} noch auf den Druck und ` +
                          'kommt heraus, sobald der Drucker bereit ist.'
                        : ''),
                    ja: 'Abschließen',
                    aktion: () =>
                      void tue(`/api/admin/events/${ev.id}/status`, { status: 'abgeschlossen' }, 'Veranstaltung abgeschlossen.'),
                  });
                }}
              />
              <Handgriff
                titel="Kiosk schließen"
                zeile="Zum Windows-Desktop"
                beiTipp={() =>
                  setzeRueckfrage({
                    titel: 'Kiosk schließen?',
                    text:
                      'Die Fotobox-Oberfläche geht zu, und der Windows-Desktop erscheint. ' +
                      'Zurück geht es mit einem Doppelklick auf „Kiosk starten“ ' +
                      'oder beim nächsten Start des PCs.',
                    ja: 'Schließen',
                    aktion: () => void kioskSchliessen(),
                  })
                }
              />
              <Handgriff
                titel="PC herunterfahren"
                zeile="Sauber ausschalten vor dem Abbau"
                beiTipp={() =>
                  setzeRueckfrage({
                    titel: 'Fotobox herunterfahren?',
                    text:
                      'Der PC schaltet sich in 15 Sekunden aus. Alle Fotos und Zahlen sind ' +
                      'gespeichert. Kamera und Drucker danach von Hand ausschalten.',
                    ja: 'Herunterfahren',
                    aktion: () => void herunterfahren(),
                  })
                }
              />
            </>
          )}
        </div>
      </div>

      {rueckfrage && (
        <div className="rueckfrage">
          <div className="rueckfrage__karte">
            <p className="rueckfrage__titel">{rueckfrage.titel}</p>
            <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.45 }}>{rueckfrage.text}</p>
            <div className="reihe" style={{ justifyContent: 'flex-end' }}>
              <button className="knopf knopf--neben" onClick={() => setzeRueckfrage(null)}>
                Abbrechen
              </button>
              <button
                className="knopf"
                onClick={() => {
                  rueckfrage.aktion();
                  setzeRueckfrage(null);
                }}
              >
                {rueckfrage.ja}
              </button>
            </div>
          </div>
        </div>
      )}

      {meldung && <div className="hinweis-fest">{meldung}</div>}
    </div>
  );

  /** Schickt einen Handgriff ab; die Rueckmeldung baut `text` aus der Antwort. */
  async function handgriff<T>(pfad: string, koerper: unknown, text: (antwort: T) => string) {
    if (beschaeftigt.current) return;
    beschaeftigt.current = true;
    try {
      setzeMeldung(text(await api.sende<T>(pfad, koerper)));
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    } finally {
      beschaeftigt.current = false;
    }
  }

  function tue(pfad: string, koerper: unknown, erfolgstext: string) {
    return handgriff(pfad, koerper, () => erfolgstext);
  }

  function papierGewechselt() {
    return handgriff<{ wartend?: number }>('/api/kiosk/service/fortsetzen', {}, ({ wartend = 0 }) =>
      wartend === 0
        ? 'Es wartet kein Foto auf den Druck.'
        : `${wartend === 1 ? 'Ein Foto wird' : `${wartend} Fotos werden`} gedruckt, sobald der Drucker bereit ist.`,
    );
  }

  function kioskSchliessen() {
    return handgriff<{ simuliert: boolean }>('/api/kiosk/service/kiosk-schliessen', {}, (antwort) =>
      antwort.simuliert ? 'Im Testbetrieb bleibt der Kiosk offen.' : 'Kiosk wird geschlossen …',
    );
  }

  function herunterfahren() {
    return handgriff<{ simuliert: boolean }>('/api/kiosk/service/herunterfahren', {}, (antwort) =>
      antwort.simuliert ? 'Im Entwicklungsbetrieb wird nicht heruntergefahren.' : 'Der PC fährt in 15 Sekunden herunter.',
    );
  }
}

interface Rueckfrage {
  titel: string;
  text: string;
  ja: string;
  aktion: () => void;
}

function Handgriff({ titel, zeile, beiTipp }: { titel: string; zeile: string; beiTipp: () => void }) {
  return (
    <button className="knopf service__knopf" onClick={beiTipp}>
      {titel}
      <small>{zeile}</small>
    </button>
  );
}
