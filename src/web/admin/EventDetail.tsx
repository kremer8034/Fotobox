import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Zeiten } from '../api.js';
import { STATUS_NAME, STATUS_WECHSEL, UEBERGAENGE, type EventStatus } from '../../shared/typen.js';

interface EventVoll {
  id: string;
  name: string;
  datum: string;
  status: EventStatus;
  probelauf: boolean;
  galerieToken: string;
  statusToken: string;
  betreuerPinGesetzt: boolean;
  einstellungen: {
    zeiten: Zeiten;
    toene: { countdownPiep: boolean; ausloeser: boolean; ergebnis: boolean };
    druckAktiv: boolean;
    emailAktiv: boolean;
    galerieAktiv: boolean;
    qrAufStartseite: boolean;
    kopienVorgabe: number;
    kopienMax: number;
    druckLimit: number;
    ersatzJeDruck: number;
    startTitel: string;
    startUntertitel: string;
    farbeAkzent: string;
    hintergrundDatei: string | null;
    hintergrundAbdunkeln: number;
    einwilligungstext: string;
    emailLoeschfristTage: number;
    vorlagen: string[];
    filter: string[];
    diashowAufStart: boolean;
    diashowNachSekunden: number;
    diashowWechselSekunden: number;
    gaestebuchAktiv: boolean;
  };
  auslagen: {
    sitzungen: number;
    fotos: number;
    layouts: number;
    druckeGesamt: number;
    druckeNichtBerechnet: number;
    druckeFehlgeschlagen: number;
    betrag: number;
  };
}

interface Pruefpunkt {
  schluessel: string;
  titel: string;
  bestanden: boolean;
  hinweis: string;
  nurWarnung?: boolean;
}

const ZEIT_BESCHRIFTUNG: Record<keyof Zeiten, string> = {
  bereitmachenErstes: 'Bereitmachen vor dem ersten Foto',
  bereitmachenZwischen: 'Bereitmachen zwischen den Fotos',
  countdown: 'Countdown-Dauer',
  bestaetigung: 'Bestätigung des Fotos (0 = aus)',
  rueckkehrStart: 'Rückkehr zum Startbildschirm',
  galerieLeerlauf: 'Leerlauf in der Galerie',
  liveViewAbschaltung: 'Live-View aus nach Leerlauf (0 = nie)',
  sitzungAbbruch: 'Sitzungsabbruch bei Untätigkeit',
};

/** Dieselben Grenzen, die der Server prueft - siehe einstellungen-pruefung.ts. */
const ZEIT_GRENZEN: Record<keyof Zeiten, [number, number]> = {
  bereitmachenErstes: [0, 60],
  bereitmachenZwischen: [0, 60],
  countdown: [1, 10],
  bestaetigung: [0, 10],
  rueckkehrStart: [5, 600],
  galerieLeerlauf: [10, 600],
  liveViewAbschaltung: [0, 86_400],
  sitzungAbbruch: [30, 1800],
};

type Reiter =
  | 'uebersicht'
  | 'ablauf'
  | 'vorlagen'
  | 'ausgabe'
  | 'aussehen'
  | 'auslagen'
  | 'unterlagen';

// Kurze Namen mit Absicht: Sieben Reiter mit ausgeschriebenen Titeln passten
// nicht in eine Zeile, der letzte wurde abgeschnitten.
const REITER: { schluessel: Reiter; name: string }[] = [
  { schluessel: 'uebersicht', name: 'Übersicht' },
  { schluessel: 'ablauf', name: 'Ablauf & Töne' },
  { schluessel: 'vorlagen', name: 'Vorlagen & Filter' },
  { schluessel: 'ausgabe', name: 'Ausgabe' },
  { schluessel: 'aussehen', name: 'Aussehen & PIN' },
  { schluessel: 'auslagen', name: 'Auslagen' },
  { schluessel: 'unterlagen', name: 'Übergabe' },
];

/**
 * Verwaltung einer Veranstaltung.
 *
 * Die Seite war ein Stapel aus neun Karten und ueber zweitausend Pixel Hoehe:
 * Um an den Auslagenersatz zu kommen, scrollte man an Zeiten, Vorlagen und
 * Uebergabe vorbei. Jetzt liegt jeder Bereich auf einem eigenen Reiter - so,
 * wie es der Plan von Anfang an vorgesehen hat.
 */
export function EventDetail({ id, navigiere }: { id: string; navigiere: (ziel: string) => void }) {
  const [event, setzeEvent] = useState<EventVoll | null>(null);
  const [reiter, setzeReiter] = useState<Reiter>('uebersicht');
  const [vorlagen, setzeVorlagen] = useState<{ id: string; name: string; fotos: number }[]>([]);
  const [filter, setzeFilter] = useState<{ id: string; name: string }[]>([]);
  const [pruefung, setzePruefung] = useState<{ bestanden: boolean; punkte: Pruefpunkt[] } | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [pin, setzePin] = useState('');
  const [zettel, setzeZettel] = useState<string | null>(null);
  const [zielPfad, setzeZielPfad] = useState('');
  const [dialogOffen, setzeDialogOffen] = useState(false);
  // Das Notfall-Telefon gilt fuer alle Veranstaltungen - einmal eintragen, danach steht es schon da.
  const [telefon, setzeTelefon] = useState<string | null>(null);

  const lade = useCallback(async () => {
    setzeEvent(await api.hole<EventVoll>(`/api/admin/events/${id}`));
    setzeVorlagen(await api.hole('/api/admin/vorlagen'));
    setzeFilter(await api.hole('/api/admin/filter'));
  }, [id]);

  useEffect(() => {
    void lade();
  }, [lade]);

  useEffect(() => {
    void api
      .hole<{ notfallTelefon?: string }>('/api/admin/geraet')
      .then((g) => setzeTelefon((t) => t ?? g.notfallTelefon ?? ''))
      .catch(() => setzeTelefon((t) => t ?? ''));
  }, []);

  if (!event) return <p>Einen Moment…</p>;
  const e = event.einstellungen;

  // Ein Reiter, auf dem noch etwas fehlt, sagt das von aussen.
  const offen: Partial<Record<Reiter, boolean>> = {
    vorlagen: e.vorlagen.length === 0,
    aussehen: !event.betreuerPinGesetzt,
  };

  return (
    <>
      <div className="zeile" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0 }}>
          {event.name} <span className={`marke marke--${event.status}`}>{STATUS_NAME[event.status]}</span>
          {event.probelauf && (
            <span className="marke" style={{ marginLeft: '0.4rem' }}>
              Probelauf
            </span>
          )}
        </h1>
        <button className="knopf knopf--neben" onClick={() => navigiere('/admin/events')}>
          Zurück zur Liste
        </button>
      </div>

      <div className="reiter">
        {REITER.map((r) => (
          <button
            key={r.schluessel}
            className={reiter === r.schluessel ? 'aktiv' : ''}
            onClick={() => setzeReiter(r.schluessel)}
          >
            {r.name}
            {offen[r.schluessel] && <span className="reiter__hinweis" title="Hier fehlt noch etwas" />}
          </button>
        ))}
      </div>

      {reiter === 'uebersicht' && (
        <>
          {/* Name und Datum liessen sich nach dem Anlegen nicht mehr aendern -
              ein Tippfehler im Namen landete ueber {veranstaltung} auf jedem
              Ausdruck. Der Ordner auf der Platte behaelt seinen Namen. */}
          <div className="karte">
            <h2>Grunddaten</h2>
            <div className="zeile">
              <div className="feld" style={{ flex: 1 }}>
                <label>Name</label>
                <TextFeld
                  wert={event.name}
                  maxLaenge={80}
                  beiSpeichern={(t) => (t.trim() ? speichereGrunddaten({ name: t.trim() }) : undefined)}
                />
              </div>
              <div className="feld feld--klein">
                <label>Datum</label>
                <input
                  type="date"
                  value={event.datum}
                  onChange={(ev) => ev.target.value && void speichereGrunddaten({ datum: ev.target.value })}
                />
              </div>
            </div>
          </div>

          <VoreinstellungKarte eventId={event.id} />

          <div className="karte">
            <h2>Lebenszyklus</h2>
            <p style={{ color: 'var(--schrift-leise)', fontSize: '0.82rem', marginTop: 0 }}>
              Die Veranstaltung steht auf <strong>{STATUS_NAME[event.status]}</strong>. Angeboten
              werden nur die Wechsel, die von hier aus möglich sind — der Rest führte bisher bloß in
              eine Fehlermeldung.
            </p>
            <div className="zeile">
              {UEBERGAENGE[event.status].map((ziel, i) => (
                <button
                  key={ziel}
                  className={i === 0 ? 'knopf knopf--haupt' : 'knopf knopf--neben'}
                  onClick={() => void status(ziel)}
                >
                  {STATUS_WECHSEL[ziel]}
                </button>
              ))}
            </div>
            <div className="zeile" style={{ marginTop: '0.8rem' }}>
              <button
                className="knopf knopf--neben"
                onClick={() => void probelauf(!event.probelauf)}
                style={event.probelauf ? { borderColor: 'var(--akzent)' } : undefined}
              >
                Probelauf {event.probelauf ? 'ausschalten' : 'einschalten'}
              </button>
              <span style={{ color: 'var(--schrift-leise)', fontSize: '0.78rem' }}>
                Im Probelauf zählen Sitzungen weder in den Auslagenersatz noch in die Galerie.
              </span>
            </div>
          </div>

          <div className="karte">
            <h2>Startbereit-Check</h2>
            <button className="knopf knopf--neben" onClick={() => void pruefe()}>
              Jetzt prüfen
            </button>
            {pruefung && (
              <div style={{ marginTop: '0.8rem' }}>
                {pruefung.punkte.map((p) => (
                  <div className="pruef" key={p.schluessel}>
                    <span
                      className={`pruef__zeichen ${
                        p.bestanden ? 'pruef__ok' : p.nurWarnung ? 'pruef__warnung' : 'pruef__fehler'
                      }`}
                    >
                      {p.bestanden ? '✓' : p.nurWarnung ? '!' : '✗'}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div>{p.titel}</div>
                      <div className="pruef__hinweis">{p.hinweis}</div>
                    </div>
                    {!p.bestanden && beheben(p.schluessel) && (
                      <button
                        className="knopf knopf--neben"
                        onClick={() => beheben(p.schluessel)!()}
                      >
                        Beheben
                      </button>
                    )}
                  </div>
                ))}
                <p style={{ marginBottom: 0, color: pruefung.bestanden ? 'var(--gut)' : 'var(--fehler)' }}>
                  {pruefung.bestanden ? 'Alles bereit.' : 'Es fehlt noch etwas.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {reiter === 'ablauf' && (
        <div className="karte">
          <h2>Ablauf, Zeiten und Töne</h2>
          <p style={{ color: 'var(--schrift-leise)', fontSize: '0.82rem', marginTop: 0 }}>
            Alle Angaben in Sekunden. Vorlagen- und Filterauswahl haben bewusst kein Zeitlimit — die
            Rettungsleine gegen hängengebliebene Sitzungen ist der Abbruch bei Untätigkeit.
          </p>
          <div className="zeitraster">
            {(Object.keys(ZEIT_BESCHRIFTUNG) as (keyof Zeiten)[]).map((schluessel) => (
              <ZahlFeld
                key={schluessel}
                id={`zeit-${schluessel}`}
                name={ZEIT_BESCHRIFTUNG[schluessel]}
                wert={e.zeiten[schluessel]}
                grenzen={ZEIT_GRENZEN[schluessel]}
                beiSpeichern={(n) => speichere({ zeiten: { ...e.zeiten, [schluessel]: n } })}
              />
            ))}
          </div>
          <h2 style={{ marginTop: '1.2rem' }}>Töne</h2>
          <div className="zeile">
            <Schalter
              an={e.toene.countdownPiep}
              name="Countdown-Ton"
              beiWechsel={(an) => void speichere({ toene: { ...e.toene, countdownPiep: an } })}
            />
            <Schalter
              an={e.toene.ausloeser}
              name="Auslöseton"
              beiWechsel={(an) => void speichere({ toene: { ...e.toene, ausloeser: an } })}
            />
            <Schalter
              an={e.toene.ergebnis}
              name="Ton bei der Ergebnisanzeige"
              beiWechsel={(an) => void speichere({ toene: { ...e.toene, ergebnis: an } })}
            />
          </div>
        </div>
      )}

      {reiter === 'vorlagen' && (
        <div className="karte">
          <h2>Vorlagen und Filter</h2>
          <p style={{ color: 'var(--schrift-leise)', fontSize: '0.82rem', marginTop: 0 }}>
            Die Vorlage bestimmt, wie viele Fotos aufgenommen werden. „Ohne Filter“ ist immer die
            erste Kachel und immer vorausgewählt.
          </p>
          <div className="zeile" style={{ alignItems: 'flex-start', gap: '2.5rem' }}>
            <div>
              <strong style={{ fontSize: '0.85rem' }}>Freigegebene Vorlagen</strong>
              {vorlagen.length === 0 && (
                <p style={{ color: 'var(--schrift-leise)', fontSize: '0.82rem' }}>
                  Es gibt noch keine Vorlage in der Bibliothek.
                </p>
              )}
              {vorlagen.map((v) => (
                <Ankreuz
                  key={v.id}
                  an={e.vorlagen.includes(v.id)}
                  name={`${v.name} (${v.fotos} ${v.fotos === 1 ? 'Foto' : 'Fotos'})`}
                  beiWechsel={(an) => void speichere({ vorlagen: umschalten(e.vorlagen, v.id, an) })}
                />
              ))}
              {e.vorlagen.length === 0 && (
                <p style={{ color: 'var(--warnung)', fontSize: '0.8rem', marginBottom: 0 }}>
                  Ohne freigegebene Vorlage kann der Kiosk nicht starten.
                </p>
              )}
            </div>
            <div>
              <strong style={{ fontSize: '0.85rem' }}>Freigegebene Filter</strong>
              {filter.map((f) => (
                <Ankreuz
                  key={f.id}
                  an={e.filter.includes(f.id)}
                  gesperrt={f.id === 'ohne'}
                  name={f.id === 'ohne' ? `${f.name} (immer dabei)` : f.name}
                  beiWechsel={(an) => void speichere({ filter: umschalten(e.filter, f.id, an) })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {reiter === 'ausgabe' && (
        <div className="karte">
          <h2>Ausgabe</h2>
          <p style={{ color: 'var(--schrift-leise)', fontSize: '0.82rem', marginTop: 0 }}>
            Was hier aus ist, fehlt auf der Ergebnisseite ganz — kein ausgegrauter Knopf.
          </p>
          <div className="zeile">
            <Schalter an={e.druckAktiv} name="Drucken" beiWechsel={(an) => void speichere({ druckAktiv: an })} />
            <Schalter
              an={e.emailAktiv}
              name="E-Mail (nur wenn online)"
              beiWechsel={(an) => void speichere({ emailAktiv: an })}
            />
            <Schalter
              an={e.galerieAktiv}
              name="Galerie im WLAN"
              beiWechsel={(an) => void speichere({ galerieAktiv: an })}
            />
            <Schalter
              an={e.qrAufStartseite}
              name="QR-Code am Startbildschirm"
              beiWechsel={(an) => void speichere({ qrAufStartseite: an })}
            />
          </div>
          <div className="zeile">
            <ZahlFeld
              name="Kopien vorausgewählt"
              klein
              wert={e.kopienVorgabe}
              grenzen={[1, e.kopienMax]}
              beiSpeichern={(n) => speichere({ kopienVorgabe: n })}
            />
            <ZahlFeld
              name="Kopien je Foto höchstens"
              titel="Gilt je Foto: Ergebnisseite und Nachdrucke in der Galerie zusammen. Der Betreuer kann im Servicemenü darüber hinaus nachdrucken."
              klein
              wert={e.kopienMax}
              grenzen={[1, 10]}
              beiSpeichern={(n) => speichere({ kopienMax: n })}
            />
            <ZahlFeld
              name="Druck-Limit gesamt (0 = keins)"
              klein
              wert={e.druckLimit}
              grenzen={[0, 100_000]}
              beiSpeichern={(n) => speichere({ druckLimit: n })}
            />
          </div>
          {/*
            Die Gaeste lesen diesen Text, bevor sie ihre Adresse hergeben - also
            muss er sich auch aendern lassen. Vorher stand er im Datenmodell,
            aber in keinem Feld.
          */}
          {e.emailAktiv && (
            <div className="zeile" style={{ alignItems: 'flex-start' }}>
              <div className="feld" style={{ flex: 1 }}>
                <label htmlFor="einwilligung">
                  Einwilligungstext für die E-Mail — {'{loeschfrist}'} wird durch die Tage ersetzt
                </label>
                <TextFeld
                  id="einwilligung"
                  mehrzeilig
                  wert={e.einwilligungstext}
                  beiSpeichern={(t) => speichere({ einwilligungstext: t })}
                />
              </div>
              <ZahlFeld
                id="loeschfrist"
                name="Adressen löschen nach (Tagen)"
                klein
                wert={e.emailLoeschfristTage}
                grenzen={[1, 365]}
                beiSpeichern={(n) => speichere({ emailLoeschfristTage: n })}
              />
            </div>
          )}
          <Adressen eventId={id} />
          {e.emailAktiv && <MailHinweis />}
          {e.galerieAktiv && <GalerieNetz eventId={id} />}
          {e.galerieAktiv && (
            <div className="zeile" style={{ fontSize: '0.8rem', color: 'var(--schrift-leise)' }}>
              <span>
                Galerie: <code>/g/{event.galerieToken}</code>
                <br />
                Statusseite: <code>/s/{event.statusToken}</code>
              </span>
              <button className="knopf knopf--neben" onClick={() => void neuerToken()}>
                Galerie-Link erneuern
              </button>
              <button className="knopf knopf--neben" onClick={() => void neuerStatusToken()}>
                Status-Link erneuern
              </button>
            </div>
          )}
        </div>
      )}

      {reiter === 'ausgabe' && (
        <DiashowGaestebuchKarte
          eventId={id}
          einstellungen={e}
          galerieAktiv={e.galerieAktiv}
          beiAenderung={(teil) => speichere(teil)}
          zeige={zeige}
        />
      )}

      {reiter === 'aussehen' && (
        <HintergrundKarte
          datei={e.hintergrundDatei}
          abdunkeln={e.hintergrundAbdunkeln}
          titel={e.startTitel}
          untertitel={e.startUntertitel}
          beiAenderung={(teil) => speichere(teil)}
        />
      )}

      {reiter === 'aussehen' && (
        <div className="karte">
          <h2>Aussehen und PIN</h2>
          <div className="zeile">
            <div className="feld" style={{ flex: 1 }}>
              <label>Titel am Startbildschirm</label>
              <TextFeld wert={e.startTitel} maxLaenge={80} beiSpeichern={(t) => speichere({ startTitel: t })} />
            </div>
            <div className="feld" style={{ flex: 1 }}>
              <label>Untertitel</label>
              <TextFeld
                wert={e.startUntertitel}
                maxLaenge={160}
                beiSpeichern={(t) => speichere({ startUntertitel: t })}
              />
            </div>
            <div className="feld feld--klein">
              <label>Akzentfarbe</label>
              <input
                type="color"
                value={e.farbeAkzent}
                onChange={(ev) => void speichere({ farbeAkzent: ev.target.value })}
              />
            </div>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
            Die Akzentfarbe färbt im Kiosk den Hauptknopf, den Rand der gewählten Kachel und den
            Countdown-Punkt. Die Schrift darauf wird mitgerechnet, damit sie auf jeder Farbe lesbar
            bleibt.
          </p>
          <div className="zeile">
            <div className="feld feld--klein">
              <label>Betreuer-PIN {event.betreuerPinGesetzt ? '(gesetzt)' : '(fehlt)'}</label>
              {/* Nur Ziffern: Das Tastenfeld am Kiosk hat keine Buchstaben, und
                  mehr als 8 Stellen nimmt es nicht an. Eine PIN "abcd" liess
                  sich vorher setzen - und nie wieder eingeben. */}
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={8}
                value={pin}
                onChange={(ev) => setzePin(ev.target.value.replace(/\D/g, ''))}
                placeholder="4–8 Ziffern"
              />
            </div>
            <button className="knopf knopf--neben" disabled={!/^\d{4,8}$/.test(pin)} onClick={() => void setzePinAb()}>
              PIN setzen
            </button>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)', marginBottom: 0 }}>
            Die Betreuer-PIN bekommt der Gastgeber. Sie öffnet nur die Handgriffe des Alltags —
            Verwaltung und Herunterfahren bleiben der Besitzer-PIN vorbehalten.
          </p>
        </div>
      )}

      {reiter === 'auslagen' && (
        <div className="karte">
          <h2>Auslagenersatz</h2>
          <div className="zeile">
            <ZahlFeld
              name="Ersatz je Druck (€)"
              klein
              komma
              schritt={0.01}
              wert={e.ersatzJeDruck}
              grenzen={[0, 100]}
              beiSpeichern={(n) => speichere({ ersatzJeDruck: n })}
            />
          </div>
          <div className="zeile" style={{ marginTop: '0.4rem' }}>
            <Kennzahl name="Durchgänge" wert={String(event.auslagen.sitzungen)} />
            <Kennzahl name="Fotos" wert={String(event.auslagen.fotos)} />
            <Kennzahl name="Drucke berechnet" wert={String(event.auslagen.druckeGesamt)} />
            <Kennzahl name="nicht berechnet" wert={String(event.auslagen.druckeNichtBerechnet)} />
            <Kennzahl
              name="fehlgeschlagen"
              wert={String(event.auslagen.druckeFehlgeschlagen)}
              ton={event.auslagen.druckeFehlgeschlagen > 0 ? 'warnung' : undefined}
            />
          </div>
          <div className="zeile" style={{ marginTop: '0.8rem', alignItems: 'center' }}>
            <div className="kennzahl kennzahl--gut" style={{ minWidth: '11rem' }}>
              <span className="kennzahl__wert">
                {event.auslagen.betrag.toFixed(2).replace('.', ',')} €
              </span>
              <span className="kennzahl__name">
                {event.auslagen.druckeGesamt} Drucke × {e.ersatzJeDruck.toFixed(2).replace('.', ',')} €
              </span>
            </div>
            <a className="knopf knopf--neben" href={`/api/admin/events/${id}/auslagen.csv`}>
              CSV herunterladen
            </a>
          </div>
        </div>
      )}

      {reiter === 'unterlagen' && (
        <>
          <div className="karte">
            <h2>Kurzanleitung für den Gastgeber</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
              Der Zettel mit der Betreuer-PIN, der in die Box kommt. Die PIN setzt die Fotobox selbst ein –
              so, wie sie unter „Aussehen &amp; PIN“ gesetzt ist. Der Betreuer kann ihn am Ende auch über einen
              unauffälligen Link unten in der Handy-Galerie aufs eigene Handy laden. Den Aushang für die Gäste
              gibt es unter „WLAN &amp; Portal“ – er gilt für jede Feier.
            </p>
            <div className="zeile">
              <div className="feld feld--klein">
                <label>Telefon für den Notfall (für alle Veranstaltungen)</label>
                <input value={telefon ?? ''} maxLength={40} onChange={(ev) => setzeTelefon(ev.target.value)} />
              </div>
              <button
                className="knopf knopf--neben"
                disabled={!event.betreuerPinGesetzt || telefon === null}
                onClick={() => void unterlagen()}
              >
                Kurzanleitung erzeugen
              </button>
            </div>
            {!event.betreuerPinGesetzt && (
              <p style={{ fontSize: '0.85rem', marginBottom: 0 }}>
                Erst unter „Aussehen &amp; PIN“ eine Betreuer-PIN setzen.
              </p>
            )}
            {zettel && (
              <p style={{ marginBottom: 0 }}>
                <a href={zettel} target="_blank" rel="noreferrer">
                  Kurzanleitung öffnen
                </a>
              </p>
            )}
          </div>

          <div className="karte">
            <h2>Übergabe an den Gastgeber</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
              Kopiert die Fotos der Veranstaltung: Originale, bearbeitete Fotos und die fertigen
              Layouts – und, wenn Gäste etwas geschrieben haben, das Gästebuch als PDF. Druckdateien, Testfotos aus dem Probelauf und die Unterlagen der Box
              (Auslagen, Einstellungen) bleiben auf der Box. Erst wenn eine Markerdatei drüben ankommt
              und die Dateizahl stimmt, gilt die Kopie als vollständig.
            </p>
            <div className="zeile">
              <div className="feld" style={{ flex: 1 }}>
                <label>Ziel (USB-Stick oder Ordner)</label>
                <input
                  value={zielPfad}
                  onChange={(ev) => setzeZielPfad(ev.target.value)}
                  placeholder="„Ordner wählen …“ antippen – oder den Pfad eintragen"
                />
              </div>
              <button className="knopf knopf--neben" disabled={dialogOffen} onClick={() => void ordnerWaehlen()}>
                {dialogOffen ? 'Dialog ist offen …' : 'Ordner wählen …'}
              </button>
              <button
                className="knopf knopf--neben"
                disabled={zielPfad.length < 2}
                onClick={() => void uebergeben()}
              >
                Jetzt übergeben
              </button>
            </div>
          </div>
          {(event.status === 'abgeschlossen' || event.status === 'archiviert') && (
            <div className="karte">
              <h2>Von der Box löschen</h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
                Nach der Übergabe gehören die Fotos dem Gastgeber, nicht der Box. Löscht den ganzen
                Ordner mit allen Originalen, Layouts und Adressen — endgültig. Vorher prüfen, dass die
                Übergabe geklappt hat.
              </p>
              <button className="knopf knopf--neben" style={{ borderColor: 'var(--fehler)' }} onClick={() => void loeschen()}>
                Veranstaltung löschen
              </button>
            </div>
          )}
        </>
      )}

      {/* Fest in der Ecke statt oben auf der Seite: Wer unten die PIN eintippt,
          hat die Bestaetigung dort sonst nie zu Gesicht bekommen. */}
      {meldung && <div className="hinweis-fest">{meldung}</div>}
    </>
  );

  /** Springt zu dem Reiter, auf dem der fehlgeschlagene Pruefpunkt behoben wird. */
  function beheben(schluessel: string): (() => void) | null {
    const ziel: Record<string, Reiter> = {
      vorlagen: 'vorlagen',
      betreuerPin: 'aussehen',
      galerie: 'ausgabe',
      unterlagen: 'unterlagen',
      material: 'auslagen',
    };
    const reiterZiel = ziel[schluessel];
    return reiterZiel ? () => setzeReiter(reiterZiel) : null;
  }

  /**
   * Sofort speichern - aber nie still scheitern. Vorher blieb ein Fehler
   * unbemerkt: Das Feld zeigte den neuen Wert, gespeichert war der alte.
   */
  async function speichere(teil: Record<string, unknown>) {
    setzeEvent((alt) =>
      alt ? { ...alt, einstellungen: { ...alt.einstellungen, ...teil } as typeof alt.einstellungen } : alt,
    );
    try {
      await api.aendere(`/api/admin/events/${id}`, { einstellungen: teil });
      zeige('Gespeichert.');
    } catch (u) {
      zeige(`Nicht gespeichert: ${u instanceof Error ? u.message : 'unbekannter Fehler'}`);
      await lade().catch(() => undefined);
    }
  }

  async function speichereGrunddaten(teil: { name?: string; datum?: string }) {
    try {
      await api.aendere(`/api/admin/events/${id}`, teil);
      await lade();
      zeige('Gespeichert.');
    } catch (u) {
      zeige(`Nicht gespeichert: ${u instanceof Error ? u.message : 'unbekannter Fehler'}`);
      await lade().catch(() => undefined);
    }
  }

  /** Jede Aktion zeigt ihren Fehler - vorher verschwanden sie in der Konsole. */
  async function versuche(aktion: () => Promise<void>) {
    try {
      await aktion();
    } catch (u) {
      zeige(u instanceof Error ? u.message : 'Hat nicht geklappt.');
    }
  }

  function zeige(text: string) {
    setzeMeldung(text);
    setTimeout(() => setzeMeldung(null), 4000);
  }

  async function status(neu: EventStatus) {
    // "Erst wenn alles gruen ist - oder bewusst uebersprungen wurde": Vor dem
    // Startbereit- und dem Aktiv-Schalten laeuft der Check. Vorher liess sich
    // eine Veranstaltung ohne Vorlage oder ohne PIN einfach starten.
    if (neu === 'startbereit' || neu === 'aktiv') {
      try {
        const ergebnis = await api.hole<{ bestanden: boolean; punkte: Pruefpunkt[] }>(
          `/api/admin/events/${id}/startbereit`,
        );
        setzePruefung(ergebnis);
        const offen = ergebnis.punkte.filter((p) => !p.bestanden && !p.nurWarnung);
        if (
          offen.length > 0 &&
          !window.confirm(
            `Der Startbereit-Check meldet noch:\n\n${offen.map((p) => `• ${p.titel}`).join('\n')}\n\nTrotzdem weiter?`,
          )
        ) {
          return;
        }
      } catch {
        // Ein fehlgeschlagener Check haelt nicht auf - der Wechsel selbst prueft weiter.
      }
    }
    try {
      await api.sende(`/api/admin/events/${id}/status`, { status: neu });
      await lade();
      zeige(`Steht jetzt auf „${STATUS_NAME[neu]}“.`);
    } catch (u) {
      zeige(u instanceof Error ? u.message : 'Wechsel nicht möglich.');
    }
  }

  function probelauf(an: boolean) {
    return versuche(async () => {
      await api.sende(`/api/admin/events/${id}/probelauf`, { an });
      await lade();
    });
  }

  function pruefe() {
    return versuche(async () => setzePruefung(await api.hole(`/api/admin/events/${id}/startbereit`)));
  }

  function neuerToken() {
    return versuche(async () => {
      await api.sende(`/api/admin/events/${id}/galerie-token`, {});
      await lade();
      zeige('Der alte Link ist jetzt tot. Den QR-Aushang neu erzeugen und austauschen.');
    });
  }

  function neuerStatusToken() {
    return versuche(async () => {
      await api.sende(`/api/admin/events/${id}/status-token`, {});
      await lade();
      zeige('Der alte Status-Link ist jetzt tot.');
    });
  }

  function unterlagen() {
    return versuche(async () => {
      const antwort = await api.sende<{ link: string }>(`/api/admin/events/${id}/unterlagen`, {
        telefon: telefon ?? undefined,
      });
      setzeZettel(antwort.link);
      zeige('Kurzanleitung erzeugt – zum Öffnen und Drucken den Link unten nutzen.');
    });
  }

  /** Der Ordnerdialog von Windows - etwa fuer einen Ordner in OneDrive oder einen USB-Stick. */
  async function ordnerWaehlen() {
    setzeDialogOffen(true);
    try {
      const { pfad } = await api.sende<{ pfad: string | null }>('/api/admin/ordner/waehlen', { start: zielPfad });
      if (pfad) setzeZielPfad(pfad);
    } catch (u) {
      zeige(u instanceof Error ? u.message : 'Der Ordnerdialog ließ sich nicht öffnen.');
    } finally {
      setzeDialogOffen(false);
    }
  }

  async function uebergeben() {
    setzeMeldung('Kopiere…');
    await versuche(async () => {
      const ergebnis = await api.sende<{ meldung: string; geprueft: boolean; ziel: string }>(
        `/api/admin/events/${id}/uebergabe`,
        { ziel: zielPfad },
      );
      zeige(`${ergebnis.meldung} Ziel: ${ergebnis.ziel}`);
      await lade();
    });
  }

  async function loeschen() {
    const eingabe = window.prompt(
      `Alle Fotos von „${event!.name}“ werden endgültig von der Box gelöscht.\n\nZur Bestätigung den Namen eintippen:`,
    );
    if (eingabe === null) return;
    await versuche(async () => {
      await api.loesche(`/api/admin/events/${id}`, { bestaetigung: eingabe });
      navigiere('/admin/events');
    });
  }

  function setzePinAb() {
    return versuche(async () => {
      await api.aendere(`/api/admin/events/${id}`, { betreuerPin: pin });
      setzePin('');
      await lade();
      zeige('Betreuer-PIN gesetzt – sie kommt automatisch auf die Kurzanleitung unter „Übergabe“.');
    });
  }
}

/**
 * Zahlenfeld, das nur Gueltiges speichert. Waehrend des Tippens gilt der
 * Entwurf; gespeichert wird kurz nach dem letzten Tastendruck, und nur, wenn
 * eine Zahl innerhalb der Grenzen dasteht. Beim Verlassen springt ein leeres
 * oder ungueltiges Feld auf den gespeicherten Wert zurueck.
 */
function ZahlFeld({
  id,
  name,
  titel,
  wert,
  grenzen,
  schritt = 1,
  komma = false,
  klein = false,
  beiSpeichern,
}: {
  id?: string;
  name: string;
  titel?: string;
  wert: number;
  grenzen: [number, number];
  schritt?: number;
  komma?: boolean;
  klein?: boolean;
  beiSpeichern: (n: number) => Promise<void> | void;
}) {
  const [entwurf, setzeEntwurf] = useState(String(wert));
  const fokus = useRef(false);
  const uhr = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!fokus.current) setzeEntwurf(String(wert));
  }, [wert]);

  const lies = (t: string): number | null => {
    if (t.trim() === '') return null;
    const n = Number(t.replace(',', '.'));
    if (!Number.isFinite(n) || n < grenzen[0] || n > grenzen[1]) return null;
    if (!komma && !Number.isInteger(n)) return null;
    return n;
  };
  const gueltig = lies(entwurf) !== null;

  return (
    <div className={`feld${klein ? ' feld--klein' : ''}`}>
      <label htmlFor={id} title={titel}>
        {name}
      </label>
      <input
        id={id}
        className="zahl"
        type="number"
        min={grenzen[0]}
        max={grenzen[1]}
        step={schritt}
        value={entwurf}
        aria-invalid={!gueltig}
        style={gueltig ? undefined : { borderColor: 'var(--fehler)' }}
        onFocus={() => (fokus.current = true)}
        onChange={(ev) => {
          const t = ev.target.value;
          setzeEntwurf(t);
          if (uhr.current) clearTimeout(uhr.current);
          const n = lies(t);
          if (n !== null && n !== wert) uhr.current = setTimeout(() => void beiSpeichern(n), 500);
        }}
        onBlur={() => {
          fokus.current = false;
          if (uhr.current) clearTimeout(uhr.current);
          const n = lies(entwurf);
          if (n === null) setzeEntwurf(String(wert));
          else if (n !== wert) void beiSpeichern(n);
        }}
      />
      {!gueltig && (
        <small style={{ color: 'var(--fehler)' }}>
          {grenzen[0]} bis {grenzen[1]}
        </small>
      )}
    </div>
  );
}

/** Textfeld, das kurz nach dem letzten Tastendruck speichert - nicht bei jedem. */
function TextFeld({
  id,
  wert,
  maxLaenge,
  mehrzeilig = false,
  beiSpeichern,
}: {
  id?: string;
  wert: string;
  maxLaenge?: number;
  mehrzeilig?: boolean;
  beiSpeichern: (t: string) => Promise<void> | void;
}) {
  const [entwurf, setzeEntwurf] = useState(wert);
  const fokus = useRef(false);
  const uhr = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!fokus.current) setzeEntwurf(wert);
  }, [wert]);
  const aendern = (t: string) => {
    setzeEntwurf(t);
    if (uhr.current) clearTimeout(uhr.current);
    uhr.current = setTimeout(() => void beiSpeichern(t), 700);
  };
  const verlassen = () => {
    fokus.current = false;
    if (uhr.current) clearTimeout(uhr.current);
    if (entwurf !== wert) void beiSpeichern(entwurf);
  };
  return mehrzeilig ? (
    <textarea
      id={id}
      rows={3}
      maxLength={maxLaenge}
      value={entwurf}
      onFocus={() => (fokus.current = true)}
      onChange={(ev) => aendern(ev.target.value)}
      onBlur={verlassen}
    />
  ) : (
    <input
      id={id}
      maxLength={maxLaenge}
      value={entwurf}
      onFocus={() => (fokus.current = true)}
      onChange={(ev) => aendern(ev.target.value)}
      onBlur={verlassen}
    />
  );
}

interface Adresseintrag {
  id: string;
  adresse: string;
  status: string;
  einwilligungAm: string | null;
  geloeschtAm: string | null;
}

/**
 * Die erfassten E-Mail-Adressen - fuer die Auskunft, wenn ein Gast fragt, und
 * zum sofortigen Loeschen, wenn er darum bittet. Nach der Frist loescht die Box
 * sie ohnehin selbst; Zeitpunkt und Wortlaut der Einwilligung bleiben als
 * Nachweis stehen.
 */
function Adressen({ eventId }: { eventId: string }) {
  const [daten, setzeDaten] = useState<{ loeschfristTage: number; adressen: Adresseintrag[] } | null>(null);

  useEffect(() => {
    void lade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  if (!daten || daten.adressen.length === 0) return null;
  const offen = daten.adressen.filter((a) => !a.geloeschtAm);
  const datum = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';

  return (
    <div style={{ marginTop: '1rem' }}>
      <div className="zeile">
        <strong>Erfasste E-Mail-Adressen</strong>
        <span style={{ color: 'var(--schrift-leise)', fontSize: '0.85rem' }}>
          {offen.length} gespeichert, {daten.adressen.length - offen.length} bereits gelöscht · automatisch
          gelöscht {daten.loeschfristTage} Tage nach der Einwilligung
        </span>
        {offen.length > 0 && (
          <button
            className="knopf knopf--neben"
            onClick={() => {
              if (window.confirm(`Alle ${offen.length} gespeicherten Adressen jetzt löschen?`)) void alleLoeschen();
            }}
          >
            Alle jetzt löschen
          </button>
        )}
      </div>
      {offen.length > 0 && (
        <ul className="vorfaelle" style={{ marginTop: '0.5rem' }}>
          {offen.map((a) => (
            <li key={a.id} className="vorfaelle__eintrag" style={{ gridTemplateColumns: '9rem 1fr 7rem auto' }}>
              <span className="vorfaelle__zeit">{datum(a.einwilligungAm)}</span>
              <span>{a.adresse}</span>
              <span className="vorfaelle__bereich">{a.status}</span>
              <button className="knopf knopf--neben" onClick={() => void loeschen(a.id)}>
                Löschen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  async function lade() {
    setzeDaten(await api.hole(`/api/admin/events/${eventId}/adressen`));
  }

  async function loeschen(versandId: string) {
    await api.loesche(`/api/admin/events/${eventId}/adressen/${versandId}`);
    await lade();
  }

  async function alleLoeschen() {
    await api.loesche(`/api/admin/events/${eventId}/adressen`);
    await lade();
  }
}

function umschalten(liste: string[], id: string, an: boolean): string[] {
  return an ? [...new Set([...liste, id])] : liste.filter((x) => x !== id);
}

function Schalter({
  an,
  name,
  beiWechsel,
}: {
  an: boolean;
  name: string;
  beiWechsel: (an: boolean) => void;
}) {
  return (
    <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', fontSize: '0.85rem' }}>
      <input type="checkbox" checked={an} onChange={(e) => beiWechsel(e.target.checked)} />
      {name}
    </label>
  );
}

function Ankreuz({
  an,
  name,
  gesperrt,
  beiWechsel,
}: {
  an: boolean;
  name: string;
  gesperrt?: boolean;
  beiWechsel: (an: boolean) => void;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: '0.45rem',
        alignItems: 'center',
        fontSize: '0.85rem',
        padding: '0.28rem 0',
        opacity: gesperrt ? 0.7 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={an}
        disabled={gesperrt}
        onChange={(e) => beiWechsel(e.target.checked)}
      />
      {name}
    </label>
  );
}

function Kennzahl({ name, wert, ton }: { name: string; wert: string; ton?: 'gut' | 'warnung' }) {
  return (
    <div className={`kennzahl${ton ? ` kennzahl--${ton}` : ''}`}>
      <span className="kennzahl__wert">{wert}</span>
      <span className="kennzahl__name">{name}</span>
    </div>
  );
}

/**
 * Die Einstellungen dieser Veranstaltung unter einem Namen aufheben, um die
 * naechste gleicher Art daraus anzulegen. Ein vorhandener Name wird
 * ueberschrieben - so bleibt "Kinderparty" immer der aktuelle Stand.
 */
function VoreinstellungKarte({ eventId }: { eventId: string }) {
  const [name, setzeName] = useState('');
  const [vorhandene, setzeVorhandene] = useState<{ id: string; name: string }[]>([]);
  const [meldung, setzeMeldung] = useState<string | null>(null);

  useEffect(() => {
    void api
      .hole<{ id: string; name: string }[]>('/api/admin/voreinstellungen')
      .then(setzeVorhandene)
      .catch(() => undefined);
  }, []);

  const ueberschreibt = vorhandene.some((v) => v.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <div className="karte">
      <h2>Als Voreinstellung speichern</h2>
      <p style={{ color: 'var(--schrift-leise)', fontSize: '0.82rem', marginTop: 0 }}>
        Hebt alle Einstellungen dieser Veranstaltung auf – Vorlagen, Filter, Zeiten, Texte, Kopien, Limits.
        Beim Anlegen der nächsten Veranstaltung unter „Einstellungen“ auswählen.
      </p>
      <div className="zeile">
        <div className="feld" style={{ flex: 1 }}>
          <label htmlFor="vorein-name">Name der Voreinstellung</label>
          <input
            id="vorein-name"
            list="vorein-liste"
            value={name}
            maxLength={60}
            placeholder="Kinderparty"
            onChange={(e) => {
              setzeName(e.target.value);
              setzeMeldung(null);
            }}
          />
          <datalist id="vorein-liste">
            {vorhandene.map((v) => (
              <option key={v.id} value={v.name} />
            ))}
          </datalist>
        </div>
        <button className="knopf knopf--neben" disabled={!name.trim()} onClick={() => void speichere()}>
          {ueberschreibt ? 'Überschreiben' : 'Speichern'}
        </button>
      </div>
      {meldung && <p style={{ marginBottom: 0 }}>{meldung}</p>}
    </div>
  );

  async function speichere() {
    if (ueberschreibt && !window.confirm(`Die Voreinstellung „${name.trim()}“ gibt es schon. Überschreiben?`)) return;
    try {
      const v = await api.sende<{ id: string; name: string }>('/api/admin/voreinstellungen', {
        eventId,
        name: name.trim(),
      });
      setzeMeldung(`Gespeichert als „${v.name}“.`);
      setzeVorhandene((alt) => [...alt.filter((a) => a.id !== v.id), v]);
      setzeName('');
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    }
  }
}

/**
 * Hintergrundbild des Startbildschirms. Ausgewaehlt ueber den normalen
 * Dateidialog; der Server verkleinert es und legt es ab. Die kleine Vorschau
 * zeigt den Startbildschirm im Seitenverhaeltnis des Touchscreens (16:9) - so
 * sieht man vorher, welcher Ausschnitt bleibt und ob die Schrift lesbar ist.
 */
function HintergrundKarte({
  datei,
  abdunkeln,
  titel,
  untertitel,
  beiAenderung,
}: {
  datei: string | null;
  abdunkeln: number;
  titel: string;
  untertitel: string;
  beiAenderung: (teil: { hintergrundDatei?: string | null; hintergrundAbdunkeln?: number }) => Promise<void>;
}) {
  const [laedt, setzeLaedt] = useState(false);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [dunkel, setzeDunkel] = useState(abdunkeln);
  const auswahl = useRef<HTMLInputElement>(null);

  useEffect(() => setzeDunkel(abdunkeln), [abdunkeln]);

  async function hochladen(bild: File) {
    setzeLaedt(true);
    setzeFehler(null);
    try {
      const antwort = await api.sendeDatei<{ datei: string }>('/api/admin/hintergrund', bild);
      await beiAenderung({ hintergrundDatei: antwort.datei });
    } catch (f) {
      setzeFehler(f instanceof Error ? f.message : 'Das Bild ließ sich nicht hochladen.');
    } finally {
      setzeLaedt(false);
      if (auswahl.current) auswahl.current.value = '';
    }
  }

  const deckkraft = dunkel / 100;
  return (
    <div className="karte">
      <h2>Hintergrundbild am Startbildschirm</h2>
      <div className="zeile" style={{ alignItems: 'flex-start' }}>
        <div
          className="hintergrund-vorschau"
          style={
            datei
              ? {
                  backgroundImage: `linear-gradient(rgba(0, 0, 0, ${deckkraft}), rgba(0, 0, 0, ${deckkraft})), url("/medien/hintergrund/${datei}")`,
                }
              : undefined
          }
        >
          <strong>{titel}</strong>
          <span>{untertitel}</span>
          <span className="hintergrund-vorschau__knopf">Foto starten</span>
        </div>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <input
            ref={auswahl}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(ev) => {
              const bild = ev.target.files?.[0];
              if (bild) void hochladen(bild);
            }}
          />
          <div className="zeile">
            <button className="knopf knopf--neben" disabled={laedt} onClick={() => auswahl.current?.click()}>
              {laedt ? 'Wird hochgeladen …' : datei ? 'Anderes Bild wählen …' : 'Bild auswählen …'}
            </button>
            {datei && (
              <button className="knopf knopf--neben" disabled={laedt} onClick={() => void beiAenderung({ hintergrundDatei: null })}>
                Entfernen
              </button>
            )}
          </div>
          {fehler && <p style={{ color: 'var(--warnung)' }}>{fehler}</p>}
          {datei && (
            <div className="feld" style={{ marginTop: '0.8rem' }}>
              <label htmlFor="hintergrund-dunkel">Abdunkeln: {dunkel} %</label>
              <input
                id="hintergrund-dunkel"
                type="range"
                min={0}
                max={80}
                step={5}
                value={dunkel}
                onChange={(ev) => setzeDunkel(Number(ev.target.value))}
                onPointerUp={() => void beiAenderung({ hintergrundAbdunkeln: dunkel })}
                onKeyUp={() => void beiAenderung({ hintergrundAbdunkeln: dunkel })}
              />
            </div>
          )}
          <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)' }}>
            PNG, JPEG oder WEBP. Das Bild füllt den ganzen Bildschirm und liegt hinter Titel und
            Knöpfen; was nicht ins Format 16:9 passt, wird oben und unten bzw. links und rechts
            abgeschnitten. Am besten ein Querformat mit mindestens 1920 × 1080 Pixeln. Abdunkeln hält
            Schrift und Knöpfe lesbar.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Wo die Handys die Galerie finden - und ob Windows sie durchlaesst. Auf der
 * Box hiess es vorher nur "auf dem Handy laedt nichts", ohne Anhaltspunkt.
 */
function GalerieNetz({ eventId }: { eventId: string }) {
  const [stand, setzeStand] = useState<{
    url: string | null;
    netz: string | null;
    kategorie: string | null;
    hinweis: string | null;
  } | null>(null);

  useEffect(() => {
    let aktiv = true;
    api
      .hole<NonNullable<typeof stand>>(`/api/admin/events/${eventId}/galerie-netz`)
      .then((s) => aktiv && setzeStand(s))
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, [eventId]);

  if (!stand) return null;
  return (
    <div style={{ fontSize: '0.82rem', margin: '0.6rem 0' }}>
      {stand.url && (
        <p style={{ margin: '0 0 0.3rem' }}>
          Die Handys öffnen <code>{stand.url}</code>
          {stand.netz ? (
            <>
              {' '}– sie müssen dafür im WLAN <strong>„{stand.netz}“</strong> sein, im selben Netz wie die Box.
            </>
          ) : (
            ' – sie müssen dafür im selben WLAN sein wie die Box.'
          )}{' '}
          Mit mobilen Daten klappt es nicht.
        </p>
      )}
      {stand.hinweis && <p style={{ margin: 0, color: 'var(--warnung)' }}>{stand.hinweis}</p>}
    </div>
  );
}

/**
 * E-Mail ist an, aber unter Geraet steht kein Mailserver: Dann fehlt der
 * Knopf "Per E-Mail schicken" auf der Ergebnisseite - vorher ohne Erklaerung.
 */
function MailHinweis() {
  const [fehlt, setzeFehlt] = useState(false);
  useEffect(() => {
    let aktiv = true;
    api
      .hole<{ mail: unknown | null }>('/api/admin/geraet')
      .then((g) => aktiv && setzeFehlt(!g.mail))
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, []);
  if (!fehlt) return null;
  return (
    <p style={{ fontSize: '0.82rem', color: 'var(--warnung)', margin: '0.6rem 0' }}>
      Noch kein Mailserver eingetragen (Verwaltung → Gerät → E-Mail). Solange erscheint der Knopf „Per E-Mail
      schicken“ auf der Ergebnisseite nicht.
    </p>
  );
}

/**
 * Diashow und Gaestebuch - beides fuer die Feier selbst: Die Diashow laeuft am
 * Startbildschirm im Leerlauf und auf Wunsch auf einem Beamer oder Fernseher,
 * das Gaestebuch sammelt handgeschriebene Gruesse fuer den Gastgeber.
 */
function DiashowGaestebuchKarte({
  eventId,
  einstellungen: e,
  galerieAktiv,
  beiAenderung,
  zeige,
}: {
  eventId: string;
  einstellungen: EventVoll['einstellungen'];
  galerieAktiv: boolean;
  beiAenderung: (teil: Record<string, unknown>) => Promise<void>;
  zeige: (text: string) => void;
}) {
  const [wlan, setzeWlan] = useState<{ wlan: string | null; kurz: boolean } | null>(null);
  const [gruesse, setzeGruesse] = useState<number | null>(null);

  useEffect(() => {
    let aktiv = true;
    api
      .hole<{ wlan: string | null; kurz: boolean }>(`/api/admin/events/${eventId}/diashow`)
      .then((d) => aktiv && setzeWlan(d))
      .catch(() => undefined);
    api
      .hole<{ anzahl: number }>(`/api/admin/events/${eventId}/gaestebuch`)
      .then((d) => aktiv && setzeGruesse(d.anzahl))
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, [eventId, galerieAktiv]);

  async function fenster(an: boolean) {
    try {
      const antwort = await api.sende<{ simuliert?: boolean }>('/api/admin/diashow/fenster', { an });
      zeige(
        antwort.simuliert
          ? 'Im Entwicklungsbetrieb wird kein Fenster geöffnet.'
          : an
            ? 'Die Diashow läuft auf dem zweiten Bildschirm.'
            : 'Diashow beendet.',
      );
    } catch (u) {
      zeige(u instanceof Error ? u.message : 'Hat nicht geklappt.');
    }
  }

  const leise = { fontSize: '0.82rem', color: 'var(--schrift-leise)' } as const;
  return (
    <div className="karte">
      <h2>Diashow</h2>
      <p style={{ ...leise, marginTop: 0 }}>
        Die Fotos der Feier als Diashow – neue Fotos kommen sofort an die Reihe. Gezeigt wird nur, was auch in
        der Galerie steht: kein Probelauf und nichts, was aus der Galerie genommen wurde.
      </p>
      <div className="zeile">
        <Schalter
          an={e.diashowAufStart}
          name="Am Startbildschirm, wenn niemand die Box benutzt"
          beiWechsel={(an) => void beiAenderung({ diashowAufStart: an })}
        />
      </div>
      <div className="zeile">
        <ZahlFeld
          name="Beginnt nach (Sekunden)"
          klein
          wert={e.diashowNachSekunden}
          grenzen={[15, 600]}
          beiSpeichern={(n) => beiAenderung({ diashowNachSekunden: n })}
        />
        <ZahlFeld
          name="Jedes Bild steht (Sekunden)"
          klein
          wert={e.diashowWechselSekunden}
          grenzen={[3, 30]}
          beiSpeichern={(n) => beiAenderung({ diashowWechselSekunden: n })}
        />
      </div>
      <p style={{ ...leise, marginBottom: '0.4rem' }}>
        <strong>Beamer oder Fernseher am HDMI-Anschluss der Box:</strong> anschließen, in Windows unter „Anzeige“
        auf „Erweitern“ stellen, dann hier öffnen.
      </p>
      <div className="zeile">
        <button className="knopf knopf--neben" onClick={() => void fenster(true)}>
          Auf zweitem Bildschirm zeigen
        </button>
        <button className="knopf knopf--neben" onClick={() => void fenster(false)}>
          Diashow beenden
        </button>
        <a className="knopf knopf--neben" href="/diashow" target="_blank" rel="noreferrer">
          Vorschau
        </a>
      </div>
      <p style={{ ...leise, marginBottom: 0 }}>
        <strong>Fernseher oder Beamer mit eigenem Browser im WLAN:</strong>{' '}
        {wlan?.wlan ? (
          <>
            dort <code>{wlan.wlan}</code> öffnen{wlan.kurz ? ' – das Gerät dafür mit dem Fotobox-WLAN verbinden' : ''}.
          </>
        ) : (
          'geht, sobald oben „Galerie im WLAN“ an ist.'
        )}
      </p>

      <h2 style={{ marginTop: '1.4rem' }}>Gästebuch</h2>
      <p style={{ ...leise, marginTop: 0 }}>
        Nach dem Foto können Gäste mit dem Finger einen Gruß schreiben. Den bekommt nur der Gastgeber: als
        Gästebuch-PDF mit Foto und Gruß bei der Übergabe. In Galerie und Diashow erscheinen die Grüße nie.
      </p>
      <div className="zeile">
        <Schalter
          an={e.gaestebuchAktiv}
          name="Knopf „Ins Gästebuch schreiben“ nach dem Foto"
          beiWechsel={(an) => void beiAenderung({ gaestebuchAktiv: an })}
        />
        {gruesse !== null && gruesse > 0 && (
          <a className="knopf knopf--neben" href={`/api/admin/events/${eventId}/gaestebuch.pdf`} target="_blank" rel="noreferrer">
            Gästebuch ansehen ({gruesse} {gruesse === 1 ? 'Gruß' : 'Grüße'})
          </a>
        )}
      </div>
    </div>
  );
}
