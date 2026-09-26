import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { STATUS_NAME, type EventStatus } from '../../shared/typen.js';

interface EventZeile {
  id: string;
  name: string;
  datum: string;
  status: EventStatus;
  probelauf: boolean;
  auslagen: { druckeGesamt: number; betrag: number; materialRest: number };
}

export function Veranstaltungen({ navigiere }: { navigiere: (ziel: string) => void }) {
  const [events, setzeEvents] = useState<EventZeile[]>([]);
  const [name, setzeName] = useState('');
  const [datum, setzeDatum] = useState(new Date().toISOString().slice(0, 10));
  const [fehler, setzeFehler] = useState<string | null>(null);
  // Woher die Einstellungen der neuen Veranstaltung kommen: "" = Vorgaben,
  // "v:<id>" = Voreinstellung, "e:<id>" = wie eine bisherige Veranstaltung.
  const [quelle, setzeQuelle] = useState('');
  const [voreinstellungen, setzeVoreinstellungen] = useState<{ id: string; name: string }[]>([]);
  const nameFeld = useRef<HTMLInputElement>(null);
  // Archivierte verschwinden aus der Hauptliste, bleiben aber auffindbar -
  // so stand es im Plan; vorher wuchs die Liste mit jeder Feier weiter.
  const [archivZeigen, setzeArchivZeigen] = useState(false);
  const archiviert = events.filter((e) => e.status === 'archiviert').length;
  const sichtbar = archivZeigen ? events : events.filter((e) => e.status !== 'archiviert');

  useEffect(() => {
    void lade();
  }, []);

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Veranstaltungen</h1>

      <div className="karte">
        <h2>Neue Veranstaltung</h2>
        <div className="zeile">
          <div className="feld" style={{ flex: 1 }}>
            <label htmlFor="ev-name">Name</label>
            <input
              id="ev-name"
              ref={nameFeld}
              value={name}
              onChange={(e) => setzeName(e.target.value)}
              placeholder="Hochzeit Müller"
            />
          </div>
          <div className="feld feld--klein">
            <label htmlFor="ev-datum">Datum</label>
            <input id="ev-datum" type="date" value={datum} onChange={(e) => setzeDatum(e.target.value)} />
          </div>
          <div className="feld" style={{ flex: 1 }}>
            <label htmlFor="ev-quelle">Einstellungen</label>
            <select id="ev-quelle" value={quelle} onChange={(e) => setzeQuelle(e.target.value)}>
              <option value="">Vorgaben</option>
              {voreinstellungen.length > 0 && (
                <optgroup label="Voreinstellung">
                  {voreinstellungen.map((v) => (
                    <option key={v.id} value={`v:${v.id}`}>
                      {v.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {events.length > 0 && (
                <optgroup label="Wie eine bisherige Veranstaltung">
                  {events.map((e) => (
                    <option key={e.id} value={`e:${e.id}`}>
                      {e.name} ({datumDeutsch(e.datum)})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <button className="knopf knopf--neben" onClick={() => void anlegen()} disabled={!name.trim()}>
            Anlegen
          </button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)', marginBottom: 0 }}>
          Übernommen werden nur Einstellungen – Vorlagen, Filter, Zeiten, Texte, Kopien und Limits. Keine
          Fotos, keine Zahlen, keine Galerie-Links und keine Betreuer-PIN.
        </p>
        {fehler && <p style={{ color: 'var(--fehler)' }}>{fehler}</p>}
        {voreinstellungen.length > 0 && (
          <div style={{ marginTop: '0.8rem', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--schrift-leise)' }}>Gespeicherte Voreinstellungen: </span>
            {voreinstellungen.map((v) => (
              <span key={v.id} className="marke" style={{ marginRight: '0.4rem' }}>
                {v.name}{' '}
                <button
                  className="knopf-text"
                  aria-label={`Voreinstellung ${v.name} löschen`}
                  onClick={() => void loescheVoreinstellung(v)}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="karte">
        <table className="liste">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Name</th>
              <th>Status</th>
              <th className="zahl">Drucke</th>
              <th className="zahl">Betrag</th>
              <th className="zahl">Material</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sichtbar.map((e) => (
              <tr key={e.id}>
                <td>{datumDeutsch(e.datum)}</td>
                <td>
                  {e.name}
                  {e.probelauf && <span className="marke" style={{ marginLeft: '0.4rem' }}>Probelauf</span>}
                </td>
                <td>
                  <span className={`marke marke--${e.status}`}>{STATUS_NAME[e.status]}</span>
                </td>
                <td className="zahl">{e.auslagen.druckeGesamt}</td>
                <td className="zahl">{e.auslagen.betrag.toFixed(2).replace('.', ',')} €</td>
                <td className="zahl">{e.auslagen.materialRest}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="knopf knopf--neben" onClick={() => dupliziere(e)}>
                    Duplizieren
                  </button>{' '}
                  <button className="knopf knopf--neben" onClick={() => navigiere(`/admin/events/${e.id}`)}>
                    Öffnen
                  </button>
                </td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--schrift-leise)' }}>
                  Noch keine Veranstaltung angelegt.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {archiviert > 0 && (
          <button
            className="knopf knopf--neben"
            style={{ marginTop: '0.6rem' }}
            onClick={() => setzeArchivZeigen(!archivZeigen)}
          >
            {archivZeigen ? 'Archivierte ausblenden' : `Archivierte zeigen (${archiviert})`}
          </button>
        )}
      </div>
    </>
  );

  async function lade() {
    try {
      const [liste, vorein] = await Promise.all([
        api.hole<EventZeile[]>('/api/admin/events'),
        api.hole<{ id: string; name: string }[]>('/api/admin/voreinstellungen'),
      ]);
      setzeEvents(liste);
      setzeVoreinstellungen(vorein);
    } catch (u) {
      setzeFehler(u instanceof Error ? u.message : 'Die Liste ließ sich nicht laden.');
    }
  }

  /** Duplizieren: das Formular oben mit dieser Veranstaltung als Vorlage fuellen. */
  function dupliziere(e: EventZeile) {
    setzeQuelle(`e:${e.id}`);
    setzeName(e.name);
    setzeFehler(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    nameFeld.current?.focus();
    nameFeld.current?.select();
  }

  async function loescheVoreinstellung(v: { id: string; name: string }) {
    if (!window.confirm(`Voreinstellung „${v.name}“ löschen? Veranstaltungen, die daraus angelegt wurden, bleiben unverändert.`)) {
      return;
    }
    try {
      await api.loesche(`/api/admin/voreinstellungen/${v.id}`);
      await lade();
    } catch (u) {
      setzeFehler(u instanceof Error ? u.message : 'Hat nicht geklappt.');
    }
  }

  async function anlegen() {
    try {
      const neu = await api.sende<{ id: string }>('/api/admin/events', {
        name,
        datum,
        ...(quelle.startsWith('v:') ? { voreinstellungId: quelle.slice(2) } : {}),
        ...(quelle.startsWith('e:') ? { wieEventId: quelle.slice(2) } : {}),
      });
      setzeName('');
      setzeQuelle('');
      await lade();
      navigiere(`/admin/events/${neu.id}`);
    } catch (u) {
      setzeFehler(u instanceof Error ? u.message : 'Hat nicht geklappt.');
    }
  }
}

/** 2026-10-03 ist ein Datenbankwert. Auf dem Schirm steht 03.10.2026. */
function datumDeutsch(iso: string): string {
  const teile = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return teile ? `${teile[3]}.${teile[2]}.${teile[1]}` : iso;
}
