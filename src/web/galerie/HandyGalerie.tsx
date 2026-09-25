import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { mehrzahl, Statusliste } from '../Statusliste.js';
import { STOERUNGSTEXTE } from '../../shared/typen.js';

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

/** Wie oft die Galerie nach neuen Fotos schaut - der Abend geht weiter. */
const NACHLADEN_MS = 30_000;

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
    // Die Galerie lud einmal und nie wieder. Ein Gast, der sie offen hat,
    // sah die Fotos des restlichen Abends nicht - und am Handy "nach unten
    // ziehen" ging auch nicht, weil ein innerer Rollbereich es abfing.
    const laden = () =>
      api
        .hole<GalerieDaten>(`/api/galerie/${token}`)
        .then(setzeGalerie)
        .catch((u: Error) => setzeFehler(u.message));
    void laden();
    const uhr = setInterval(laden, NACHLADEN_MS);
    return () => clearInterval(uhr);
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
        <h1>{status.veranstaltung}</h1>
        <p className="handy__unterzeile">Status der Fotobox — aktualisiert sich von selbst.</p>
        <Statusliste
          zustand={{
            kamera: status.zustand.kamera,
            drucker: status.zustand.drucker,
            druckerStoerung:
              status.zustand.drucker === 'bereit'
                ? null
                : (STOERUNGSTEXTE[status.zustand.stoerung as keyof typeof STOERUNGSTEXTE]?.titel ??
                  'Drucker meldet einen Fehler'),
            stoerungArt: status.zustand.stoerung,
            warteschlangeOffen: status.zustand.warteschlangeOffen,
            materialRest: status.zahlen.materialRest,
            speicherFreiGb: status.zustand.speicherFreiGb,
            sitzungen: status.zahlen.sitzungen,
            drucke: status.zahlen.drucke,
          }}
          stand={new Date().toISOString()}
        />
        <p className="handy__tipp">Hier lässt sich nichts verstellen — die Seite zeigt nur an.</p>
      </div>
    );
  }

  if (!galerie) return <div className="handy">Einen Moment…</div>;

  if (gross) {
    return (
      <div className="handy">
        <button className="handy__zurueck" onClick={() => setzeGross(null)}>
          ‹ Alle Fotos
        </button>
        <img className="handy__bild" src={`/medien/galerie/${token}/${gross}.jpg?gross=1`} alt="" />
        <a className="knopf knopf--haupt handy__laden" href={`/medien/download/${token}/${gross}.jpg`} download>
          Aufs Handy laden
        </a>
        <p className="handy__tipp">
          Am iPhone geht es auch so: Bild gedrückt halten und „Zu Fotos hinzufügen" wählen.
        </p>
      </div>
    );
  }

  return (
    <div className="handy">
      <h1>{galerie.veranstaltung}</h1>
      <p className="handy__unterzeile">
        {galerie.bilder.length === 0
          ? 'Noch keine Fotos — die ersten kommen bestimmt gleich.'
          : `${mehrzahl(galerie.bilder.length, 'Foto', 'Fotos')} — tippe eines an, um es zu laden.`}
      </p>
      <div className="handy__raster">
        {galerie.bilder.map((bild) => (
          <button key={bild.id} className="handy__kachel" onClick={() => setzeGross(bild.id)}>
            <img src={`/medien/galerie/${token}/${bild.id}.jpg`} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
