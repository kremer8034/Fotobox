import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { VOM_KIOSK } from '../kiosk/Sperre.js';
import { Dashboard } from './Dashboard.js';
import { Veranstaltungen } from './Veranstaltungen.js';
import { EventDetail } from './EventDetail.js';
import { VorlagenSeite } from './Vorlagen.js';
import { GeraetSeite } from './Geraet.js';
import { FilterSeite } from './Filter.js';

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
  useRueckkehrZumKiosk(navigiere);

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
        <Verweis pfad={pfad} ziel="/admin/filter" name="Filter" navigiere={navigiere} />
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
        {pfad === '/admin/filter' && <FilterSeite />}
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

/** So lange darf die Verwaltung am Kiosk unberuehrt offen stehen. */
const LEERLAUF_AM_KIOSK_MS = 5 * 60_000;

/**
 * Aus dem Servicemenue geoeffnet, kehrt die Verwaltung nach fuenf Minuten
 * ohne Beruehrung und ohne Taste von selbst zum Kiosk zurueck.
 *
 * Das Servicemenue schliesst sich nach einer Minute, damit ein offen
 * gelassenes Besitzer-Menue keinen Gast in die Verwaltung fuehrt. Die
 * Verwaltung selbst blieb aber fuer immer offen: Wer dort hineinging und
 * dann abgelenkt wurde, liess jedem Gast Loeschen, PINs und Einstellungen
 * offen. Am Schreibtisch (eigener Browser, ohne Merker) gilt das nicht.
 */
function useRueckkehrZumKiosk(navigiere: (ziel: string) => void) {
  useEffect(() => {
    let vomKiosk = false;
    try {
      vomKiosk = sessionStorage.getItem(VOM_KIOSK) === '1';
    } catch {
      vomKiosk = false;
    }
    if (!vomKiosk) return;

    // Ein Zeitstempel statt eines Zustands: Jeder Tastendruck im Editor
    // wuerde sonst die ganze Verwaltung neu zeichnen.
    let zuletzt = Date.now();
    const merke = () => {
      zuletzt = Date.now();
    };
    const ereignisse = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const e of ereignisse) window.addEventListener(e, merke, { passive: true, capture: true });
    const uhr = setInterval(() => {
      if (Date.now() - zuletzt >= LEERLAUF_AM_KIOSK_MS) navigiere('/');
    }, 5000);
    return () => {
      for (const e of ereignisse) window.removeEventListener(e, merke, { capture: true });
      clearInterval(uhr);
    };
    // navigiere ruft nur pushState und einen stabilen Setter; ein neues Exemplar soll die Uhr nicht neu starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
