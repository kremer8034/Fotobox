import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface GalerieDaten {
  veranstaltung: string;
  datum: string;
  bilder: { id: string; erstellt: string }[];
}

interface StatusDaten {
  veranstaltung: string;
  zustand: {
    kamera: string;
    drucker: string;
    stoerung: string | null;
    warteschlangeOffen: number;
    speicherFreiGb: number;
  };
  zahlen: { sitzungen: number; drucke: number; materialRest: number };
}

/**
 * Handy-Ansicht im WLAN.
 *
 * Zwei Betriebsarten unter demselben Bauteil:
 *  - /g/<token>: die Galerie fuer die Gaeste, mit Download aufs Handy.
 *  - /s/<token>: die schreibgeschuetzte Statusseite fuer den Gastgeber. Nur
 *    lesen, keine Aktionen - damit er die Box im Blick hat, ohne etwas
 *    verstellen zu koennen.
 */
export function HandyGalerie({ token, nurStatus }: { token: string; nurStatus?: boolean }) {
  const [galerie, setzeGalerie] = useState<GalerieDaten | null>(null);
  const [status, setzeStatus] = useState<StatusDaten | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [gross, setzeGross] = useState<string | null>(null);

  useEffect(() => {
    if (nurStatus) {
      const laden = () =>
        api
          .hole<StatusDaten>(`/api/status/${token}`)
          .then(setzeStatus)
          .catch((u: Error) => setzeFehler(u.message));
      void laden();
      const uhr = setInterval(laden, 10_000);
      return () => clearInterval(uhr);
    }
    void api
      .hole<GalerieDaten>(`/api/galerie/${token}`)
      .then(setzeGalerie)
      .catch((u: Error) => setzeFehler(u.message));
    return undefined;
  }, [token, nurStatus]);

  if (fehler) {
    return (
      <div className="handy">
        <h1>Nicht verfügbar</h1>
        <p style={{ color: 'var(--schrift-leise)' }}>
          Dieser Link gilt nicht mehr. Frag bitte kurz beim Gastgeber nach.
        </p>
      </div>
    );
  }

  if (nurStatus) {
    if (!status) return <div className="handy">Einen Moment…</div>;
    return (
      <div className="handy">
        <h1 style={{ marginBottom: '0.2rem' }}>{status.veranstaltung}</h1>
        <p style={{ color: 'var(--schrift-leise)', marginTop: 0 }}>Status der Fotobox</p>
        <div className="karte" style={{ lineHeight: 2 }}>
          <div>Kamera: {status.zustand.kamera === 'bereit' ? 'in Ordnung' : 'meldet sich nicht'}</div>
          <div>Drucker: {status.zustand.drucker === 'bereit' ? 'in Ordnung' : 'meldet einen Fehler'}</div>
          <div>{status.zustand.warteschlangeOffen} Foto(s) warten auf den Druck</div>
          <div>Noch {status.zahlen.materialRest} Blatt Papier</div>
          <div>{status.zustand.speicherFreiGb} GB Speicher frei</div>
          <div>
            {status.zahlen.sitzungen} Durchgänge, {status.zahlen.drucke} Ausdrucke
          </div>
        </div>
        <p style={{ color: 'var(--schrift-leise)', fontSize: '0.85rem' }}>
          Diese Seite zeigt nur an — verstellen kann man hier nichts.
        </p>
      </div>
    );
  }

  if (!galerie) return <div className="handy">Einen Moment…</div>;

  if (gross) {
    return (
      <div className="handy">
        <img className="handy__bild" src={`/medien/galerie/${token}/${gross}.jpg?gross=1`} alt="" />
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
          <a
            className="knopf knopf--haupt"
            style={{ flex: 1, minHeight: '3rem', fontSize: '1rem', textDecoration: 'none' }}
            href={`/medien/download/${token}/${gross}.jpg`}
            download
          >
            Aufs Handy laden
          </a>
          <button className="knopf" style={{ minHeight: '3rem' }} onClick={() => setzeGross(null)}>
            Zurück
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="handy">
      <h1 style={{ marginBottom: '0.2rem' }}>{galerie.veranstaltung}</h1>
      <p style={{ color: 'var(--schrift-leise)', marginTop: 0 }}>
        {galerie.bilder.length} Foto(s) — tippe eines an, um es zu laden.
      </p>
      <div className="handy__raster">
        {galerie.bilder.map((bild) => (
          <button key={bild.id} onClick={() => setzeGross(bild.id)} style={{ padding: 0 }}>
            <img className="handy__bild" src={`/medien/galerie/${token}/${bild.id}.jpg`} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}
