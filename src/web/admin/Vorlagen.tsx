import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { VorlagenEditor } from './editor/VorlagenEditor.js';
import type { Vorlage } from './editor/typen.js';

/**
 * Vorlagen-Bibliothek.
 *
 * Vorlagen existieren genau einmal und werden von beliebig vielen
 * Veranstaltungen referenziert. Das Entfernen aus einer Veranstaltung loescht
 * die Vorlage nicht.
 */
export function VorlagenSeite() {
  const [vorlagen, setzeVorlagen] = useState<Vorlage[]>([]);
  const [offen, setzeOffen] = useState<Vorlage | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);

  useEffect(() => {
    void lade();
  }, []);

  if (offen) {
    return (
      <VorlagenEditor
        vorlage={offen}
        beiSchliessen={() => {
          setzeOffen(null);
          setzeMeldung(null);
          void lade();
        }}
        beiMeldung={setzeMeldung}
        meldung={meldung}
      />
    );
  }

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Vorlagen</h1>
      {meldung && <p style={{ color: 'var(--akzent)' }}>{meldung}</p>}

      <div className="karte">
        <div className="zeile" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Bibliothek</h2>
          <button className="knopf knopf--neben" onClick={() => setzeOffen(leereVorlage())}>
            Neue Vorlage
          </button>
        </div>

        {/*
          Vorher eine Tabelle aus Namen und Zahlen: "4 Ebenen" sagt nichts
          darueber, wie die Vorlage aussieht. Eine Vorlage ist etwas, das man
          ansieht - also zeigt die Bibliothek sie auch.
        */}
        <div className="vorlagen-raster" style={{ marginTop: '0.9rem' }}>
          {vorlagen.map((v) => {
            const fotos = v.ebenen.filter((e) => e.typ === 'foto').length;
            return (
              <div className="vorlagen-kachel" key={v.id}>
                {/*
                  Jede Kachel bekommt denselben Bildkasten. Bekam das Hochformat
                  seinen eigenen, wurde die ganze Rasterzeile so hoch wie es -
                  und neben ihm standen die Querformate mit leerer Flaeche.
                */}
                <img
                  className="vorlagen-kachel__bild"
                  src={`/api/admin/vorlagen/${v.id}/vorschau.jpg`}
                  alt=""
                />
                <div className="vorlagen-kachel__leiste">
                  <div>
                    <div className="vorlagen-kachel__name">{v.name}</div>
                    <div className="vorlagen-kachel__info">
                      {v.canvas.preset === '10x15-quer' ? '10 × 15 quer' : '10 × 15 hoch'} ·{' '}
                      {fotos} {fotos === 1 ? 'Foto' : 'Fotos'} · {v.ebenen.length}{' '}
                      {v.ebenen.length === 1 ? 'Ebene' : 'Ebenen'}
                    </div>
                  </div>
                  <div className="zeile" style={{ gap: '0.4rem' }}>
                    <button className="knopf knopf--neben" onClick={() => setzeOffen(v)}>
                      Bearbeiten
                    </button>
                    <button className="knopf knopf--neben" onClick={() => void dupliziere(v)}>
                      Duplizieren
                    </button>
                    <button className="knopf knopf--neben" onClick={() => void loesche(v)}>
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {vorlagen.length === 0 && (
          <p style={{ color: 'var(--schrift-leise)' }}>
            Noch keine Vorlage. Mit „Neue Vorlage“ fängt eine leere Fläche an — oder in Canva
            gestalten, als PNG ausgeben und im Editor als Bildebene einsetzen.
          </p>
        )}
      </div>
    </>
  );

  async function lade() {
    setzeVorlagen(await api.hole<Vorlage[]>('/api/admin/vorlagen'));
  }

  async function dupliziere(v: Vorlage) {
    await api.aendere('/api/admin/vorlagen', {
      name: `${v.name} (Kopie)`,
      preset: v.canvas.preset,
      hintergrundFarbe: v.hintergrundFarbe,
      ebenen: v.ebenen,
    });
    await lade();
    setzeMeldung(`"${v.name}" wurde kopiert.`);
  }

  async function loesche(v: Vorlage) {
    if (!window.confirm(`"${v.name}" wirklich löschen? Veranstaltungen, die sie nutzen, verlieren sie.`)) {
      return;
    }
    await api.loesche(`/api/admin/vorlagen/${v.id}`);
    await lade();
    setzeMeldung(`"${v.name}" gelöscht.`);
  }
}

function leereVorlage(): Vorlage {
  return {
    id: '',
    name: 'Neue Vorlage',
    canvas: { preset: '10x15-quer', breiteMm: 152.4, hoeheMm: 101.6 },
    hintergrundFarbe: '#ffffff',
    ebenen: [],
  };
}
