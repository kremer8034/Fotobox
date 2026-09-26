import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Filter {
  id: string;
  name: string;
  eingebaut: boolean;
  operationen: { op: string }[];
}

/**
 * Filterbibliothek.
 *
 * Laut Plan gehoerte sie von Anfang an dazu: eingebaute Looks ansehen und
 * eigene als .cube-LUT aus Lightroom, Photoshop oder DaVinci importieren. Der
 * Druck konnte LUTs anwenden, aber es gab keinen Weg, eine hineinzubekommen.
 * Welche Filter ein Gast sieht, entscheidet weiter jede Veranstaltung unter
 * "Vorlagen & Filter".
 */
export function FilterSeite() {
  const [filter, setzeFilter] = useState<Filter[] | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [stand, setzeStand] = useState(Date.now());

  useEffect(() => {
    void lade();
  }, []);

  if (!filter) return <p>Einen Moment…</p>;

  return (
    <>
      <div className="zeile" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0 }}>Filter</h1>
        <label className="knopf knopf--haupt" style={{ cursor: 'pointer' }}>
          LUT importieren (.cube)
          <input
            type="file"
            accept=".cube"
            style={{ display: 'none' }}
            onChange={(e) => {
              const datei = e.target.files?.[0];
              if (datei) void importieren(datei);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <p style={{ color: 'var(--schrift-leise)', fontSize: '0.85rem', marginTop: 0 }}>
        Eigene Looks kommen als <code>.cube</code>-Datei, etwa aus Lightroom („Profil exportieren“),
        Photoshop oder DaVinci Resolve. Welche Filter die Gäste sehen, legst du je Veranstaltung unter
        „Vorlagen &amp; Filter“ fest.
      </p>
      {meldung && <div className="hinweis-fest">{meldung}</div>}

      <div className="filter-raster">
        {filter.map((f) => (
          <div className="karte filter-kachel" key={f.id}>
            <img src={`/api/admin/filter/${f.id}/vorschau.jpg?t=${stand}`} alt="" />
            <div className="zeile" style={{ justifyContent: 'space-between', marginTop: '0.5rem' }}>
              {f.eingebaut ? (
                <strong>{f.name}</strong>
              ) : (
                <input
                  defaultValue={f.name}
                  maxLength={40}
                  aria-label="Name des Filters"
                  onBlur={(e) => {
                    const neu = e.target.value.trim();
                    if (neu && neu !== f.name) void umbenennen(f, neu);
                  }}
                />
              )}
              {f.eingebaut ? (
                <span className="marke">eingebaut</span>
              ) : (
                <button className="knopf knopf--neben" onClick={() => void loeschen(f)}>
                  Löschen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  async function lade() {
    setzeFilter(await api.hole<Filter[]>('/api/admin/filter'));
    setzeStand(Date.now());
  }

  function zeige(text: string) {
    setzeMeldung(text);
    setTimeout(() => setzeMeldung(null), 4000);
  }

  async function importieren(datei: File) {
    try {
      const neu = await api.sendeDatei<Filter>('/api/admin/filter/lut', datei);
      await lade();
      zeige(`„${neu.name}“ importiert. Jetzt noch in der Veranstaltung freigeben.`);
    } catch (fehler) {
      zeige(fehler instanceof Error ? fehler.message : 'Import ging nicht.');
    }
  }

  async function umbenennen(f: Filter, name: string) {
    try {
      await api.aendere('/api/admin/filter', { id: f.id, name, operationen: f.operationen });
      await lade();
      zeige('Umbenannt.');
    } catch (fehler) {
      zeige(fehler instanceof Error ? fehler.message : 'Umbenennen ging nicht.');
    }
  }

  async function loeschen(f: Filter) {
    if (!window.confirm(`„${f.name}“ löschen? Veranstaltungen, die ihn nutzen, verlieren ihn.`)) return;
    try {
      await api.loesche(`/api/admin/filter/${f.id}`);
      await lade();
      zeige(`„${f.name}“ gelöscht.`);
    } catch (fehler) {
      zeige(fehler instanceof Error ? fehler.message : 'Löschen ging nicht.');
    }
  }
}
