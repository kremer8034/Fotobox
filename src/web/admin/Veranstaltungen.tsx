import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface EventZeile {
  id: string;
  name: string;
  datum: string;
  status: string;
  probelauf: boolean;
  auslagen: { druckeGesamt: number; betrag: number; materialRest: number };
}

export function Veranstaltungen({ navigiere }: { navigiere: (ziel: string) => void }) {
  const [events, setzeEvents] = useState<EventZeile[]>([]);
  const [name, setzeName] = useState('');
  const [datum, setzeDatum] = useState(new Date().toISOString().slice(0, 10));
  const [fehler, setzeFehler] = useState<string | null>(null);

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
              value={name}
              onChange={(e) => setzeName(e.target.value)}
              placeholder="Hochzeit Müller"
            />
          </div>
          <div className="feld feld--klein">
            <label htmlFor="ev-datum">Datum</label>
            <input id="ev-datum" type="date" value={datum} onChange={(e) => setzeDatum(e.target.value)} />
          </div>
          <button className="knopf knopf--neben" onClick={() => void anlegen()} disabled={!name.trim()}>
            Anlegen
          </button>
        </div>
        {fehler && <p style={{ color: 'var(--fehler)' }}>{fehler}</p>}
      </div>

      <div className="karte">
        <table className="liste">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Name</th>
              <th>Status</th>
              <th>Drucke</th>
              <th>Betrag</th>
              <th>Material</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.datum}</td>
                <td>
                  {e.name}
                  {e.probelauf && <span className="marke" style={{ marginLeft: '0.4rem' }}>Probelauf</span>}
                </td>
                <td>
                  <span className={`marke marke--${e.status}`}>{e.status}</span>
                </td>
                <td>{e.auslagen.druckeGesamt}</td>
                <td>{e.auslagen.betrag.toFixed(2).replace('.', ',')} €</td>
                <td>{e.auslagen.materialRest}</td>
                <td>
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
      </div>
    </>
  );

  async function lade() {
    setzeEvents(await api.hole<EventZeile[]>('/api/admin/events'));
  }

  async function anlegen() {
    try {
      const neu = await api.sende<{ id: string }>('/api/admin/events', { name, datum });
      setzeName('');
      await lade();
      navigiere(`/admin/events/${neu.id}`);
    } catch (u) {
      setzeFehler(u instanceof Error ? u.message : 'Hat nicht geklappt.');
    }
  }
}
