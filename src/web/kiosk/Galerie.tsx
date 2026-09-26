import { useEffect, useState } from 'react';
import { useZeitgeber } from './zeitgeber.js';
import { api } from '../api.js';
import { Mengenwahl, Quittung, useDrucken } from './Drucken.js';

interface GalerieDaten {
  veranstaltung?: string;
  nachdruckMoeglich?: boolean;
  kopienMax?: number;
  bilder: { id: string; erstellt: string; verborgen?: boolean }[];
}

/**
 * Galerie am Touchscreen: die fertigen Layouts der laufenden Veranstaltung.
 * Antippen oeffnet gross, Nachdruck direkt moeglich - er zaehlt in den
 * Auslagenersatz mit.
 *
 * "Zurueck" steht unten rechts wie auf allen anderen Kiosk-Seiten. Oben
 * rechts lag es vorher genau unter dem Schloss: Ein Tipper auf die Ecke des
 * Knopfs landete im Schloss, das nur auf langes Druecken reagiert, und der
 * Knopf schien nicht zu funktionieren.
 */
export function Galerie({
  leerlaufSekunden,
  beiZurueck,
  betreuung = false,
}: {
  leerlaufSekunden: number;
  beiZurueck: () => void;
  /**
   * Aus dem Servicemenue geoeffnet: Dann zeigt die Galerie auch die
   * herausgenommenen Bilder, und jedes Bild laesst sich herausnehmen oder
   * zurueckholen. Ein Gast sieht davon nichts.
   */
  betreuung?: boolean;
}) {
  const [daten, setzeDaten] = useState<GalerieDaten | null>(null);
  const [offen, setzeOffen] = useState<string | null>(null);
  const [beruehrt, setzeBeruehrt] = useState(0);

  useEffect(() => {
    void api.hole<GalerieDaten>(`/api/kiosk/galerie${betreuung ? '?alle=1' : ''}`).then(setzeDaten);
  }, [betreuung]);

  // Die eingestellte Leerlaufzeit stand in den Veranstaltungseinstellungen,
  // wirkte aber nirgends: Wer die Galerie offen liess, liess sie offen, bis
  // der naechste Gast von Hand zurueckging. Jede Beruehrung und jedes
  // Blaettern setzt die Uhr zurueck.
  useZeitgeber(beiZurueck, leerlaufSekunden * 1000, [beruehrt, offen]);
  const regeSichAn = () => setzeBeruehrt((n) => n + 1);

  if (offen) {
    return (
      <div onPointerDown={regeSichAn} style={{ display: 'contents' }}>
        <Einzelbild
          id={offen}
          nachdruckMoeglich={daten?.nachdruckMoeglich ?? false}
          kopienMax={daten?.kopienMax ?? 1}
          beiZurueck={() => setzeOffen(null)}
          verborgen={daten?.bilder.find((b) => b.id === offen)?.verborgen ?? false}
          betreuung={betreuung}
          beiUmschalten={(verborgen) =>
            setzeDaten((d) =>
              d ? { ...d, bilder: d.bilder.map((b) => (b.id === offen ? { ...b, verborgen } : b)) } : d,
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="seite kiosk" onPointerDown={regeSichAn}>
      <div className="kopf">
        <h1 className="titel">{betreuung ? 'Galerie verwalten' : 'Bisherige Fotos'}</h1>
        {daten && daten.bilder.length > 0 && (
          <p className="untertitel">
            {betreuung
              ? 'Tippe ein Foto an, um es nachzudrucken oder aus der Galerie zu nehmen.'
              : 'Tippe ein Foto an, um es groß zu sehen.'}
          </p>
        )}
      </div>

      {daten === null && <p className="untertitel">Einen Moment…</p>}
      {daten && daten.bilder.length === 0 && (
        <div className="mitte">
          <p className="untertitel">Hier ist noch nichts. Macht das erste Foto!</p>
        </div>
      )}

      {daten && daten.bilder.length > 0 && (
        <div className="galerie-raster" onScroll={regeSichAn}>
          {daten.bilder.map((bild) => (
            <button
              key={bild.id}
              className={`galerie-kachel${bild.verborgen ? ' galerie-kachel--verborgen' : ''}`}
              onClick={() => setzeOffen(bild.id)}
            >
              {/* Fester Bildkasten fuer alle: Ein Hochformat wurde vorher unten
                  abgeschnitten, waehrend die Querformate daneben leer hingen. */}
              <span className="galerie-kachel__bild">
                <img src={`/medien/ausgabe/${bild.id}.jpg?klein=1`} alt="" loading="lazy" />
              </span>
              {bild.verborgen && <span className="galerie-kachel__marke">Herausgenommen</span>}
            </button>
          ))}
        </div>
      )}

      <div className="reihe reihe--ende">
        <button className="knopf knopf--neben" onClick={beiZurueck}>
          Zurück
        </button>
      </div>
    </div>
  );
}

function Einzelbild({
  id,
  nachdruckMoeglich,
  kopienMax,
  beiZurueck,
  verborgen,
  betreuung,
  beiUmschalten,
}: {
  id: string;
  nachdruckMoeglich: boolean;
  kopienMax: number;
  beiZurueck: () => void;
  verborgen: boolean;
  betreuung: boolean;
  beiUmschalten: (verborgen: boolean) => void;
}) {
  const [kopien, setzeKopien] = useState(1);
  const [meldung, setzeMeldung] = useState<string | null>(null);

  async function umschalten() {
    try {
      await api.sende(`/api/kiosk/service/galerie/${id}`, { verborgen: !verborgen });
      beiUmschalten(!verborgen);
      setzeMeldung(
        verborgen
          ? 'Das Foto ist wieder in der Galerie.'
          : 'Das Foto ist aus der Galerie genommen - auf den Handys und hier am Bildschirm.',
      );
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    }
  }
  // Nach erfolgreichem Druck zurueck in die Uebersicht - das Bild ist erledigt.
  const druck = useDrucken(id, 'galerie', beiZurueck);

  return (
    <div className="seite kiosk" style={{ position: 'relative' }}>
      <img className="ergebnis__bild" src={`/medien/ausgabe/${id}.jpg`} alt="" />
      {meldung && <p className="untertitel" style={{ textAlign: 'center' }}>{meldung}</p>}
      <div className="ergebnis__leiste">
        {betreuung && (
          <button className="knopf" onClick={() => void umschalten()}>
            {verborgen ? 'Wieder zeigen' : 'Aus der Galerie nehmen'}
          </button>
        )}
        {nachdruckMoeglich && (
          <>
            <Mengenwahl kopien={kopien} max={kopienMax} beiAendern={setzeKopien} />
            <button
              className="knopf knopf--haupt"
              onClick={() => void druck.drucke(kopien)}
              disabled={druck.beschaeftigt}
            >
              {kopien === 1 ? 'Noch einmal drucken' : `${kopien}× drucken`}
            </button>
          </>
        )}
        <button className="knopf" onClick={beiZurueck}>
          Zurück
        </button>
      </div>
      {druck.quittung && (
        <Quittung
          text={druck.quittung.text}
          fehlgeschlagen={druck.quittung.fehlgeschlagen}
          beiZurueck={druck.schliesseQuittung}
        />
      )}
    </div>
  );
}
