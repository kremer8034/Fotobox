import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Dashboard } from './Dashboard.js';
import { Veranstaltungen } from './Veranstaltungen.js';
import { EventDetail } from './EventDetail.js';
import { VorlagenSeite } from './Vorlagen.js';
import { GeraetSeite } from './Geraet.js';

/**
 * Verwaltung.
 *
 * Erreichbar ausschliesslich auf der Box selbst (127.0.0.1). Vom Handy gibt es
 * nur die schreibgeschuetzte Statusseite.
 *
 * Gestaltungsregel: sofort speichern statt Speichern-Knopf, jede Einstellung
 * hat einen brauchbaren Standard, und der Admin ist auf Maus und Tastatur
 * ausgelegt - die Vorbereitung passiert am Schreibtisch.
 */
export function Admin({ pfad, navigiere }: { pfad: string; navigiere: (ziel: string) => void }) {
  const [status, setzeStatus] = useState<{ aktivesEvent: { name: string } | null } | null>(null);

  useEffect(() => {
    const laden = () =>
      api.hole<typeof status>('/api/admin/status').then(setzeStatus).catch(() => undefined);
    void laden();
    const uhr = setInterval(laden, 5000);
    return () => clearInterval(uhr);
  }, []);

  const eventTreffer = /^\/admin\/events\/([^/]+)$/.exec(pfad);

  return (
    <div className="admin-huelle">
      <nav className="admin-nav">
        <div style={{ padding: '0 0.7rem 0.8rem', fontWeight: 700 }}>Fotobox</div>
        <Verweis pfad={pfad} ziel="/admin" name="Übersicht" navigiere={navigiere} />
        <Verweis pfad={pfad} ziel="/admin/events" name="Veranstaltungen" navigiere={navigiere} />
        <Verweis pfad={pfad} ziel="/admin/vorlagen" name="Vorlagen" navigiere={navigiere} />
        <Verweis pfad={pfad} ziel="/admin/geraet" name="Gerät" navigiere={navigiere} />
        <div style={{ flex: 1 }} />
        <button className="knopf knopf--neben" onClick={() => navigiere('/')}>
          Zum Kiosk
        </button>
        <div style={{ padding: '0.6rem 0.7rem', fontSize: '0.72rem', color: 'var(--schrift-leise)' }}>
          {status?.aktivesEvent ? `Aktiv: ${status.aktivesEvent.name}` : 'Keine Veranstaltung aktiv'}
        </div>
      </nav>

      <main className="admin-inhalt">
        {pfad === '/admin' && <Dashboard navigiere={navigiere} />}
        {pfad === '/admin/events' && <Veranstaltungen navigiere={navigiere} />}
        {eventTreffer && <EventDetail id={eventTreffer[1]!} navigiere={navigiere} />}
        {pfad === '/admin/vorlagen' && <VorlagenSeite />}
        {pfad === '/admin/geraet' && <GeraetSeite />}
      </main>
    </div>
  );
}

function Verweis({
  pfad,
  ziel,
  name,
  navigiere,
}: {
  pfad: string;
  ziel: string;
  name: string;
  navigiere: (ziel: string) => void;
}) {
  return (
    <a
      href={ziel}
      className={pfad === ziel ? 'aktiv' : ''}
      onClick={(e) => {
        e.preventDefault();
        navigiere(ziel);
      }}
    >
      {name}
    </a>
  );
}
