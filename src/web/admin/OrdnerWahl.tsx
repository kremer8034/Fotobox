import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Laufwerk {
  pfad: string;
  name: string;
  wechsel: boolean;
  freiGb: number | null;
}

interface Ordnerliste {
  pfad: string;
  oben: string | null;
  ordner: { name: string; pfad: string }[];
}

/**
 * Ordner auswaehlen statt tippen - fuer die Uebergabe an den Gastgeber.
 * Erst die Laufwerke (USB-Sticks oben), dann Ordner fuer Ordner tiefer.
 * Ein eigenes Fenster in der Seite statt des Windows-Dialogs: Der ginge im
 * Vollbild-Kiosk hinter dem Browser auf und ist mit dem Finger kaum zu treffen.
 */
export function OrdnerWahl({
  start,
  beiWahl,
  beiAbbruch,
}: {
  start: string;
  beiWahl: (pfad: string) => void;
  beiAbbruch: () => void;
}) {
  const [pfad, setzePfad] = useState<string>(start);
  const [laufwerke, setzeLaufwerke] = useState<Laufwerk[] | null>(null);
  const [liste, setzeListe] = useState<Ordnerliste | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [neuerName, setzeNeuerName] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    setzeFehler(null);
    if (!pfad) {
      setzeListe(null);
      api
        .hole<{ laufwerke: Laufwerk[] }>('/api/admin/ordner')
        .then((a) => aktiv && setzeLaufwerke(a.laufwerke))
        .catch((f: Error) => aktiv && setzeFehler(f.message));
    } else {
      api
        .hole<Ordnerliste>(`/api/admin/ordner?pfad=${encodeURIComponent(pfad)}`)
        .then((l) => aktiv && setzeListe(l))
        .catch((f: Error) => {
          if (!aktiv) return;
          setzeFehler(f.message);
          // Ein eingetragener Pfad, den es nicht mehr gibt: zurueck zu den Laufwerken.
          setzePfad('');
        });
    }
    return () => {
      aktiv = false;
    };
  }, [pfad]);

  async function anlegen() {
    if (!neuerName || !liste) return;
    try {
      const { pfad: neu } = await api.sende<{ pfad: string }>('/api/admin/ordner', { pfad: liste.pfad, name: neuerName });
      setzeNeuerName(null);
      setzePfad(neu);
    } catch (f) {
      setzeFehler((f as Error).message);
    }
  }

  return (
    <div className="ordnerwahl" role="dialog" aria-modal="true" aria-label="Ordner wählen">
      <div className="ordnerwahl__fenster">
        <h2 style={{ marginTop: 0 }}>Ziel für die Übergabe wählen</h2>
        <div className="ordnerwahl__pfad">
          <button className="knopf knopf--neben" onClick={() => setzePfad('')} disabled={!pfad}>
            Laufwerke
          </button>
          {liste?.oben && (
            <button className="knopf knopf--neben" onClick={() => setzePfad(liste.oben!)}>
              ↑ Eine Ebene höher
            </button>
          )}
          <code>{liste?.pfad ?? 'Laufwerk wählen'}</code>
        </div>

        {fehler && <p style={{ color: 'var(--warnung)' }}>{fehler}</p>}

        <ul className="ordnerwahl__liste">
          {!pfad &&
            laufwerke?.map((l) => (
              <li key={l.pfad}>
                <button onClick={() => setzePfad(l.pfad)}>
                  <span aria-hidden>{l.wechsel ? '💾' : '💽'}</span>
                  <span>{l.name}</span>
                  {l.freiGb !== null && <span className="ordnerwahl__frei">{l.freiGb} GB frei</span>}
                </button>
              </li>
            ))}
          {!pfad && laufwerke?.length === 0 && <li className="ordnerwahl__leer">Keine Laufwerke gefunden.</li>}
          {pfad &&
            liste?.ordner.map((o) => (
              <li key={o.pfad}>
                <button onClick={() => setzePfad(o.pfad)}>
                  <span aria-hidden>📁</span>
                  <span>{o.name}</span>
                </button>
              </li>
            ))}
          {pfad && liste?.ordner.length === 0 && (
            <li className="ordnerwahl__leer">Keine Unterordner – dieser Ordner lässt sich direkt wählen.</li>
          )}
        </ul>

        {pfad && liste && neuerName !== null && (
          <div className="zeile">
            <div className="feld" style={{ flex: 1 }}>
              <label>Name des neuen Ordners</label>
              <input autoFocus value={neuerName} maxLength={80} onChange={(e) => setzeNeuerName(e.target.value)} />
            </div>
            <button className="knopf knopf--neben" disabled={!neuerName.trim()} onClick={() => void anlegen()}>
              Anlegen
            </button>
            <button className="knopf knopf--neben" onClick={() => setzeNeuerName(null)}>
              Doch nicht
            </button>
          </div>
        )}

        <div className="zeile ordnerwahl__fuss">
          <button className="knopf knopf--neben" onClick={beiAbbruch}>
            Abbrechen
          </button>
          {pfad && liste && neuerName === null && (
            <button className="knopf knopf--neben" onClick={() => setzeNeuerName('Fotobox')}>
              Neuer Ordner …
            </button>
          )}
          <button className="knopf" disabled={!liste} onClick={() => liste && beiWahl(liste.pfad)}>
            Diesen Ordner wählen
          </button>
        </div>
      </div>
    </div>
  );
}
