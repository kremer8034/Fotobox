import { useCallback, useEffect, useState } from 'react';
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
  liveViewAbschaltung: 'Live-View-Abschaltung',
  sitzungAbbruch: 'Sitzungsabbruch bei Untätigkeit',
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
              <div className="feld" key={schluessel}>
                <label htmlFor={`zeit-${schluessel}`}>{ZEIT_BESCHRIFTUNG[schluessel]}</label>
                <input
                  id={`zeit-${schluessel}`}
                  className="zahl"
                  type="number"
                  min={0}
                  value={e.zeiten[schluessel]}
                  onChange={(ev) =>
                    void speichere({ zeiten: { ...e.zeiten, [schluessel]: Number(ev.target.value) } })
                  }
                />
              </div>
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
            <div className="feld feld--klein">
              <label>Kopien vorausgewählt</label>
              <input
                className="zahl"
                type="number"
                min={1}
                value={e.kopienVorgabe}
                onChange={(ev) => void speichere({ kopienVorgabe: Number(ev.target.value) })}
              />
            </div>
            <div className="feld feld--klein">
              <label>Kopien höchstens</label>
              <input
                className="zahl"
                type="number"
                min={1}
                value={e.kopienMax}
                onChange={(ev) => void speichere({ kopienMax: Number(ev.target.value) })}
              />
            </div>
            <div className="feld feld--klein">
              <label>Druck-Limit gesamt (0 = keins)</label>
              <input
                className="zahl"
                type="number"
                min={0}
                value={e.druckLimit}
                onChange={(ev) => void speichere({ druckLimit: Number(ev.target.value) })}
              />
            </div>
          </div>
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
              <input value={e.startTitel} onChange={(ev) => void speichere({ startTitel: ev.target.value })} />
            </div>
            <div className="feld" style={{ flex: 1 }}>
              <label>Untertitel</label>
              <input
                value={e.startUntertitel}
                onChange={(ev) => void speichere({ startUntertitel: ev.target.value })}
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
              <input value={pin} onChange={(ev) => setzePin(ev.target.value)} placeholder="4–8 Ziffern" />
            </div>
            <button className="knopf knopf--neben" disabled={pin.length < 4} onClick={() => void setzePinAb()}>
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
            <div className="feld feld--klein">
              <label>Ersatz je Druck (€)</label>
              <input
                className="zahl"
                type="number"
                step="0.01"
                min={0}
                value={e.ersatzJeDruck}
                onChange={(ev) => void speichere({ ersatzJeDruck: Number(ev.target.value) })}
              />
            </div>
            <div className="feld feld--klein">
              <label>Material Start (Blatt)</label>
              <input
                className="zahl"
                type="number"
                min={0}
                value={e.materialStart}
                onChange={(ev) => void speichere({ materialStart: Number(ev.target.value) })}
              />
            </div>
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
              <button className="knopf knopf--neben" onClick={() => void unterlagen()}>
                Zettel erzeugen
              </button>
            </div>
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

  async function speichere(teil: Record<string, unknown>) {
    setzeEvent((alt) =>
      alt ? { ...alt, einstellungen: { ...alt.einstellungen, ...teil } as typeof alt.einstellungen } : alt,
    );
    await api.aendere(`/api/admin/events/${id}`, { einstellungen: teil });
    zeige('Gespeichert.');
  }

  function zeige(text: string) {
    setzeMeldung(text);
    setTimeout(() => setzeMeldung(null), 2500);
  }

  async function status(neu: EventStatus) {
    try {
      await api.sende(`/api/admin/events/${id}/status`, { status: neu });
      await lade();
      zeige(`Steht jetzt auf „${STATUS_NAME[neu]}“.`);
    } catch (u) {
      zeige(u instanceof Error ? u.message : 'Wechsel nicht möglich.');
    }
  }

  async function probelauf(an: boolean) {
    await api.sende(`/api/admin/events/${id}/probelauf`, { an });
    await lade();
  }

  async function pruefe() {
    setzePruefung(await api.hole(`/api/admin/events/${id}/startbereit`));
  }

  async function neuerToken() {
    await api.sende(`/api/admin/events/${id}/galerie-token`, {});
    await lade();
    zeige('Der alte Link ist jetzt tot.');
  }

  async function unterlagen() {
    const antwort = await api.sende<{ kurzanleitung: string; aushang: string | null }>(
      `/api/admin/events/${id}/unterlagen`,
      { betreuerPin: pin || '(im Admin gesetzt)', telefon, wlanName, wlanPasswort },
    );
    zeige(
      `Kurzanleitung: ${antwort.kurzanleitung}` +
        (antwort.aushang ? ` · Aushang: ${antwort.aushang}` : ' · Aushang nur bei aktiver Galerie'),
    );
  }

  async function uebergeben() {
    setzeMeldung('Kopiere…');
    try {
      const ergebnis = await api.sende<{ meldung: string; geprueft: boolean; ziel: string }>(
        `/api/admin/events/${id}/uebergabe`,
        { ziel: zielPfad },
      );
      zeige(`${ergebnis.meldung} Ziel: ${ergebnis.ziel}`);
    } catch (u) {
      zeige(u instanceof Error ? u.message : 'Übergabe fehlgeschlagen.');
    }
  }

  async function vorbereiten() {
    const antwort = await api.sende<{ ordner: string }>(
      `/api/admin/events/${id}/uebergabe-vorbereiten`,
      {},
    );
    zeige(`Ordner ist übergabefertig: ${antwort.ordner}`);
  }

  async function setzePinAb() {
    await api.aendere(`/api/admin/events/${id}`, { betreuerPin: pin });
    setzePin('');
    await lade();
    zeige('Betreuer-PIN gesetzt.');
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
