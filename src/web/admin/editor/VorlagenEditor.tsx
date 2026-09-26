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
  // Beim Laden luecklos nummerieren: Aeltere Vorlagen konnten Luecken oder
  // doppelte Nummern haben, die im Editor nicht auffielen.
  const [entwurf, setzeEntwurf] = useState<Vorlage>(() => ({
    ...vorlage,
    ebenen: nummeriereFotos(vorlage.ebenen),
  }));
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

  // Fenster schliessen oder neu laden mit ungespeicherter Arbeit: Der Browser fragt nach.
  useEffect(() => {
    if (gespeichert) return;
    const warnen = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [gespeichert]);

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

  const fotoAnzahl = entwurf.ebenen.filter((e) => e.typ === 'foto' && e.sichtbar !== false).length;
  const ausgeblendeteFotos = entwurf.ebenen.filter((e) => e.typ === 'foto' && e.sichtbar === false).length;

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
          <button
            className="knopf knopf--neben"
            onClick={() => {
              if (gespeichert || window.confirm('Die Änderungen sind nicht gespeichert. Trotzdem zurück?')) {
                beiSchliessen();
              }
            }}
          >
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
              {fotoAnzahl === 0 ? (
                <strong style={{ color: 'var(--warnung)' }}>
                  Noch keine sichtbare Foto-Ebene — mit dieser Vorlage würde kein Foto gemacht.
                </strong>
              ) : fotoAnzahl === 1 ? (
                'Eine Foto-Ebene, also ein Foto.'
              ) : (
                `${fotoAnzahl} Foto-Ebenen bestimmen, dass ${fotoAnzahl} Fotos aufgenommen werden.`
              )}
              {ausgeblendeteFotos > 0 &&
                ` Ausgeblendete Foto-Ebenen (${ausgeblendeteFotos}) bekommen kein Foto.`}
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
              fotoAnzahl={entwurf.ebenen.filter((e) => e.typ === 'foto').length}
              beiReihenfolge={(nummer) => tauscheReihenfolge(ebene.id, nummer)}
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
    // Die Ebenen behalten ihre Lage relativ zur Seite - aus einem breiten
    // Foto wird im Hochformat ein schmales. Das soll niemanden ueberraschen.
    if (
      entwurf.ebenen.length > 0 &&
      !window.confirm(
        'Beim Formatwechsel werden alle Ebenen auf das neue Format gestreckt. ' +
          'Rückgängig geht mit Strg+Z. Wechseln?',
      )
    ) {
      return;
    }
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
    // Jede neue Foto-Ebene ein Stueck versetzt - vorher lagen sie deckungsgleich
    // uebereinander, und man sah nur die oberste.
    const versatz = (fotoAnzahl % 6) * 0.05;
    const neu: Ebene =
      typ === 'foto'
        ? {
            id: kennung(),
            typ: 'foto',
            index: fotoAnzahl + 1,
            x: 0.1 + versatz,
            y: 0.1 + versatz,
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
    let masse: { breite: number; hoehe: number };
    try {
      const antwort = await api.sendeDatei<{ datei: string; breite: number; hoehe: number }>(
        '/api/admin/vorlagen/bild',
        datei,
      );
      name = antwort.datei;
      masse = { breite: antwort.breite, hoehe: antwort.hoehe };
    } catch (fehler) {
      beiMeldung(fehler instanceof Error ? fehler.message : 'Bild konnte nicht hochgeladen werden.');
      return;
    }
    merkeVorZug();
    // Neue Bilder kommen ganz nach unten in den Stapel - das ist fast immer
    // ein Hintergrund. Nach oben schieben geht mit einem Klick.
    const lage = bildLage(masse, entwurf.canvas);
    // Der Originalname der Datei als Anzeigename - gespeichert wird sie unter
    // einer Kennung, und "ea5b4f98-..." sagt in der Ebenenliste niemandem etwas.
    const neu: Ebene = {
      id: kennung(),
      typ: 'bild',
      datei: name,
      name: datei.name.slice(0, 100),
      ...lage.rechteck,
    };
    setzeEntwurf({ ...entwurf, ebenen: [neu, ...entwurf.ebenen] });
    setzeGewaehlt(neu.id);
    schliesseZugAb();
    beiMeldung(
      lage.formatfuellend
        ? 'Bild eingefügt — füllt die Seite und liegt ganz unten im Stapel.'
        : 'Bild eingefügt, unverzerrt in der Mitte — liegt ganz unten im Stapel.',
    );
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
    // Foto-Ebenen luecklos neu nummerieren - in ihrer bisherigen Reihenfolge,
    // nicht in der des Stapels.
    setzeEntwurf({ ...entwurf, ebenen: nummeriereFotos(entwurf.ebenen.filter((e) => e.id !== id)) });
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
    // Vorher blieb ein Fehler beim Speichern stumm: Der Knopf tat scheinbar
    // nichts, die Marke "ungespeichert" blieb, und niemand wusste, warum.
    try {
      const gespeichertVorlage = await api.aendere<Vorlage>('/api/admin/vorlagen', {
        id: entwurf.id || undefined,
        name: entwurf.name,
        preset: entwurf.canvas.preset,
        hintergrundFarbe: entwurf.hintergrundFarbe,
        ebenen: entwurf.ebenen,
      });
      setzeEntwurf(gespeichertVorlage);
      setzeGespeichert(true);
      beiMeldung(
        fotoAnzahl === 0
          ? 'Gespeichert — aber ohne sichtbare Foto-Ebene. Der Kiosk bietet diese Vorlage nicht an.'
          : 'Vorlage gespeichert.',
      );
    } catch (fehler) {
      beiMeldung(`Nicht gespeichert: ${fehler instanceof Error ? fehler.message : 'unbekannter Fehler'}`);
    }
  }

  async function testdruck() {
    if (!gespeichert) {
      beiMeldung('Bitte erst speichern — sonst druckt der Testdruck den alten Stand.');
      return;
    }
    try {
      await api.sende(`/api/admin/vorlagen/${entwurf.id}/testdruck`, {});
      beiMeldung('Testdruck in der Warteschlange. Er zählt nicht in den Auslagenersatz.');
    } catch (fehler) {
      beiMeldung(`Testdruck ging nicht: ${fehler instanceof Error ? fehler.message : 'unbekannter Fehler'}`);
    }
  }

  /**
   * Aufnahmereihenfolge aendern, indem zwei Foto-Ebenen die Nummer tauschen.
   * Vorher war es ein freies Zahlenfeld: Zwei Ebenen mit der 2 oder eine 5 bei
   * drei Fotos liessen sich eintragen, ohne dass es auffiel.
   */
  function tauscheReihenfolge(id: string, nummer: number) {
    const bisher = entwurf.ebenen.find((e) => e.id === id)?.index;
    if (bisher === undefined || bisher === nummer) return;
    merkeVorZug();
    setzeEntwurf({
      ...entwurf,
      ebenen: entwurf.ebenen.map((e) =>
        e.typ !== 'foto' ? e : e.id === id ? { ...e, index: nummer } : e.index === nummer ? { ...e, index: bisher } : e,
      ),
    });
    schliesseZugAb();
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
                    ? `Foto ${ebene.index}${ebene.sichtbar === false ? ' — ausgeblendet, kein Foto' : ''}`
                    : ebene.typ === 'text'
                      ? (ebene.text ?? '')
                      : (ebene.name ?? ebene.datei ?? '')}
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
  fotoAnzahl,
  beiReihenfolge,
  canvas,
  eigeneSchriften,
  beiSchriftDatei,
  beiAendern,
}: {
  ebene: Ebene;
  fotoAnzahl: number;
  beiReihenfolge: (nummer: number) => void;
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
        min={name === 'w' || name === 'h' ? 1 : undefined}
        value={Number(((ebene[name] ?? 0) * bezug).toFixed(1))}
        onChange={(e) => {
          // Ein geleertes Feld ist "noch am Tippen", keine Null. Und Breite oder
          // Hoehe unter einem Millimeter ergibt keine Ebene mehr, die man sieht.
          if (e.target.value === '') return;
          const mm = Number(e.target.value);
          if (!Number.isFinite(mm) || ((name === 'w' || name === 'h') && mm < 1)) return;
          beiAendern({ [name]: mm / bezug } as Partial<Ebene>);
        }}
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
            min={-360}
            max={360}
            value={ebene.rotation ?? 0}
            onChange={(e) => {
              const grad = Number(e.target.value);
              if (Number.isFinite(grad)) beiAendern({ rotation: Math.max(-360, Math.min(360, grad)) });
            }}
          />
        </div>
      </div>

      {ebene.typ === 'text' && (
        <div className="zeile">
          <div className="feld" style={{ flex: 1 }}>
            <label>Text — Platzhalter: {'{veranstaltung} {datum} {uhrzeit} {nummer}'}</label>
            {/* Mehrzeilig: Der Druck kann Zeilenumbrueche, das Eingabefeld konnte sie nicht. */}
            <textarea
              rows={2}
              maxLength={500}
              value={ebene.text ?? ''}
              onChange={(e) => beiAendern({ text: e.target.value })}
            />
          </div>
          <div className="feld feld--klein">
            <label>Schriftgröße (mm)</label>
            <input
              type="number"
              step={0.5}
              min={1}
              value={Number(((ebene.groesse ?? 0.06) * canvas.hoeheMm).toFixed(1))}
              onChange={(e) => {
                const mm = Number(e.target.value);
                if (e.target.value !== '' && mm >= 1) beiAendern({ groesse: mm / canvas.hoeheMm });
              }}
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
            <label>Wird als … aufgenommen</label>
            <select value={ebene.index ?? 1} onChange={(e) => beiReihenfolge(Number(e.target.value))}>
              {Array.from({ length: fotoAnzahl }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}. Foto
                </option>
              ))}
            </select>
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
                  radius:
                    Math.max(0, Number(e.target.value) || 0) / Math.min(canvas.breiteMm, canvas.hoeheMm),
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
              onChange={(e) =>
                beiAendern({ deckkraft: Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100 })
              }
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

/**
 * Foto-Ebenen luecklos 1..n nummerieren, in ihrer bisherigen Reihenfolge
 * (gleiche Nummer: nach Stapel). Dieselbe Regel wie beim Druck, siehe
 * fotoEbenen() in den geteilten Typen.
 */
function nummeriereFotos(ebenen: Ebene[]): Ebene[] {
  const reihenfolge = ebenen
    .map((e, stapel) => ({ e, stapel }))
    .filter((x) => x.e.typ === 'foto')
    .sort((a, b) => (a.e.index ?? 99) - (b.e.index ?? 99) || a.stapel - b.stapel);
  const nummer = new Map(reihenfolge.map((x, i) => [x.e.id, i + 1]));
  return ebenen.map((e) => (e.typ === 'foto' ? { ...e, index: nummer.get(e.id)! } : e));
}

/**
 * Wo ein frisch eingefuegtes Bild landet. Vorher immer auf der ganzen Seite -
 * ein quadratisches Logo wurde dabei zum Querbalken verzerrt. Jetzt: Hat das
 * Bild (fast) das Seitenformat, fuellt es die Seite (der Canva-Export); sonst
 * steht es unverzerrt in der Mitte.
 */
function bildLage(
  bild: { breite: number; hoehe: number },
  canvas: { breiteMm: number; hoeheMm: number },
): { rechteck: { x: number; y: number; w: number; h: number }; formatfuellend: boolean } {
  const bildVerhaeltnis = bild.breite / bild.hoehe;
  const seitenVerhaeltnis = canvas.breiteMm / canvas.hoeheMm;
  if (Math.abs(bildVerhaeltnis / seitenVerhaeltnis - 1) < 0.03) {
    return { rechteck: { x: 0, y: 0, w: 1, h: 1 }, formatfuellend: true };
  }
  // In 80 % der Seite einpassen, Seitenverhaeltnis in Millimetern gerechnet.
  let breiteMm = canvas.breiteMm * 0.8;
  let hoeheMm = breiteMm / bildVerhaeltnis;
  if (hoeheMm > canvas.hoeheMm * 0.8) {
    hoeheMm = canvas.hoeheMm * 0.8;
    breiteMm = hoeheMm * bildVerhaeltnis;
  }
  const w = breiteMm / canvas.breiteMm;
  const h = hoeheMm / canvas.hoeheMm;
  return { rechteck: { x: (1 - w) / 2, y: (1 - h) / 2, w, h }, formatfuellend: false };
}

function kennung(): string {
  return Math.random().toString(36).slice(2, 10);
}
