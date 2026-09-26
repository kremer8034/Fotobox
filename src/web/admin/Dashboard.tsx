import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { STOERUNGSTEXTE, type Stoerung } from '../../shared/typen.js';

interface Eintrag {
  zeit: string;
  ebene: 'warnung' | 'fehler';
  bereich: string;
  text: string;
}

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
  const [vorfaelle, setzeVorfaelle] = useState<Eintrag[]>([]);

  useEffect(() => {
    api.hole<Eintrag[]>('/api/admin/protokoll').then(setzeVorfaelle).catch(() => undefined);
  }, []);

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
            Störung gemeldet: {STOERUNGSTEXTE[status.stoerung as Stoerung]?.titel ?? status.stoerung}
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

      <div className="karte">
        <h2>Was zuletzt gehakt hat</h2>
        {vorfaelle.length === 0 ? (
          <p style={{ color: 'var(--schrift-leise)', marginBottom: 0 }}>
            Keine Warnungen und Fehler. Alles ist rund gelaufen.
          </p>
        ) : (
          <ul className="vorfaelle">
            {vorfaelle.map((v, i) => (
              <li key={i} className={`vorfaelle__eintrag vorfaelle__eintrag--${v.ebene}`}>
                <span className="vorfaelle__zeit">
                  {new Date(v.zeit).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="vorfaelle__bereich">{v.bereich}</span>
                {/* Nur die erste Zeile - darunter steht bei Abstuerzen der
                    technische Ablauf, der hier niemandem weiterhilft. */}
                <span>{v.text.split('\n')[0]}</span>
              </li>
            ))}
          </ul>
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
