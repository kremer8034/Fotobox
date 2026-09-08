import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Leinwand } from './Leinwand.js';
import { richteAus, verteile, type Ausrichtung } from './einrasten.js';
import type { Ebene, Vorlage } from './typen.js';
import { SCHRIFTEN } from '../../../shared/typen.js';

/**
 * Vorlagen-Editor.
 *
 * Gestaltet wird direkt auf der Flaeche: ziehen, an acht Griffen in der
 * Groesse aendern, mit Pfeiltasten fein schieben. Kanten und Mitten rasten an
 * der Leinwand und an anderen Ebenen ein (Alt haelt dagegen), Ausrichten und
 * Verteilen gibt es als Knopf, und jeder Zug laesst sich rueckgaengig machen.
 *
 * Die Zahlenfelder bleiben trotzdem - in Millimetern, weil man beim Druck in
 * Millimetern denkt und nicht in Bruchteilen.
 */
export function VorlagenEditor({
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
  const [gespeichert, setzeGespeichert] = useState(true);

  // Rueckgaengig: Es wird der Stand VOR einem Zug abgelegt, nicht jeder
  // Zwischenschritt einer Ziehbewegung.
  const verlauf = useRef<Vorlage[]>([]);
  const vorZug = useRef<Vorlage | null>(null);

  const merkeVorZug = useCallback(() => {
    vorZug.current ??= entwurf;
  }, [entwurf]);

  const schliesseZugAb = useCallback(() => {
    if (!vorZug.current) return;
    verlauf.current = [...verlauf.current.slice(-49), vorZug.current];
    vorZug.current = null;
    setzeGespeichert(false);
  }, []);

  const rueckgaengig = useCallback(() => {
    const letzter = verlauf.current.pop();
    if (!letzter) return;
    setzeEntwurf(letzter);
    setzeGespeichert(false);
  }, []);

  const aendere = useCallback(
    (id: string, teil: Partial<Ebene>) => {
      merkeVorZug();
      setzeEntwurf((alt) => ({
        ...alt,
        ebenen: alt.ebenen.map((e) => (e.id === id ? { ...e, ...teil } : e)),
      }));
    },
    [merkeVorZug],
  );

  const ebene = entwurf.ebenen.find((e) => e.id === gewaehlt) ?? null;

  // Tastatur: fein schieben, duplizieren, loeschen, rueckgaengig.
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      const ziel = e.target as HTMLElement | null;
      if (ziel && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ziel.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        rueckgaengig();
        return;
      }
      if (!gewaehlt || !ebene) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        dupliziere();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        entferne(gewaehlt);
        return;
      }

      const schritt = e.shiftKey ? 0.02 : 0.002;
      const bewegung: Record<string, [number, number]> = {
        ArrowLeft: [-schritt, 0],
        ArrowRight: [schritt, 0],
        ArrowUp: [0, -schritt],
        ArrowDown: [0, schritt],
      };
      const richtung = bewegung[e.key];
      if (richtung) {
        e.preventDefault();
        merkeVorZug();
        aendere(gewaehlt, { x: ebene.x + richtung[0], y: ebene.y + richtung[1] });
        schliesseZugAb();
      }
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  });

  const quer = entwurf.canvas.breiteMm >= entwurf.canvas.hoeheMm;

  /*
   * Eigene Schriften. Die feste Auswahl kommt aus den geteilten Typen; hier
   * kommt dazu, was der Nutzer selbst hinzugefuegt hat. Damit die Vorschau sie
   * auch zeigt, werden sie als @font-face in die Seite gehaengt - der Renderer
   * findet dieselben Dateien ueber fontconfig.
   */
  const [eigeneSchriften, setzeEigeneSchriften] = useState<
    { datei: string; familie: string }[]
  >([]);

  const ladeSchriften = useCallback(async () => {
    setzeEigeneSchriften(
      await api.hole<{ datei: string; familie: string }[]>('/api/admin/schriften').catch(() => []),
    );
  }, []);

  useEffect(() => {
    void ladeSchriften();
  }, [ladeSchriften]);

  useEffect(() => {
    if (eigeneSchriften.length === 0) return;
    const stil = document.createElement('style');
    stil.textContent = eigeneSchriften
      .map(
        (s) =>
          `@font-face { font-family: ${JSON.stringify(s.familie)};` +
          ` src: url("/api/admin/schriften/${encodeURIComponent(s.datei)}"); font-display: block; }`,
      )
      .join('\n');
    document.head.appendChild(stil);
    return () => stil.remove();
  }, [eigeneSchriften]);

  const fotoAnzahl = entwurf.ebenen.filter((e) => e.typ === 'foto').length;

  return (
    <>
      <div className="zeile" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ marginTop: 0 }}>
          Vorlage bearbeiten{' '}
          {!gespeichert && <span className="marke">ungespeichert</span>}
        </h1>
        <div className="zeile">
          <button className="knopf knopf--haupt" onClick={() => void speichern()}>
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
      {meldung && <div className="hinweis-fest">{meldung}</div>}

      {/*
        Zweispalter: Leinwand links, Ebenen und Eigenschaften rechts.
        Vorher stand die Leinwandkarte auf "inline-block" und wuchs damit auf
        die Maximalbreite ihres Hilfetextes - rund 1200 px. Fuer die rechte
        Spalte blieb nichts uebrig, sie rutschte unter die Leinwand, und man
        scrollte zwischen Bild und Eigenschaften hin und her. Ein Raster mit
        fester Spaltenbreite kann das nicht passieren.
      */}
      <div className="editor">
        <div className="editor__leinwand">
          <div className="karte">
            <Werkzeugleiste
              aktiv={ebene !== null}
              mehrereFotos={fotoAnzahl >= 3}
              beiAusrichten={ausrichten}
              beiVerteilen={verteilen}
              beiDuplizieren={dupliziere}
              beiEntfernen={() => gewaehlt && entferne(gewaehlt)}
              beiRueckgaengig={rueckgaengig}
              rueckgaengigMoeglich={verlauf.current.length > 0}
            />
            <Leinwand
              ebenen={entwurf.ebenen}
              breiteMm={entwurf.canvas.breiteMm}
              hoeheMm={entwurf.canvas.hoeheMm}
              hintergrund={entwurf.hintergrundFarbe ?? '#ffffff'}
              gewaehlt={gewaehlt}
              beiWahl={setzeGewaehlt}
              beiAenderung={aendere}
              beiAbschluss={schliesseZugAb}
            />
            <p className="editor__hilfe">
              {entwurf.canvas.breiteMm} × {entwurf.canvas.hoeheMm} mm ·{' '}
              {fotoAnzahl === 1
                ? 'Eine Foto-Ebene, also ein Foto.'
                : `${fotoAnzahl} Foto-Ebenen bestimmen, dass ${fotoAnzahl} Fotos aufgenommen werden.`}
              <br />
              Ziehen zum Verschieben, Griffe für die Größe, Pfeiltasten fein (mit Umschalt gröber).
              Alt hält das Einrasten an. Strg+D dupliziert, Entf löscht, Strg+Z macht rückgängig.
            </p>
          </div>
        </div>

        <div className="editor__spalte">
          <div className="karte">
            <h2>Grunddaten</h2>
            <div className="zeile">
              <div className="feld" style={{ flex: 1 }}>
                <label>Name</label>
                <input
                  value={entwurf.name}
                  onChange={(e) => {
                    setzeEntwurf({ ...entwurf, name: e.target.value });
                    setzeGespeichert(false);
                  }}
                />
              </div>
              <div className="feld feld--klein">
                <label>Format</label>
                <select
                  value={entwurf.canvas.preset}
                  onChange={(e) => wechsleFormat(e.target.value)}
                >
                  <option value="10x15-quer">10 × 15 quer</option>
                  <option value="10x15-hoch">10 × 15 hoch</option>
                </select>
              </div>
              <div className="feld feld--klein">
                <label>Hintergrund</label>
                <input
                  type="color"
                  value={entwurf.hintergrundFarbe ?? '#ffffff'}
                  onChange={(e) => {
                    setzeEntwurf({ ...entwurf, hintergrundFarbe: e.target.value });
                    setzeGespeichert(false);
                  }}
                />
              </div>
            </div>
          </div>

          <Ebenenliste
            ebenen={entwurf.ebenen}
            gewaehlt={gewaehlt}
            beiWahl={setzeGewaehlt}
            beiEinfuegen={fuegeEin}
            beiBildDatei={bildHochladen}
            beiBewegen={bewege}
            beiAendern={(id, teil) => {
              aendere(id, teil);
              schliesseZugAb();
            }}
            beiEntfernen={entferne}
          />

          {ebene && (
            <EbenenFelder
              ebene={ebene}
              canvas={entwurf.canvas}
              eigeneSchriften={eigeneSchriften}
              beiSchriftDatei={async (datei) => {
                try {
                  const neu = await api.sendeDatei<{ datei: string; familie: string }>(
                    '/api/admin/schriften',
                    datei,
                  );
                  await ladeSchriften();
                  aendere(ebene.id, { schrift: neu.familie, schriftDatei: neu.datei });
                  schliesseZugAb();
                  beiMeldung(`Schrift "${neu.familie}" hinzugefügt.`);
                } catch (fehler) {
                  beiMeldung(fehler instanceof Error ? fehler.message : 'Schrift ging nicht.');
                }
              }}
              beiAendern={(teil) => {
                aendere(ebene.id, teil);
                schliesseZugAb();
              }}
            />
          )}
        </div>
      </div>
    </>
  );

  function wechsleFormat(preset: string) {
    merkeVorZug();
    setzeEntwurf({
      ...entwurf,
      canvas:
        preset === '10x15-quer'
          ? { preset, breiteMm: 152.4, hoeheMm: 101.6 }
          : { preset, breiteMm: 101.6, hoeheMm: 152.4 },
    });
    schliesseZugAb();
  }

  function fuegeEin(typ: 'foto' | 'text') {
    merkeVorZug();
    const fotoAnzahl = entwurf.ebenen.filter((e) => e.typ === 'foto').length;
    const neu: Ebene =
      typ === 'foto'
        ? {
            id: kennung(),
            typ: 'foto',
            index: fotoAnzahl + 1,
            x: 0.1,
            y: 0.1,
            w: 0.4,
            h: 0.5,
            einpassung: 'cover',
          }
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
    schliesseZugAb();
  }

  async function bildHochladen(datei: File) {
    let name: string;
    try {
      ({ datei: name } = await api.sendeDatei<{ datei: string }>(
        '/api/admin/vorlagen/bild',
        datei,
      ));
    } catch (fehler) {
      beiMeldung(fehler instanceof Error ? fehler.message : 'Bild konnte nicht hochgeladen werden.');
      return;
    }
    merkeVorZug();
    // Neue Bilder kommen ganz nach unten in den Stapel - das ist fast immer
    // ein Hintergrund. Nach oben schieben geht mit einem Klick.
    const neu: Ebene = { id: kennung(), typ: 'bild', datei: name, x: 0, y: 0, w: 1, h: 1 };
    setzeEntwurf({ ...entwurf, ebenen: [neu, ...entwurf.ebenen] });
    setzeGewaehlt(neu.id);
    schliesseZugAb();
    beiMeldung('Bild eingefügt — liegt ganz unten im Stapel.');
  }

  function dupliziere() {
    if (!ebene) return;
    merkeVorZug();
    const kopie: Ebene = {
      ...ebene,
      id: kennung(),
      x: ebene.x + 0.02,
      y: ebene.y + 0.02,
      ...(ebene.typ === 'foto'
        ? { index: entwurf.ebenen.filter((e) => e.typ === 'foto').length + 1 }
        : {}),
    };
    setzeEntwurf({ ...entwurf, ebenen: [...entwurf.ebenen, kopie] });
    setzeGewaehlt(kopie.id);
    schliesseZugAb();
  }

  function entferne(id: string) {
    merkeVorZug();
    const uebrig = entwurf.ebenen.filter((e) => e.id !== id);
    // Foto-Ebenen luecklos neu nummerieren, sonst fehlt in der Aufnahme ein Schritt.
    let zaehler = 0;
    const neu = uebrig.map((e) => (e.typ === 'foto' ? { ...e, index: ++zaehler } : e));
    setzeEntwurf({ ...entwurf, ebenen: neu });
    if (gewaehlt === id) setzeGewaehlt(null);
    schliesseZugAb();
  }

  function bewege(id: string, richtung: number) {
    merkeVorZug();
    const liste = [...entwurf.ebenen];
    const i = liste.findIndex((e) => e.id === id);
    const ziel = i + richtung;
    if (i < 0 || ziel < 0 || ziel >= liste.length) return;
    [liste[i], liste[ziel]] = [liste[ziel]!, liste[i]!];
    setzeEntwurf({ ...entwurf, ebenen: liste });
    schliesseZugAb();
  }

  function ausrichten(wohin: Ausrichtung) {
    if (!ebene) return;
    merkeVorZug();
    aendere(ebene.id, richteAus(ebene, wohin));
    schliesseZugAb();
  }

  function verteilen(achse: 'x' | 'y') {
    merkeVorZug();
    const fotos = entwurf.ebenen.filter((e) => e.typ === 'foto');
    const verteilt = verteile(fotos, achse);
    const nachId = new Map(verteilt.map((e) => [e.id, e]));
    setzeEntwurf({
      ...entwurf,
      ebenen: entwurf.ebenen.map((e) => nachId.get(e.id) ?? e),
    });
    schliesseZugAb();
  }

  async function speichern() {
    const gespeichertVorlage = await api.aendere<Vorlage>('/api/admin/vorlagen', {
      id: entwurf.id || undefined,
      name: entwurf.name,
      preset: entwurf.canvas.preset,
      hintergrundFarbe: entwurf.hintergrundFarbe,
      ebenen: entwurf.ebenen,
    });
    setzeEntwurf(gespeichertVorlage);
    setzeGespeichert(true);
    beiMeldung('Vorlage gespeichert.');
  }

  async function testdruck() {
    if (!gespeichert) {
      beiMeldung('Bitte erst speichern — sonst druckt der Testdruck den alten Stand.');
      return;
    }
    await api.sende(`/api/admin/vorlagen/${entwurf.id}/testdruck`, {});
    beiMeldung('Testdruck in der Warteschlange. Er zählt nicht in den Auslagenersatz.');
  }
}

function Werkzeugleiste({
  aktiv,
  mehrereFotos,
  beiAusrichten,
  beiVerteilen,
  beiDuplizieren,
  beiEntfernen,
  beiRueckgaengig,
  rueckgaengigMoeglich,
}: {
  aktiv: boolean;
  mehrereFotos: boolean;
  beiAusrichten: (wohin: Ausrichtung) => void;
  beiVerteilen: (achse: 'x' | 'y') => void;
  beiDuplizieren: () => void;
  beiEntfernen: () => void;
  beiRueckgaengig: () => void;
  rueckgaengigMoeglich: boolean;
}) {
  const knopf = (titel: string, zeichen: string, tun: () => void, an = aktiv) => (
    <button
      className="knopf knopf--neben"
      title={titel}
      onClick={tun}
      disabled={!an}
      style={{ minWidth: '2.1rem', padding: '0 0.4rem' }}
    >
      {zeichen}
    </button>
  );

  return (
    <div className="zeile" style={{ gap: '0.3rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
      {knopf('Links ausrichten', '⇤', () => beiAusrichten('links'))}
      {knopf('Waagerecht zentrieren', '⇹', () => beiAusrichten('mitte-x'))}
      {knopf('Rechts ausrichten', '⇥', () => beiAusrichten('rechts'))}
      <span style={{ width: '0.5rem' }} />
      {knopf('Oben ausrichten', '⤒', () => beiAusrichten('oben'))}
      {knopf('Senkrecht zentrieren', '⇳', () => beiAusrichten('mitte-y'))}
      {knopf('Unten ausrichten', '⤓', () => beiAusrichten('unten'))}
      <span style={{ width: '0.5rem' }} />
      {knopf('Fotos waagerecht gleichmäßig verteilen', '⇿', () => beiVerteilen('x'), mehrereFotos)}
      {knopf('Fotos senkrecht gleichmäßig verteilen', '↕', () => beiVerteilen('y'), mehrereFotos)}
      <span style={{ width: '0.5rem' }} />
      {knopf('Duplizieren (Strg+D)', '⧉', beiDuplizieren)}
      {knopf('Löschen (Entf)', '🗑', beiEntfernen)}
      {knopf('Rückgängig (Strg+Z)', '↶', beiRueckgaengig, rueckgaengigMoeglich)}
    </div>
  );
}

function Ebenenliste({
  ebenen,
  gewaehlt,
  beiWahl,
  beiEinfuegen,
  beiBildDatei,
  beiBewegen,
  beiAendern,
  beiEntfernen,
}: {
  ebenen: Ebene[];
  gewaehlt: string | null;
  beiWahl: (id: string) => void;
  beiEinfuegen: (typ: 'foto' | 'text') => void;
  beiBildDatei: (datei: File) => void;
  beiBewegen: (id: string, richtung: number) => void;
  beiAendern: (id: string, teil: Partial<Ebene>) => void;
  beiEntfernen: (id: string) => void;
}) {
  return (
    <div className="karte">
      <div className="zeile" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Ebenen</h2>
        <div className="zeile" style={{ gap: '0.3rem' }}>
          <button className="knopf knopf--neben" onClick={() => beiEinfuegen('foto')}>
            + Foto
          </button>
          <button className="knopf knopf--neben" onClick={() => beiEinfuegen('text')}>
            + Text
          </button>
          <label className="knopf knopf--neben" style={{ cursor: 'pointer' }}>
            + Bild aus Datei
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const datei = e.target.files?.[0];
                if (datei) void beiBildDatei(datei);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>
      <p style={{ fontSize: '0.72rem', color: 'var(--schrift-leise)', margin: '0.4rem 0 0' }}>
        Oben in der Liste liegt vorne. Ein Zierrahmen kann so über einem Foto und gleichzeitig unter
        dem Logo liegen.
      </p>

      <table className="liste" style={{ marginTop: '0.5rem' }}>
        <tbody>
          {[...ebenen].reverse().map((ebene) => (
            <tr
              key={ebene.id}
              onClick={() => beiWahl(ebene.id)}
              style={{
                background: gewaehlt === ebene.id ? 'var(--flaeche-hell)' : undefined,
                cursor: 'pointer',
              }}
            >
              <td style={{ width: '1.4rem' }}>
                {ebene.typ === 'foto' ? '📷' : ebene.typ === 'text' ? 'T' : '🖼'}
              </td>
              <td>
                <div className="ebenen-name">
                  {ebene.typ === 'foto'
                    ? `Foto ${ebene.index}`
                    : ebene.typ === 'text'
                      ? (ebene.text ?? '')
                      : (ebene.datei ?? '')}
                </div>
              </td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button
                  className="ebenen-knopf"
                  title="nach vorne"
                  onClick={(e) => {
                    e.stopPropagation();
                    beiBewegen(ebene.id, 1);
                  }}
                >
                  ↑
                </button>
                <button
                  className="ebenen-knopf"
                  title="nach hinten"
                  onClick={(e) => {
                    e.stopPropagation();
                    beiBewegen(ebene.id, -1);
                  }}
                >
                  ↓
                </button>
                <button
                  className="ebenen-knopf"
                  title={ebene.sichtbar === false ? 'einblenden' : 'ausblenden'}
                  onClick={(e) => {
                    e.stopPropagation();
                    beiAendern(ebene.id, { sichtbar: ebene.sichtbar === false });
                  }}
                >
                  {ebene.sichtbar === false ? '🚫' : '👁'}
                </button>
                <button
                  className="ebenen-knopf"
                  title={ebene.gesperrt ? 'entsperren' : 'sperren'}
                  onClick={(e) => {
                    e.stopPropagation();
                    beiAendern(ebene.id, { gesperrt: !ebene.gesperrt });
                  }}
                >
                  {ebene.gesperrt ? '🔒' : '🔓'}
                </button>
                <button
                  className="ebenen-knopf"
                  title="löschen"
                  onClick={(e) => {
                    e.stopPropagation();
                    beiEntfernen(ebene.id);
                  }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          {ebenen.length === 0 && (
            <tr>
              <td colSpan={3} style={{ color: 'var(--schrift-leise)' }}>
                Noch keine Ebene. Beginne mit einem Bild aus Canva oder einer Foto-Ebene.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Zahlenfelder in Millimetern - beim Druck denkt man in Millimetern. */
function EbenenFelder({
  ebene,
  canvas,
  eigeneSchriften,
  beiSchriftDatei,
  beiAendern,
}: {
  ebene: Ebene;
  canvas: { breiteMm: number; hoeheMm: number };
  eigeneSchriften: { datei: string; familie: string }[];
  beiSchriftDatei: (datei: File) => void;
  beiAendern: (teil: Partial<Ebene>) => void;
}) {
  const feldMm = (
    name: 'x' | 'y' | 'w' | 'h',
    beschriftung: string,
    bezug: number,
  ) => (
    <div className="feld feld--klein" key={name}>
      <label>{beschriftung}</label>
      <input
        type="number"
        step={0.5}
        value={Number(((ebene[name] ?? 0) * bezug).toFixed(1))}
        onChange={(e) => beiAendern({ [name]: Number(e.target.value) / bezug } as Partial<Ebene>)}
      />
    </div>
  );

  return (
    <div className="karte">
      <h2>
        Ausgewählte Ebene —{' '}
        {ebene.typ === 'foto' ? `Foto ${ebene.index}` : ebene.typ === 'text' ? 'Text' : 'Bild'}
      </h2>
      <div className="zeile">
        {feldMm('x', 'Links (mm)', canvas.breiteMm)}
        {feldMm('y', 'Oben (mm)', canvas.hoeheMm)}
        {feldMm('w', 'Breite (mm)', canvas.breiteMm)}
        {feldMm('h', 'Höhe (mm)', canvas.hoeheMm)}
        <div className="feld feld--klein">
          <label>Drehung (Grad)</label>
          <input
            type="number"
            step={1}
            value={ebene.rotation ?? 0}
            onChange={(e) => beiAendern({ rotation: Number(e.target.value) })}
          />
        </div>
      </div>

      {ebene.typ === 'text' && (
        <div className="zeile">
          <div className="feld" style={{ flex: 1 }}>
            <label>Text — Platzhalter: {'{veranstaltung} {datum} {uhrzeit} {nummer}'}</label>
            <input value={ebene.text ?? ''} onChange={(e) => beiAendern({ text: e.target.value })} />
          </div>
          <div className="feld feld--klein">
            <label>Schriftgröße (mm)</label>
            <input
              type="number"
              step={0.5}
              value={Number(((ebene.groesse ?? 0.06) * canvas.hoeheMm).toFixed(1))}
              onChange={(e) => beiAendern({ groesse: Number(e.target.value) / canvas.hoeheMm })}
            />
          </div>
          <div className="feld feld--klein">
            <label>Farbe</label>
            <input
              type="color"
              value={ebene.farbe ?? '#333333'}
              onChange={(e) => beiAendern({ farbe: e.target.value })}
            />
          </div>
          <div className="feld feld--klein">
            <label>Ausrichtung</label>
            <select
              value={ebene.ausrichtung ?? 'mitte'}
              onChange={(e) => beiAendern({ ausrichtung: e.target.value })}
            >
              <option value="links">links</option>
              <option value="mitte">mittig</option>
              <option value="rechts">rechts</option>
            </select>
          </div>
        </div>
      )}

      {ebene.typ === 'text' && (
        <div className="zeile">
          <div className="feld" style={{ flex: 1, maxWidth: '18rem' }}>
            <label htmlFor="schriftwahl">Schriftart</label>
            {/*
              Jeder Eintrag wird in seiner eigenen Schrift angezeigt - eine
              Liste aus Namen in Einheitsschrift zwingt sonst zum Durchprobieren.
            */}
            <select
              id="schriftwahl"
              value={ebene.schrift ?? ''}
              style={{ fontFamily: ebene.schrift || undefined, fontSize: '1rem' }}
              onChange={(e) => {
                const familie = e.target.value;
                const eigene = eigeneSchriften.find((s) => s.familie === familie);
                beiAendern({
                  schrift: familie || undefined,
                  // Nur eigene Schriften haengen an einer Datei; der
                  // Startbereit-Check prueft damit, ob sie noch da ist.
                  schriftDatei: eigene ? eigene.datei : undefined,
                });
              }}
            >
              <option value="">Vorgabe</option>
              {SCHRIFTEN.map((s) => (
                <option key={s.name} value={s.familie} style={{ fontFamily: s.familie }}>
                  {s.name}
                </option>
              ))}
              {eigeneSchriften.length > 0 && (
                <optgroup label="Eigene Schriften">
                  {eigeneSchriften.map((s) => (
                    <option key={s.datei} value={s.familie} style={{ fontFamily: s.familie }}>
                      {s.familie}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          <label className="knopf knopf--neben" style={{ cursor: 'pointer' }}>
            Schriftdatei hinzufügen
            <input
              type="file"
              accept=".ttf,.otf,font/ttf,font/otf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const datei = e.target.files?.[0];
                if (datei) void beiSchriftDatei(datei);
                e.target.value = '';
              }}
            />
          </label>
          <span style={{ fontSize: '0.74rem', color: 'var(--schrift-leise)', maxWidth: '20rem' }}>
            TTF oder OTF. Die Schrift landet in <code>Fotobox-Daten/schriften</code> und steht
            danach in allen Vorlagen zur Verfügung — auch im Ausdruck.
          </span>
        </div>
      )}

      {ebene.typ === 'foto' && (
        <div className="zeile">
          <div className="feld feld--klein">
            <label>Aufnahmereihenfolge</label>
            <input
              type="number"
              min={1}
              step={1}
              value={ebene.index ?? 1}
              onChange={(e) => beiAendern({ index: Number(e.target.value) })}
            />
          </div>
          <div className="feld feld--klein">
            <label>Einpassung</label>
            <select
              value={ebene.einpassung ?? 'cover'}
              onChange={(e) => beiAendern({ einpassung: e.target.value })}
            >
              <option value="cover">füllend (beschneidet)</option>
              <option value="contain">vollständig (lässt Rand)</option>
            </select>
          </div>
          <div className="feld feld--klein">
            <label>Ecken abrunden (mm)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              value={Number(((ebene.radius ?? 0) * Math.min(canvas.breiteMm, canvas.hoeheMm)).toFixed(1))}
              onChange={(e) =>
                beiAendern({
                  radius: Number(e.target.value) / Math.min(canvas.breiteMm, canvas.hoeheMm),
                })
              }
            />
          </div>
        </div>
      )}

      {ebene.typ === 'bild' && (
        <div className="zeile">
          <div className="feld feld--klein">
            <label>Deckkraft (%)</label>
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={Math.round((ebene.deckkraft ?? 1) * 100)}
              onChange={(e) => beiAendern({ deckkraft: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="feld" style={{ flex: 1 }}>
            <label>Datei</label>
            <input value={ebene.datei ?? ''} readOnly />
          </div>
        </div>
      )}
    </div>
  );
}

function kennung(): string {
  return Math.random().toString(36).slice(2, 10);
}
