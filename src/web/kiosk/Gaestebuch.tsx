import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useZeitgeber } from './zeitgeber.js';
import { SYMBOLE } from './symbole.js';

/** Die Schreibflaeche rechnet intern in dieser Groesse - unabhaengig vom Bildschirm. */
const BREITE = 1500;
const HOEHE = 1000;
const STRICH = 7;
/** Wer zwei Minuten nichts schreibt, ist gegangen - dann schliesst die Seite ohne zu speichern. */
const LEERLAUF_MS = 120_000;

const FARBEN = [
  { name: 'Tinte', wert: '#1d2b64' },
  { name: 'Schwarz', wert: '#1a1a1a' },
  { name: 'Gold', wert: '#b8862f' },
  { name: 'Rot', wert: '#b8323a' },
];

/** So gross steht ein Symbol auf der Schreibflaeche (Kantenlaenge, intern). */
const SYMBOL_GROESSE = 210;
/** Wo neue Symbole erscheinen - nacheinander versetzt, damit sie nicht aufeinander liegen. */
const SYMBOL_PLAETZE = [
  [0, 0],
  [230, -160],
  [-230, 160],
  [230, 160],
  [-230, -160],
  [0, -260],
  [0, 260],
  [460, 0],
  [-460, 0],
] as const;

interface Strich {
  art: 'strich';
  farbe: string;
  punkte: { x: number; y: number }[];
}

interface Stempel {
  art: 'symbol';
  symbol: number;
  farbe: string;
  /** Mittelpunkt auf der Schreibflaeche. */
  x: number;
  y: number;
}

type Element = Strich | Stempel;

/**
 * Gaestebuch: Nach dem Foto schreibt die Gruppe mit dem Finger einen Gruss.
 *
 * Gespeichert wird nur die Schrift (durchsichtiger Grund) - das Papier mit den
 * Linien ist reine Anzeige. Den Gruss bekommt nur der Gastgeber, im
 * Gaestebuch-PDF bei der Uebergabe; er erscheint weder in der Galerie noch in
 * der Diashow. Das steht auch auf der Seite, damit niemand fuer den ganzen
 * Saal zu schreiben glaubt.
 */
export function Gaestebuch({
  ausgabeId,
  mitSymbolen = false,
  beiGespeichert,
  beiAbbruch,
}: {
  ausgabeId: string;
  /** Symbole zum Einfuegen anbieten (Schalter in der Verwaltung). */
  mitSymbolen?: boolean;
  beiGespeichert: () => void;
  beiAbbruch: () => void;
}) {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const striche = useRef<Element[]>([]);
  const aktiv = useRef<Strich | null>(null);
  // Ein Symbol, das gerade mit dem Finger verschoben wird.
  const geschoben = useRef<{ stempel: Stempel; dx: number; dy: number } | null>(null);
  // Das zuletzt gesetzte oder verschobene Symbol bekommt einen Rahmen - nur
  // auf dem Bildschirm, nicht im gespeicherten Gruss.
  const [markiert, setzeMarkiert] = useState<{ x: number; y: number } | null>(null);
  const symbolPfade = useRef(SYMBOLE.map((s) => new Path2D(s.pfad)));
  // Es schreibt immer nur ein Finger. Ein zweiter (die Hand auf dem Glas, ein
  // Kind daneben) verwarf sonst den angefangenen Strich des ersten.
  const finger = useRef<number | null>(null);
  const [farbe, setzeFarbe] = useState(FARBEN[0]!.wert);
  const [anzahl, setzeAnzahl] = useState(0);
  const [beruehrt, setzeBeruehrt] = useState(0);
  const [speichert, setzeSpeichert] = useState(false);
  const [fehler, setzeFehler] = useState<string | null>(null);

  useZeitgeber(beiAbbruch, speichert ? null : LEERLAUF_MS, [beruehrt]);

  useEffect(() => zeichneAlles(), []);

  function kontext(): CanvasRenderingContext2D | null {
    const ctx = leinwand.current?.getContext('2d') ?? null;
    if (ctx) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = STRICH;
    }
    return ctx;
  }

  function zeichneStrich(ctx: CanvasRenderingContext2D, s: Strich) {
    const p = s.punkte;
    ctx.strokeStyle = s.farbe;
    ctx.fillStyle = s.farbe;
    if (p.length === 1) {
      // Ein Tipp ist ein Punkt - etwa der auf dem i.
      ctx.beginPath();
      ctx.arc(p[0]!.x, p[0]!.y, STRICH / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // Weich durch die Mittelpunkte - sonst wird jede Kurve eckig.
    ctx.beginPath();
    ctx.moveTo(p[0]!.x, p[0]!.y);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i]!.x + p[i + 1]!.x) / 2;
      const my = (p[i]!.y + p[i + 1]!.y) / 2;
      ctx.quadraticCurveTo(p[i]!.x, p[i]!.y, mx, my);
    }
    const letzter = p[p.length - 1]!;
    ctx.lineTo(letzter.x, letzter.y);
    ctx.stroke();
  }

  function zeichneStempel(ctx: CanvasRenderingContext2D, s: Stempel) {
    const pfad = symbolPfade.current[s.symbol];
    if (!pfad) return;
    const massstab = SYMBOL_GROESSE / 100;
    ctx.save();
    ctx.translate(s.x - SYMBOL_GROESSE / 2, s.y - SYMBOL_GROESSE / 2);
    ctx.scale(massstab, massstab);
    // Dieselbe Strichstaerke wie die Schrift - das Symbol soll aussehen wie
    // mit demselben Stift gemalt.
    ctx.lineWidth = STRICH / massstab;
    ctx.strokeStyle = s.farbe;
    ctx.stroke(pfad);
    ctx.restore();
  }

  function zeichneAlles() {
    const ctx = kontext();
    if (!ctx) return;
    ctx.clearRect(0, 0, BREITE, HOEHE);
    for (const e of striche.current) {
      if (e.art === 'strich') zeichneStrich(ctx, e);
      else zeichneStempel(ctx, e);
    }
  }

  /** Ein Symbol antippen: Es erscheint auf der Flaeche und laesst sich dann verschieben. */
  function setzeSymbol(symbol: number) {
    if (speichert) return;
    const schon = striche.current.filter((e) => e.art === 'symbol').length;
    const [dx, dy] = SYMBOL_PLAETZE[schon % SYMBOL_PLAETZE.length]!;
    const stempel: Stempel = { art: 'symbol', symbol, farbe, x: BREITE / 2 + dx, y: HOEHE / 2 + dy };
    striche.current.push(stempel);
    setzeAnzahl(striche.current.length);
    setzeMarkiert({ x: stempel.x, y: stempel.y });
    zeichneAlles();
  }

  /** Liegt dieser Punkt auf einem Symbol? Das oberste (zuletzt gesetzte) gewinnt. */
  function symbolUnter(p: { x: number; y: number }): Stempel | null {
    const halb = SYMBOL_GROESSE / 2;
    for (let i = striche.current.length - 1; i >= 0; i--) {
      const e = striche.current[i]!;
      if (e.art === 'symbol' && Math.abs(p.x - e.x) <= halb && Math.abs(p.y - e.y) <= halb) return e;
    }
    return null;
  }

  function punkt(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * BREITE, y: ((e.clientY - r.top) / r.height) * HOEHE };
  }

  function beginne(e: React.PointerEvent<HTMLCanvasElement>) {
    if (finger.current !== null || speichert) return;
    finger.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setzeBeruehrt((n) => n + 1);
    const p = punkt(e);
    // Auf einem Symbol angesetzt: verschieben statt schreiben.
    const stempel = symbolUnter(p);
    if (stempel) {
      geschoben.current = { stempel, dx: p.x - stempel.x, dy: p.y - stempel.y };
      setzeMarkiert({ x: stempel.x, y: stempel.y });
      return;
    }
    setzeMarkiert(null);
    aktiv.current = { art: 'strich', farbe, punkte: [p] };
    const ctx = kontext();
    if (ctx) zeichneStrich(ctx, aktiv.current);
  }

  function ziehe(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== finger.current) return;
    const schub = geschoben.current;
    if (schub) {
      const p = punkt(e);
      const halb = SYMBOL_GROESSE / 2;
      // Ganz auf der Flaeche halten - ein halb hinausgeschobenes Symbol fehlte sonst im Gruss.
      schub.stempel.x = Math.min(BREITE - halb, Math.max(halb, p.x - schub.dx));
      schub.stempel.y = Math.min(HOEHE - halb, Math.max(halb, p.y - schub.dy));
      setzeMarkiert({ x: schub.stempel.x, y: schub.stempel.y });
      zeichneAlles();
      return;
    }
    const s = aktiv.current;
    if (!s) return;
    const neu = punkt(e);
    const letzter = s.punkte[s.punkte.length - 1]!;
    // Kleinste Zitterbewegungen auslassen - sie machen die Linie nur krakelig.
    if (Math.hypot(neu.x - letzter.x, neu.y - letzter.y) < 2) return;
    s.punkte.push(neu);
    const ctx = kontext();
    if (!ctx) return;
    ctx.strokeStyle = s.farbe;
    ctx.beginPath();
    ctx.moveTo(letzter.x, letzter.y);
    ctx.lineTo(neu.x, neu.y);
    ctx.stroke();
  }

  function beende(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== finger.current) return;
    finger.current = null;
    if (geschoben.current) {
      geschoben.current = null;
      return;
    }
    if (!aktiv.current) return;
    striche.current.push(aktiv.current);
    aktiv.current = null;
    setzeAnzahl(striche.current.length);
    // Sauber neu zeichnen: Die schnellen Teilstuecke beim Ziehen sind eckiger
    // als die geglaettete Linie.
    zeichneAlles();
  }

  function rueckgaengig() {
    setzeMarkiert(null);
    striche.current.pop();
    setzeAnzahl(striche.current.length);
    zeichneAlles();
  }

  function leeren() {
    setzeMarkiert(null);
    striche.current = [];
    setzeAnzahl(0);
    zeichneAlles();
  }

  async function speichere() {
    const bild = leinwand.current?.toDataURL('image/png');
    if (!bild || striche.current.length === 0) return;
    setzeSpeichert(true);
    setzeFehler(null);
    try {
      await api.sende('/api/kiosk/gaestebuch', { ausgabeId, bild });
      beiGespeichert();
    } catch (u) {
      setzeFehler(u instanceof Error ? u.message : 'Das Speichern hat nicht geklappt.');
      setzeSpeichert(false);
    }
  }

  return (
    <div className="gaestebuch" onPointerDown={() => setzeBeruehrt((n) => n + 1)}>
      <div className="gaestebuch__kopf">
        <img className="gaestebuch__foto" src={`/medien/ausgabe/${ausgabeId}.jpg?klein=1`} alt="" />
        <div>
          <h1 className="gaestebuch__titel">Ein Gruß ins Gästebuch</h1>
          <p className="gaestebuch__unter">
            Mit dem Finger schreiben oder malen{mitSymbolen ? ' – Symbole antippen und mit dem Finger verschieben' : ''}.
            Das Gästebuch bekommt nur der Gastgeber – es erscheint in keiner Galerie.
          </p>
        </div>
      </div>

      <div className={`gaestebuch__flaeche${mitSymbolen ? ' gaestebuch__flaeche--symbole' : ''}`}>
        {mitSymbolen && (
          <div className="gaestebuch__symbole" aria-label="Symbole">
            {SYMBOLE.map((sym, i) => (
              <button
                key={sym.name}
                className="gaestebuch__symbol"
                // In der gewaehlten Farbe - so sieht man vorher, wie es aufs Papier kommt.
                style={{ color: farbe }}
                aria-label={sym.name}
                title={sym.name}
                disabled={speichert}
                onClick={() => setzeSymbol(i)}
              >
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <path d={sym.pfad} />
                </svg>
              </button>
            ))}
          </div>
        )}
        <div className="gaestebuch__papier">
          <canvas
            ref={leinwand}
            width={BREITE}
            height={HOEHE}
            onPointerDown={beginne}
            onPointerMove={ziehe}
            onPointerUp={beende}
            onPointerCancel={beende}
          />
          {anzahl === 0 && <div className="gaestebuch__platzhalter">Hier mit dem Finger schreiben …</div>}
          {markiert && (
            <div
              className="gaestebuch__markierung"
              style={{
                left: `${((markiert.x - SYMBOL_GROESSE / 2) / BREITE) * 100}%`,
                top: `${((markiert.y - SYMBOL_GROESSE / 2) / HOEHE) * 100}%`,
                width: `${(SYMBOL_GROESSE / BREITE) * 100}%`,
                height: `${(SYMBOL_GROESSE / HOEHE) * 100}%`,
              }}
            />
          )}
        </div>
      </div>

      {fehler && <p className="untertitel" style={{ margin: 0, color: 'var(--fehler)' }}>{fehler}</p>}

      <div className="gaestebuch__leiste">
        <div className="gaestebuch__farben">
          {FARBEN.map((f) => (
            <button
              key={f.wert}
              className={`gaestebuch__farbe${farbe === f.wert ? ' gaestebuch__farbe--gewaehlt' : ''}`}
              style={{ background: f.wert }}
              aria-label={f.name}
              onClick={() => setzeFarbe(f.wert)}
            />
          ))}
        </div>
        <button className="knopf knopf--neben" disabled={anzahl === 0 || speichert} onClick={rueckgaengig}>
          Rückgängig
        </button>
        <button className="knopf knopf--neben" disabled={anzahl === 0 || speichert} onClick={leeren}>
          Neu anfangen
        </button>
        <button className="knopf knopf--neben" disabled={speichert} onClick={beiAbbruch}>
          Abbrechen
        </button>
        <button className="knopf knopf--haupt" disabled={anzahl === 0 || speichert} onClick={() => void speichere()}>
          {speichert ? 'Wird gespeichert …' : 'Ins Gästebuch'}
        </button>
      </div>
    </div>
  );
}
