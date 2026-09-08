import { useEffect, useRef, useState } from 'react';
import { begrenze, raste, type Rechteck } from './einrasten.js';
import type { Ebene } from './typen.js';

type Griff = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const GRIFFE: { name: Griff; links: string; oben: string; cursor: string }[] = [
  { name: 'nw', links: '0%', oben: '0%', cursor: 'nwse-resize' },
  { name: 'n', links: '50%', oben: '0%', cursor: 'ns-resize' },
  { name: 'ne', links: '100%', oben: '0%', cursor: 'nesw-resize' },
  { name: 'e', links: '100%', oben: '50%', cursor: 'ew-resize' },
  { name: 'se', links: '100%', oben: '100%', cursor: 'nwse-resize' },
  { name: 's', links: '50%', oben: '100%', cursor: 'ns-resize' },
  { name: 'sw', links: '0%', oben: '100%', cursor: 'nesw-resize' },
  { name: 'w', links: '0%', oben: '50%', cursor: 'ew-resize' },
];

/**
 * Die Arbeitsflaeche des Vorlagen-Editors.
 *
 * Ebenen lassen sich ziehen und an acht Griffen in der Groesse aendern. Beim
 * Bewegen rasten Kanten und Mitten an der Leinwand und an anderen Ebenen ein;
 * eine Hilfslinie zeigt, woran gerade ausgerichtet wird. Wer frei platzieren
 * will, haelt Alt gedrueckt.
 *
 * Bild- und Textebenen werden echt dargestellt, Foto-Ebenen als nummerierte
 * Platzhalter - so sieht man beim Gestalten, was spaeter herauskommt.
 */
export function Leinwand({
  ebenen,
  breiteMm,
  hoeheMm,
  hintergrund,
  gewaehlt,
  beiWahl,
  beiAenderung,
  beiAbschluss,
}: {
  ebenen: Ebene[];
  breiteMm: number;
  hoeheMm: number;
  hintergrund: string;
  gewaehlt: string | null;
  beiWahl: (id: string | null) => void;
  beiAenderung: (id: string, teil: Partial<Ebene>) => void;
  /** Wird am Ende einer Geste gerufen, damit "Rueckgaengig" ganze Zuege kennt. */
  beiAbschluss: () => void;
}) {
  const flaeche = useRef<HTMLDivElement>(null);
  const [hilfslinien, setzeHilfslinien] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const geste = useRef<{
    art: 'ziehen' | 'groesse';
    griff?: Griff;
    startX: number;
    startY: number;
    ausgang: Rechteck;
    frei: boolean;
  } | null>(null);

  /*
   * Anzeigegroesse. Vorher stand die lange Kante fest auf 620 px - auf einem
   * Bildschirm mit Platz blieb daneben und darunter eine leere Flaeche, obwohl
   * man beim Gestalten jeden Pixel gebrauchen kann. Jetzt fuellt die Leinwand,
   * was die Spalte hergibt, ohne dabei aus dem Fenster zu laufen.
   */
  const huelle = useRef<HTMLDivElement>(null);
  const [platz, setzePlatz] = useState({ breite: 620, hoehe: 900 });

  useEffect(() => {
    const messe = () => {
      const kasten = huelle.current?.getBoundingClientRect();
      if (!kasten) return;
      setzePlatz({
        breite: Math.max(280, kasten.width),
        // Was unter der Leinwand noch fuer Werkzeugleiste und Hilfetext bleibt.
        hoehe: Math.max(220, window.innerHeight - kasten.top - 120),
      });
    };
    messe();
    const beobachter = new ResizeObserver(messe);
    if (huelle.current) beobachter.observe(huelle.current);
    window.addEventListener('resize', messe);
    return () => {
      beobachter.disconnect();
      window.removeEventListener('resize', messe);
    };
  }, []);

  const verhaeltnis = breiteMm / hoeheMm;
  let breite = platz.breite;
  let hoehe = breite / verhaeltnis;
  if (hoehe > platz.hoehe) {
    hoehe = platz.hoehe;
    breite = hoehe * verhaeltnis;
  }

  useEffect(() => {
    const beiBewegung = (e: PointerEvent) => {
      const g = geste.current;
      const kasten = flaeche.current?.getBoundingClientRect();
      if (!g || !kasten || !gewaehlt) return;

      const dx = (e.clientX - g.startX) / kasten.width;
      const dy = (e.clientY - g.startY) / kasten.height;
      const frei = g.frei || e.altKey;

      let neu: Rechteck =
        g.art === 'ziehen'
          ? { ...g.ausgang, x: g.ausgang.x + dx, y: g.ausgang.y + dy }
          : groesseAendern(g.ausgang, g.griff!, dx, dy);
      neu = begrenze(neu);

      if (!frei) {
        const andere = ebenen.filter((l) => l.id !== gewaehlt);
        const gerastet = raste(neu, andere, 8 / kasten.width);
        // Beim Ziehen wandert die ganze Ebene, beim Groessenaendern nur die
        // angefasste Kante - sonst springt die gegenueberliegende Seite mit.
        if (g.art === 'ziehen') {
          neu = { ...neu, x: gerastet.x, y: gerastet.y };
        }
        setzeHilfslinien({ x: gerastet.hilfslinienX, y: gerastet.hilfslinienY });
      } else {
        setzeHilfslinien({ x: [], y: [] });
      }

      beiAenderung(gewaehlt, neu);
    };

    const beiEnde = () => {
      if (!geste.current) return;
      geste.current = null;
      setzeHilfslinien({ x: [], y: [] });
      beiAbschluss();
    };

    window.addEventListener('pointermove', beiBewegung);
    window.addEventListener('pointerup', beiEnde);
    return () => {
      window.removeEventListener('pointermove', beiBewegung);
      window.removeEventListener('pointerup', beiEnde);
    };
  }, [ebenen, gewaehlt, beiAenderung, beiAbschluss]);

  return (
    <div ref={huelle} style={{ width: '100%' }}>
    <div
      ref={flaeche}
      onPointerDown={(e) => {
        if (e.target === flaeche.current) beiWahl(null);
      }}
      style={{
        position: 'relative',
        width: breite,
        height: hoehe,
        background: hintergrund,
        borderRadius: '0.3rem',
        overflow: 'hidden',
        boxShadow: '0 0 0 1px var(--flaeche-hell)',
        touchAction: 'none',
        // Ohne das markiert der Browser beim Ziehen die Platzhaltertexte.
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {ebenen.map((ebene) => {
        const ausgewaehlt = ebene.id === gewaehlt;
        return (
          <div
            key={ebene.id}
            onPointerDown={(e) => {
              if (ebene.gesperrt) return;
              e.stopPropagation();
              beiWahl(ebene.id);
              geste.current = {
                art: 'ziehen',
                startX: e.clientX,
                startY: e.clientY,
                ausgang: { x: ebene.x, y: ebene.y, w: ebene.w, h: ebene.h },
                frei: e.altKey,
              };
            }}
            style={{
              position: 'absolute',
              left: `${ebene.x * 100}%`,
              top: `${ebene.y * 100}%`,
              width: `${ebene.w * 100}%`,
              height: `${ebene.h * 100}%`,
              opacity: ebene.sichtbar === false ? 0.25 : 1,
              cursor: ebene.gesperrt ? 'not-allowed' : 'move',
              outline: ausgewaehlt ? '2px solid var(--akzent)' : '1px dashed rgba(0,0,0,0.35)',
              outlineOffset: 0,
              transform: ebene.rotation ? `rotate(${ebene.rotation}deg)` : undefined,
            }}
          >
            <Inhalt ebene={ebene} hoehePx={hoehe} />
            {ausgewaehlt &&
              !ebene.gesperrt &&
              GRIFFE.map((griff) => (
                <div
                  key={griff.name}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    geste.current = {
                      art: 'groesse',
                      griff: griff.name,
                      startX: e.clientX,
                      startY: e.clientY,
                      ausgang: { x: ebene.x, y: ebene.y, w: ebene.w, h: ebene.h },
                      frei: e.altKey,
                    };
                  }}
                  style={{
                    position: 'absolute',
                    left: griff.links,
                    top: griff.oben,
                    width: 11,
                    height: 11,
                    marginLeft: -5.5,
                    marginTop: -5.5,
                    background: 'var(--akzent)',
                    border: '1px solid #1a1a1a',
                    borderRadius: 2,
                    cursor: griff.cursor,
                  }}
                />
              ))}
          </div>
        );
      })}

      {hilfslinien.x.map((wert, i) => (
        <div
          key={`x${i}`}
          style={{
            position: 'absolute',
            left: `${wert * 100}%`,
            top: 0,
            bottom: 0,
            width: 1,
            background: '#e0483f',
            pointerEvents: 'none',
          }}
        />
      ))}
      {hilfslinien.y.map((wert, i) => (
        <div
          key={`y${i}`}
          style={{
            position: 'absolute',
            top: `${wert * 100}%`,
            left: 0,
            right: 0,
            height: 1,
            background: '#e0483f',
            pointerEvents: 'none',
          }}
        />
      ))}
    </div>
    </div>
  );
}

/** Bild- und Textebenen echt darstellen, Foto-Ebenen als Platzhalter. */
function Inhalt({ ebene, hoehePx }: { ebene: Ebene; hoehePx: number }) {
  if (ebene.typ === 'bild') {
    return (
      <img
        src={`/medien/vorlage/${encodeURIComponent(ebene.datei ?? '')}`}
        alt=""
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block', pointerEvents: 'none' }}
      />
    );
  }

  if (ebene.typ === 'text') {
    const ausrichtung =
      ebene.ausrichtung === 'links' ? 'flex-start' : ebene.ausrichtung === 'rechts' ? 'flex-end' : 'center';
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: ausrichtung,
          color: ebene.farbe ?? '#333',
          fontSize: (ebene.groesse ?? 0.06) * hoehePx,
          lineHeight: 1.15,
          whiteSpace: 'pre',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {ebene.text}
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'repeating-linear-gradient(45deg,#8fb0cc,#8fb0cc 10px,#7fa3c2 10px,#7fa3c2 20px)',
        color: 'rgba(18,35,58,0.75)',
        fontWeight: 700,
        // Gross genug zum Erkennen, aber gedeckelt: Eine formatfuellende
        // Foto-Ebene soll die Flaeche nicht mit einer Riesenziffer zupflastern.
        fontSize: Math.min(64, Math.max(14, hoehePx * ebene.h * 0.3)),
        pointerEvents: 'none',
      }}
    >
      {ebene.index}
    </div>
  );
}

function groesseAendern(ausgang: Rechteck, griff: Griff, dx: number, dy: number): Rechteck {
  let { x, y, w, h } = ausgang;
  if (griff.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (griff.includes('e')) w += dx;
  if (griff.includes('n')) {
    y += dy;
    h -= dy;
  }
  if (griff.includes('s')) h += dy;
  return { x, y, w, h };
}
