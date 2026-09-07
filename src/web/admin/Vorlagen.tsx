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

        <table className="liste" style={{ marginTop: '0.8rem' }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Format</th>
              <th>Fotos</th>
              <th>Ebenen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vorlagen.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.canvas.preset === '10x15-quer' ? '10 × 15 quer' : '10 × 15 hoch'}</td>
                <td>{v.ebenen.filter((e) => e.typ === 'foto').length}</td>
                <td>{v.ebenen.length}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="knopf knopf--neben" onClick={() => setzeOffen(v)}>
                    Bearbeiten
                  </button>
                  <button className="knopf knopf--neben" onClick={() => void dupliziere(v)}>
                    Duplizieren
                  </button>
                  <button className="knopf knopf--neben" onClick={() => void loesche(v)}>
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
            {vorlagen.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--schrift-leise)' }}>
                  Noch keine Vorlage.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
