import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Ebene {
  id: string;
  typ: 'bild' | 'foto' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  sichtbar?: boolean;
  gesperrt?: boolean;
  datei?: string;
  index?: number;
  text?: string;
  groesse?: number;
  farbe?: string;
  ausrichtung?: string;
  einpassung?: string;
}

interface Vorlage {
  id: string;
  name: string;
  canvas: { preset: string; breiteMm: number; hoeheMm: number };
  ebenen: Ebene[];
  hintergrundFarbe?: string;
  fotos?: number;
}

/**
 * Vorlagen-Bibliothek und Ebenen-Editor.
 *
 * Statt fester Rollen Hintergrund und Overlay gibt es einen freien
 * Ebenenstapel: Ein Zierrahmen kann damit ueber einem Foto und gleichzeitig
 * unter dem Logo liegen.
 *
 * "Bild aus Datei" ist die Rueckfallebene fuer Canva und zugleich der
 * Normalweg: In Canva gestalten, als PNG exportieren, hier einfuegen, fertig.
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
      <Editor
        vorlage={offen}
        beiSchliessen={() => {
          setzeOffen(null);
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
                <td>{v.canvas.preset}</td>
                <td>{v.ebenen.filter((e) => e.typ === 'foto').length}</td>
                <td>{v.ebenen.length}</td>
                <td>
                  <button className="knopf knopf--neben" onClick={() => setzeOffen(v)}>
                    Bearbeiten
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  async function lade() {
    setzeVorlagen(await api.hole<Vorlage[]>('/api/admin/vorlagen'));
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

function Editor({
  vorlage,
  beiSchliessen,
  beiMeldung,
  meldung,
}: {
  vorlage: Vorlage;
  beiSchliessen: () => void;
  beiMeldung: (t: string | null) => void;
  meldung: string | null;
}) {
  const [entwurf, setzeEntwurf] = useState<Vorlage>(vorlage);
  const [gewaehlt, setzeGewaehlt] = useState<string | null>(null);

  const quer = entwurf.canvas.preset === '10x15-quer';
  const vorschauBreite = quer ? 520 : 347;
  const vorschauHoehe = quer ? 347 : 520;

  return (
    <>
      <div className="zeile" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0 }}>Vorlage bearbeiten</h1>
        <div className="zeile">
          <button className="knopf knopf--neben" onClick={() => void speichern()}>
            Speichern
          </button>
          <button className="knopf knopf--neben" onClick={() => void testdruck()} disabled={!entwurf.id}>
            Layout-Testdruck
          </button>
          <button className="knopf knopf--neben" onClick={beiSchliessen}>
            Zurück
          </button>
        </div>
      </div>
      {meldung && <p style={{ color: 'var(--akzent)' }}>{meldung}</p>}

      <div className="zeile" style={{ alignItems: 'flex-start' }}>
        <div className="karte" style={{ flex: '0 0 auto' }}>
          <h2>Vorschau</h2>
          <div
            style={{
              position: 'relative',
              width: vorschauBreite,
              height: vorschauHoehe,
              background: entwurf.hintergrundFarbe ?? '#fff',
              borderRadius: '0.3rem',
              overflow: 'hidden',
            }}
          >
            {entwurf.ebenen.map((ebene) => (
              <div
                key={ebene.id}
                onClick={() => setzeGewaehlt(ebene.id)}
                style={{
                  position: 'absolute',
                  left: `${ebene.x * 100}%`,
                  top: `${ebene.y * 100}%`,
                  width: `${ebene.w * 100}%`,
                  height: `${ebene.h * 100}%`,
                  border: gewaehlt === ebene.id ? '2px solid #c8963e' : '1px dashed #999',
                  background:
                    ebene.typ === 'foto'
                      ? 'rgba(120,160,200,0.55)'
                      : ebene.typ === 'text'
                        ? 'rgba(200,150,60,0.25)'
                        : 'rgba(140,140,140,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  color: '#111',
                  opacity: ebene.sichtbar === false ? 0.3 : 1,
                  cursor: 'pointer',
                }}
              >
                {ebene.typ === 'foto' ? `Foto ${ebene.index}` : ebene.typ === 'text' ? ebene.text : '🖼'}
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--schrift-leise)' }}>
            {entwurf.canvas.breiteMm} × {entwurf.canvas.hoeheMm} mm · Die Anzahl der Foto-Ebenen
            bestimmt, wie viele Fotos aufgenommen werden.
          </p>
        </div>

        <div style={{ flex: 1, minWidth: '22rem' }}>
          <div className="karte">
            <h2>Grunddaten</h2>
            <div className="zeile">
              <div className="feld" style={{ flex: 1 }}>
                <label>Name</label>
                <input
                  value={entwurf.name}
                  onChange={(e) => setzeEntwurf({ ...entwurf, name: e.target.value })}
                />
              </div>
              <div className="feld feld--klein">
                <label>Format</label>
                <select
                  value={entwurf.canvas.preset}
                  onChange={(e) =>
                    setzeEntwurf({
                      ...entwurf,
                      canvas:
                        e.target.value === '10x15-quer'
                          ? { preset: '10x15-quer', breiteMm: 152.4, hoeheMm: 101.6 }
                          : { preset: '10x15-hoch', breiteMm: 101.6, hoeheMm: 152.4 },
                    })
                  }
                >
                  <option value="10x15-quer">10 × 15 quer</option>
                  <option value="10x15-hoch">10 × 15 hoch</option>
                </select>
              </div>
            </div>
          </div>

          <div className="karte">
            <div className="zeile" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Ebenen</h2>
              <div className="zeile">
                <button className="knopf knopf--neben" onClick={() => fuegeEin('foto')}>
                  + Foto
                </button>
                <button className="knopf knopf--neben" onClick={() => fuegeEin('text')}>
                  + Text
                </button>
                <label className="knopf knopf--neben" style={{ cursor: 'pointer' }}>
                  + Bild aus Datei
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => void bildHochladen(e.target.files?.[0])}
                  />
                </label>
              </div>
            </div>

            <table className="liste" style={{ marginTop: '0.6rem' }}>
              <tbody>
                {[...entwurf.ebenen].reverse().map((ebene) => (
                  <tr
                    key={ebene.id}
                    style={{ background: gewaehlt === ebene.id ? 'var(--flaeche-hell)' : undefined }}
                    onClick={() => setzeGewaehlt(ebene.id)}
                  >
                    <td>{ebene.typ === 'foto' ? `Foto ${ebene.index}` : ebene.typ === 'text' ? 'Text' : 'Bild'}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--schrift-leise)' }}>
                      {ebene.typ === 'text' ? ebene.text : ebene.datei}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="knopf knopf--neben" onClick={() => bewege(ebene.id, 1)}>
                        ↑
                      </button>
                      <button className="knopf knopf--neben" onClick={() => bewege(ebene.id, -1)}>
                        ↓
                      </button>
                      <button
                        className="knopf knopf--neben"
                        onClick={() => aendere(ebene.id, { sichtbar: ebene.sichtbar === false })}
                      >
                        {ebene.sichtbar === false ? 'zeigen' : 'aus'}
                      </button>
                      <button className="knopf knopf--neben" onClick={() => entferne(ebene.id)}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
                {entwurf.ebenen.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--schrift-leise)' }}>
                      Noch keine Ebene. Beginne mit einem Bild aus Canva oder einer Foto-Ebene.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {gewaehlt && <EbenenFelder ebene={entwurf.ebenen.find((e) => e.id === gewaehlt)!} beiAendern={aendere} />}
        </div>
      </div>
    </>
  );

  function fuegeEin(typ: 'foto' | 'text') {
    const fotoAnzahl = entwurf.ebenen.filter((e) => e.typ === 'foto').length;
    const neu: Ebene =
      typ === 'foto'
        ? { id: kennung(), typ: 'foto', index: fotoAnzahl + 1, x: 0.1, y: 0.1, w: 0.4, h: 0.5, einpassung: 'cover' }
        : {
            id: kennung(),
            typ: 'text',
            text: '{veranstaltung}',
            x: 0.1,
            y: 0.8,
            w: 0.8,
            h: 0.12,
            groesse: 0.06,
            farbe: '#333333',
            ausrichtung: 'mitte',
          };
    setzeEntwurf({ ...entwurf, ebenen: [...entwurf.ebenen, neu] });
    setzeGewaehlt(neu.id);
  }

  async function bildHochladen(datei: File | undefined) {
    if (!datei) return;
    const formular = new FormData();
    formular.append('datei', datei);
    const antwort = await fetch('/api/admin/vorlagen/bild', { method: 'POST', body: formular });
    if (!antwort.ok) {
      beiMeldung('Bild konnte nicht hochgeladen werden.');
      return;
    }
    const { datei: name } = (await antwort.json()) as { datei: string };
    const neu: Ebene = { id: kennung(), typ: 'bild', datei: name, x: 0, y: 0, w: 1, h: 1 };
    setzeEntwurf({ ...entwurf, ebenen: [...entwurf.ebenen, neu] });
    setzeGewaehlt(neu.id);
    beiMeldung('Bild eingefügt. Mit ↑ und ↓ im Stapel einsortieren.');
  }

  function aendere(id: string, teil: Partial<Ebene>) {
    setzeEntwurf({
      ...entwurf,
      ebenen: entwurf.ebenen.map((e) => (e.id === id ? { ...e, ...teil } : e)),
    });
  }

  function entferne(id: string) {
    setzeEntwurf({ ...entwurf, ebenen: entwurf.ebenen.filter((e) => e.id !== id) });
    if (gewaehlt === id) setzeGewaehlt(null);
  }

  function bewege(id: string, richtung: number) {
    const liste = [...entwurf.ebenen];
    const i = liste.findIndex((e) => e.id === id);
    const ziel = i + richtung;
    if (i < 0 || ziel < 0 || ziel >= liste.length) return;
    [liste[i], liste[ziel]] = [liste[ziel]!, liste[i]!];
    setzeEntwurf({ ...entwurf, ebenen: liste });
  }

  async function speichern() {
    const gespeichert = await api.aendere<Vorlage>('/api/admin/vorlagen', {
      id: entwurf.id || undefined,
      name: entwurf.name,
      preset: entwurf.canvas.preset,
      hintergrundFarbe: entwurf.hintergrundFarbe,
      ebenen: entwurf.ebenen,
    });
    setzeEntwurf(gespeichert);
    beiMeldung('Vorlage gespeichert.');
  }

  async function testdruck() {
    await api.sende(`/api/admin/vorlagen/${entwurf.id}/testdruck`, {});
    beiMeldung('Testdruck in der Warteschlange. Er zählt nicht in den Auslagenersatz.');
  }
}

function EbenenFelder({
  ebene,
  beiAendern,
}: {
  ebene: Ebene;
  beiAendern: (id: string, teil: Partial<Ebene>) => void;
}) {
  const zahl = (name: keyof Ebene, beschriftung: string, schritt = 0.01) => (
    <div className="feld feld--klein" key={String(name)}>
      <label>{beschriftung}</label>
      <input
        type="number"
        step={schritt}
        value={Number(ebene[name] ?? 0)}
        onChange={(e) => beiAendern(ebene.id, { [name]: Number(e.target.value) } as Partial<Ebene>)}
      />
    </div>
  );

  return (
    <div className="karte">
      <h2>Ausgewählte Ebene</h2>
      <div className="zeile">
        {zahl('x', 'Links (0–1)')}
        {zahl('y', 'Oben (0–1)')}
        {zahl('w', 'Breite (0–1)')}
        {zahl('h', 'Höhe (0–1)')}
      </div>
      {ebene.typ === 'text' && (
        <div className="zeile">
          <div className="feld" style={{ flex: 1 }}>
            <label>Text — Platzhalter: {'{veranstaltung} {datum} {uhrzeit} {nummer}'}</label>
            <input
              value={ebene.text ?? ''}
              onChange={(e) => beiAendern(ebene.id, { text: e.target.value })}
            />
          </div>
          {zahl('groesse', 'Größe (Anteil Höhe)')}
          <div className="feld feld--klein">
            <label>Farbe</label>
            <input
              type="color"
              value={ebene.farbe ?? '#333333'}
              onChange={(e) => beiAendern(ebene.id, { farbe: e.target.value })}
            />
          </div>
        </div>
      )}
      {ebene.typ === 'foto' && (
        <div className="zeile">
          {zahl('index', 'Aufnahmereihenfolge', 1)}
          <div className="feld feld--klein">
            <label>Einpassung</label>
            <select
              value={ebene.einpassung ?? 'cover'}
              onChange={(e) => beiAendern(ebene.id, { einpassung: e.target.value })}
            >
              <option value="cover">füllend</option>
              <option value="contain">vollständig</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function kennung(): string {
  return Math.random().toString(36).slice(2, 10);
}
