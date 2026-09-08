import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Status {
  kamera: string;
  drucker: string;
  stoerung: string | null;
  warteschlangeOffen: number;
  materialRest: number;
  speicherFreiGb: number;
  aktivesEvent: { id: string; name: string; probelauf: boolean } | null;
}

export function Dashboard({ navigiere }: { navigiere: (ziel: string) => void }) {
  const [status, setzeStatus] = useState<Status | null>(null);

  useEffect(() => {
    const laden = () => api.hole<Status>('/api/admin/status').then(setzeStatus).catch(() => undefined);
    void laden();
    const uhr = setInterval(laden, 4000);
    return () => clearInterval(uhr);
  }, []);

  if (!status) return <p>Einen Moment…</p>;

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Übersicht</h1>

      <div className="karte">
        <h2>Zustand</h2>
        {/*
          Der Zustand als Farbe, nicht nur als Wort. Eine Uebersicht, deren
          Zahlen man erst lesen muss, um zu merken, dass der Drucker steht,
          ist keine Uebersicht.
        */}
        <div className="zeile">
          <Kennzahl
            name="Kamera"
            wert={status.kamera === 'bereit' ? 'bereit' : 'gestört'}
            ton={status.kamera === 'bereit' ? 'gut' : 'fehler'}
          />
          <Kennzahl
            name="Drucker"
            wert={status.drucker === 'bereit' ? 'bereit' : 'gestört'}
            ton={status.drucker === 'bereit' ? 'gut' : 'fehler'}
          />
          <Kennzahl
            name="Wartend im Druck"
            wert={String(status.warteschlangeOffen)}
            ton={status.warteschlangeOffen > 5 ? 'warnung' : undefined}
          />
          <Kennzahl
            name="Material (Blatt)"
            wert={String(status.materialRest)}
            ton={status.materialRest < 50 ? 'warnung' : 'gut'}
          />
          <Kennzahl
            name="Speicher frei"
            wert={`${status.speicherFreiGb} GB`}
            ton={status.speicherFreiGb < 10 ? 'warnung' : 'gut'}
          />
        </div>
        {status.stoerung && (
          <p style={{ color: 'var(--warnung)', marginBottom: 0 }}>
            Störung gemeldet: {status.stoerung}
          </p>
        )}
      </div>

      <div className="karte">
        <h2>Aktive Veranstaltung</h2>
        {status.aktivesEvent ? (
          <div className="zeile">
            <div>
              <strong>{status.aktivesEvent.name}</strong>
              {status.aktivesEvent.probelauf && (
                <span className="marke" style={{ marginLeft: '0.5rem' }}>
                  Probelauf
                </span>
              )}
            </div>
            <button
              className="knopf knopf--neben"
              onClick={() => navigiere(`/admin/events/${status.aktivesEvent!.id}`)}
            >
              Öffnen
            </button>
          </div>
        ) : (
          <p style={{ color: 'var(--schrift-leise)' }}>
            Es läuft gerade keine Veranstaltung. Der Kiosk zeigt einen freundlichen Hinweis.
          </p>
        )}
      </div>
    </>
  );
}

function Kennzahl({
  name,
  wert,
  ton,
}: {
  name: string;
  wert: string;
  ton?: 'gut' | 'warnung' | 'fehler';
}) {
  return (
    <div className={`kennzahl${ton ? ` kennzahl--${ton}` : ''}`}>
      <span className="kennzahl__wert">{wert}</span>
      <span className="kennzahl__name">{name}</span>
    </div>
  );
}
