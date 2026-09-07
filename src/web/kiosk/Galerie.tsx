import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface GalerieDaten {
  veranstaltung?: string;
  nachdruckMoeglich?: boolean;
  kopienMax?: number;
  bilder: { id: string; erstellt: string }[];
}

/**
 * Galerie am Touchscreen: die fertigen Layouts der laufenden Veranstaltung.
 * Antippen oeffnet gross, Nachdruck direkt moeglich - er zaehlt in den
 * Auslagenersatz mit.
 */
export function Galerie({ beiZurueck }: { beiZurueck: () => void }) {
  const [daten, setzeDaten] = useState<GalerieDaten | null>(null);
  const [offen, setzeOffen] = useState<string | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);

  useEffect(() => {
    void api.hole<GalerieDaten>('/api/kiosk/galerie').then(setzeDaten);
  }, []);

  if (offen) {
    return (
      <div className="seite kiosk">
        <img className="ergebnis__bild" src={`/medien/ausgabe/${offen}.jpg`} alt="" />
        <div className="ergebnis__leiste">
          {daten?.nachdruckMoeglich && (
            <button className="knopf knopf--haupt" onClick={() => void nachdrucken(offen)}>
              Noch einmal drucken
            </button>
          )}
          <button className="knopf" onClick={() => setzeOffen(null)}>
            Zurück
          </button>
        </div>
        {meldung && <p className="untertitel" style={{ textAlign: 'center' }}>{meldung}</p>}
      </div>
    );
  }

  return (
    <div className="seite kiosk">
      <div className="reihe">
        <h1 className="titel" style={{ flex: 1 }}>
          Bisherige Fotos
        </h1>
        <button className="knopf knopf--neben" onClick={beiZurueck}>
          Zurück
        </button>
      </div>

      {daten === null && <p className="untertitel">Einen Moment…</p>}
      {daten && daten.bilder.length === 0 && (
        <div className="mitte">
          <p className="untertitel">Hier ist noch nichts. Macht das erste Foto!</p>
        </div>
      )}

      <div
        className="raster"
        style={{ gridTemplateColumns: 'repeat(4, 1fr)', overflowY: 'auto', flex: 1 }}
      >
        {daten?.bilder.map((bild) => (
          <button key={bild.id} className="kachel" onClick={() => setzeOffen(bild.id)}>
            <img
              src={`/medien/ausgabe/${bild.id}.jpg?klein=1`}
              alt=""
              style={{ width: '100%', borderRadius: '4px' }}
            />
          </button>
        ))}
      </div>
    </div>
  );

  async function nachdrucken(id: string) {
    try {
      await api.sende('/api/kiosk/drucken', { ausgabeId: id, kopien: 1, quelle: 'galerie' });
      setzeMeldung('Wird gedruckt.');
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    }
  }
}
