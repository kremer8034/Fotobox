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
  materialVerbraucht: number;
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
    materialStart: number;
    startTitel: string;
    startUntertitel: string;
    farbeAkzent: string;
    einwilligungstext: string;
    emailLoeschfristTage: number;
    vorlagen: string[];
    filter: string[];
  };
  auslagen: {
    sitzungen: number;
    fotos: number;
    layouts: number;
    druckeGesamt: number;
    druckeNichtBerechnet: number;
    druckeFehlgeschlagen: number;
    betrag: number;
    materialRest: number;
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
  const [zettelPin, setzeZettelPin] = useState('');
  const [zettel, setzeZettel] = useState<{ kurzanleitung: string; aushang: string | null } | null>(null);
  const [zielPfad, setzeZielPfad] = useState('');
  const [telefon, setzeTelefon] = useState('');
  const [wlanName, setzeWlanName] = useState('');
  const [wlanPasswort, setzeWlanPasswort] = useState('');

  const lade = useCallback(async () => {
    setzeEvent(await api.hole<EventVoll>(`/api/admin/events/${id}`));
    setzeVorlagen(await api.hole('/api/admin/vorlagen'));
    setzeFilter(await api.hole('/api/admin/filter'));
  }, [id]);

  useEffect(() => {
    void lade();
  }, [lade]);

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
            <ZahlFeld
              name="Material Start (Blatt)"
              klein
              wert={e.materialStart}
              grenzen={[0, 100_000]}
              beiSpeichern={(n) => speichere({ materialStart: n })}
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
            <Kennzahl
              name="Material Rest"
              wert={String(event.auslagen.materialRest)}
              ton={event.auslagen.materialRest < 50 ? 'warnung' : 'gut'}
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
            <h2>Unterlagen für die Veranstaltung</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
              Zwei Zettel mit unterschiedlichen Lesern: Die Kurzanleitung mit der Betreuer-PIN kommt
              in die Box, der QR-Aushang wird außen angeklebt. Auf dem Aushang steht bewusst keine
              PIN.
            </p>
            <div className="zeile">
              <div className="feld feld--klein">
                <label>Betreuer-PIN (kommt auf den Zettel)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={zettelPin}
                  onChange={(ev) => setzeZettelPin(ev.target.value.replace(/\D/g, ''))}
                  placeholder="dieselbe wie gesetzt"
                />
              </div>
              <div className="feld feld--klein">
                <label>Telefon für den Notfall</label>
                <input value={telefon} onChange={(ev) => setzeTelefon(ev.target.value)} />
              </div>
              <div className="feld feld--klein">
                <label>WLAN-Name (für den QR-Code)</label>
                <input value={wlanName} onChange={(ev) => setzeWlanName(ev.target.value)} />
              </div>
              <div className="feld feld--klein">
                <label>WLAN-Passwort</label>
                <input value={wlanPasswort} onChange={(ev) => setzeWlanPasswort(ev.target.value)} />
              </div>
              <button
                className="knopf knopf--neben"
                disabled={!/^\d{4,8}$/.test(zettelPin)}
                onClick={() => void unterlagen()}
              >
                Zettel erzeugen
              </button>
            </div>
            {zettel && (
              <p style={{ marginBottom: 0 }}>
                <a href={zettel.kurzanleitung} target="_blank" rel="noreferrer">
                  Kurzanleitung öffnen
                </a>
                {zettel.aushang ? (
                  <>
                    {' · '}
                    <a href={zettel.aushang} target="_blank" rel="noreferrer">
                      QR-Aushang öffnen
                    </a>
                  </>
                ) : (
                  ' · Einen QR-Aushang gibt es nur bei eingeschalteter Galerie.'
                )}
              </p>
            )}
          </div>

          <div className="karte">
            <h2>Übergabe an den Gastgeber</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
              Kopiert den kompletten Event-Ordner samt Originalen, bearbeiteten Fotos, Layouts,
              Auslagen-CSV und einer eigenständigen <code>galerie.html</code>, die der Gastgeber per
              Doppelklick öffnen kann. Erst wenn eine Markerdatei drüben ankommt und die Dateizahl
              stimmt, gilt die Kopie als vollständig.
            </p>
            <div className="zeile">
              <div className="feld" style={{ flex: 1 }}>
                <label>Ziel (USB-Stick oder Ordner)</label>
                <input
                  value={zielPfad}
                  onChange={(ev) => setzeZielPfad(ev.target.value)}
                  placeholder="E:\ oder D:\Fotobox-Uebergabe"
                />
              </div>
              <button
                className="knopf knopf--neben"
                disabled={zielPfad.length < 2}
                onClick={() => void uebergeben()}
              >
                Jetzt übergeben
              </button>
              <button className="knopf knopf--neben" onClick={() => void vorbereiten()}>
                Nur Ordner vorbereiten
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
      const antwort = await api.sende<{ links: { kurzanleitung: string; aushang: string | null } }>(
        `/api/admin/events/${id}/unterlagen`,
        { betreuerPin: zettelPin, telefon, wlanName, wlanPasswort },
      );
      setzeZettel(antwort.links);
      zeige('Zettel erzeugt - zum Öffnen und Drucken die Links unten nutzen.');
    });
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

  function vorbereiten() {
    return versuche(async () => {
      const antwort = await api.sende<{ ordner: string }>(`/api/admin/events/${id}/uebergabe-vorbereiten`, {});
      zeige(`Ordner ist übergabefertig: ${antwort.ordner}`);
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
      zeige('Betreuer-PIN gesetzt. Für die Kurzanleitung unter „Übergabe“ noch einmal eintragen.');
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
