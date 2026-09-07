import { useCallback, useEffect, useState } from 'react';
import { api, type Zeiten } from '../api.js';

interface EventVoll {
  id: string;
  name: string;
  datum: string;
  status: string;
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
  bestaetigung: 'Bestätigungsanzeige des Fotos (0 = überspringen)',
  rueckkehrStart: 'Rückkehr zum Startbildschirm',
  galerieLeerlauf: 'Leerlauf in der Galerie',
  liveViewAbschaltung: 'Live-View-Abschaltung bei Leerlauf',
  sitzungAbbruch: 'Sitzungsabbruch bei Untätigkeit',
};

export function EventDetail({ id, navigiere }: { id: string; navigiere: (ziel: string) => void }) {
  const [event, setzeEvent] = useState<EventVoll | null>(null);
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

  return (
    <>
      <div className="zeile" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0 }}>
          {event.name} <span className={`marke marke--${event.status}`}>{event.status}</span>
        </h1>
        <button className="knopf knopf--neben" onClick={() => navigiere('/admin/events')}>
          Zurück zur Liste
        </button>
      </div>
      {meldung && <p style={{ color: 'var(--akzent)' }}>{meldung}</p>}

      <div className="karte">
        <h2>Lebenszyklus</h2>
        <div className="zeile">
          {(['startbereit', 'aktiv', 'pausiert', 'abgeschlossen', 'archiviert'] as const).map((s) => (
            <button key={s} className="knopf knopf--neben" onClick={() => void status(s)}>
              {s}
            </button>
          ))}
          <button
            className="knopf knopf--neben"
            onClick={() => void probelauf(!event.probelauf)}
            style={event.probelauf ? { borderColor: 'var(--akzent)' } : undefined}
          >
            Probelauf {event.probelauf ? 'aus' : 'ein'}
          </button>
        </div>
        <p style={{ color: 'var(--schrift-leise)', fontSize: '0.78rem', marginBottom: 0 }}>
          Es kann immer nur genau eine Veranstaltung aktiv sein. Im Probelauf zählen Sitzungen weder
          in den Auslagenersatz noch in die Galerie.
        </p>
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
                <div>
                  <div>{p.titel}</div>
                  <div className="pruef__hinweis">{p.hinweis}</div>
                </div>
              </div>
            ))}
            <p style={{ marginBottom: 0, color: pruefung.bestanden ? 'var(--gut)' : 'var(--fehler)' }}>
              {pruefung.bestanden ? 'Alles bereit.' : 'Es fehlt noch etwas.'}
            </p>
          </div>
        )}
      </div>

      <div className="karte">
        <h2>Ablauf, Zeiten und Töne</h2>
        <p style={{ color: 'var(--schrift-leise)', fontSize: '0.78rem', marginTop: 0 }}>
          Vorlagen- und Filterauswahl haben bewusst kein Zeitlimit. Die Rettungsleine gegen
          hängengebliebene Sitzungen ist der Abbruch bei Untätigkeit.
        </p>
        <div className="zeile">
          {(Object.keys(ZEIT_BESCHRIFTUNG) as (keyof Zeiten)[]).map((schluessel) => (
            <div className="feld feld--klein" key={schluessel}>
              <label>{ZEIT_BESCHRIFTUNG[schluessel]} (s)</label>
              <input
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

      <div className="karte">
        <h2>Vorlagen und Filter</h2>
        <p style={{ color: 'var(--schrift-leise)', fontSize: '0.78rem', marginTop: 0 }}>
          Die Vorlage bestimmt, wie viele Fotos aufgenommen werden. „Ohne Filter“ ist immer die
          erste Kachel und immer vorausgewählt.
        </p>
        <div className="zeile" style={{ alignItems: 'flex-start' }}>
          <div>
            <strong style={{ fontSize: '0.85rem' }}>Freigegebene Vorlagen</strong>
            {vorlagen.map((v) => (
              <label key={v.id} style={{ display: 'block', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                <input
                  type="checkbox"
                  checked={e.vorlagen.includes(v.id)}
                  onChange={(ev) => void speichere({ vorlagen: umschalten(e.vorlagen, v.id, ev.target.checked) })}
                />{' '}
                {v.name} ({v.fotos} Fotos)
              </label>
            ))}
          </div>
          <div>
            <strong style={{ fontSize: '0.85rem' }}>Freigegebene Filter</strong>
            {filter.map((f) => (
              <label key={f.id} style={{ display: 'block', fontSize: '0.85rem', padding: '0.2rem 0' }}>
                <input
                  type="checkbox"
                  checked={e.filter.includes(f.id)}
                  disabled={f.id === 'ohne'}
                  onChange={(ev) => void speichere({ filter: umschalten(e.filter, f.id, ev.target.checked) })}
                />{' '}
                {f.name}
                {f.id === 'ohne' && ' (immer dabei)'}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="karte">
        <h2>Ausgabe</h2>
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
              type="number"
              min={1}
              value={e.kopienVorgabe}
              onChange={(ev) => void speichere({ kopienVorgabe: Number(ev.target.value) })}
            />
          </div>
          <div className="feld feld--klein">
            <label>Kopien höchstens</label>
            <input
              type="number"
              min={1}
              value={e.kopienMax}
              onChange={(ev) => void speichere({ kopienMax: Number(ev.target.value) })}
            />
          </div>
          <div className="feld feld--klein">
            <label>Druck-Limit gesamt (0 = keins)</label>
            <input
              type="number"
              min={0}
              value={e.druckLimit}
              onChange={(ev) => void speichere({ druckLimit: Number(ev.target.value) })}
            />
          </div>
        </div>
        {e.galerieAktiv && (
          <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)', marginBottom: 0 }}>
            Galerie-Link: <code>/g/{event.galerieToken}</code> — Statusseite: <code>/s/{event.statusToken}</code>
            <button
              className="knopf knopf--neben"
              style={{ marginLeft: '0.6rem' }}
              onClick={() => void neuerToken()}
            >
              Galerie-Link erneuern
            </button>
          </p>
        )}
      </div>

      <div className="karte">
        <h2>Auslagenersatz</h2>
        <div className="zeile">
          <div className="feld feld--klein">
            <label>Ersatz je Druck (€)</label>
            <input
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
              type="number"
              min={0}
              value={e.materialStart}
              onChange={(ev) => void speichere({ materialStart: Number(ev.target.value) })}
            />
          </div>
        </div>
        <div className="zeile">
          <Kennzahl name="Durchgänge" wert={String(event.auslagen.sitzungen)} />
          <Kennzahl name="Fotos" wert={String(event.auslagen.fotos)} />
          <Kennzahl name="Drucke berechnet" wert={String(event.auslagen.druckeGesamt)} />
          <Kennzahl name="nicht berechnet" wert={String(event.auslagen.druckeNichtBerechnet)} />
          <Kennzahl name="fehlgeschlagen" wert={String(event.auslagen.druckeFehlgeschlagen)} />
          <Kennzahl
            name="Betrag"
            wert={`${event.auslagen.betrag.toFixed(2).replace('.', ',')} €`}
          />
          <Kennzahl name="Material Rest" wert={String(event.auslagen.materialRest)} />
        </div>
        <a className="knopf knopf--neben" href={`/api/admin/events/${id}/auslagen.csv`}>
          CSV herunterladen
        </a>
      </div>

      <div className="karte">
        <h2>Unterlagen für die Veranstaltung</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
          Zwei Zettel mit unterschiedlichen Lesern: Die Kurzanleitung mit der Betreuer-PIN kommt in
          die Box, der QR-Aushang wird außen angeklebt. Auf dem Aushang steht bewusst keine PIN.
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
              placeholder="E:\\ oder D:\\Fotobox-Uebergabe"
            />
          </div>
          <button className="knopf knopf--neben" disabled={zielPfad.length < 2} onClick={() => void uebergeben()}>
            Jetzt übergeben
          </button>
          <button className="knopf knopf--neben" onClick={() => void vorbereiten()}>
            Nur Ordner vorbereiten
          </button>
        </div>
      </div>

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
        </div>
        <div className="zeile">
          <div className="feld feld--klein">
            <label>Betreuer-PIN {event.betreuerPinGesetzt ? '(gesetzt)' : '(fehlt)'}</label>
            <input value={pin} onChange={(ev) => setzePin(ev.target.value)} placeholder="4-8 Ziffern" />
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
    </>
  );

  async function speichere(teil: Record<string, unknown>) {
    setzeEvent((alt) =>
      alt ? { ...alt, einstellungen: { ...alt.einstellungen, ...teil } as typeof alt.einstellungen } : alt,
    );
    await api.aendere(`/api/admin/events/${id}`, { einstellungen: teil });
    setzeMeldung('Gespeichert.');
    setTimeout(() => setzeMeldung(null), 1500);
  }

  async function status(neu: string) {
    try {
      await api.sende(`/api/admin/events/${id}/status`, { status: neu });
      await lade();
    } catch (u) {
      setzeMeldung(u instanceof Error ? u.message : 'Wechsel nicht möglich.');
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
    setzeMeldung('Der alte Link ist jetzt tot.');
  }

  async function unterlagen() {
    const antwort = await api.sende<{ kurzanleitung: string; aushang: string | null }>(
      `/api/admin/events/${id}/unterlagen`,
      { betreuerPin: pin || '(im Admin gesetzt)', telefon, wlanName, wlanPasswort },
    );
    setzeMeldung(
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
      setzeMeldung(`${ergebnis.meldung} Ziel: ${ergebnis.ziel}`);
    } catch (u) {
      setzeMeldung(u instanceof Error ? u.message : 'Übergabe fehlgeschlagen.');
    }
  }

  async function vorbereiten() {
    const antwort = await api.sende<{ ordner: string }>(
      `/api/admin/events/${id}/uebergabe-vorbereiten`,
      {},
    );
    setzeMeldung(`Ordner ist übergabefertig: ${antwort.ordner}`);
  }

  async function setzePinAb() {
    await api.aendere(`/api/admin/events/${id}`, { betreuerPin: pin });
    setzePin('');
    await lade();
    setzeMeldung('Betreuer-PIN gesetzt.');
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
    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
      <input type="checkbox" checked={an} onChange={(e) => beiWechsel(e.target.checked)} />
      {name}
    </label>
  );
}

function Kennzahl({ name, wert }: { name: string; wert: string }) {
  return (
    <div className="kennzahl">
      <span className="kennzahl__wert">{wert}</span>
      <span className="kennzahl__name">{name}</span>
    </div>
  );
}
