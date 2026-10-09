import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useZeitgeber } from './zeitgeber.js';

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

interface Strich {
  farbe: string;
  punkte: { x: number; y: number }[];
}

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
  beiGespeichert,
  beiAbbruch,
}: {
  ausgabeId: string;
  beiGespeichert: () => void;
  beiAbbruch: () => void;
}) {
  const leinwand = useRef<HTMLCanvasElement>(null);
  const striche = useRef<Strich[]>([]);
  const aktiv = useRef<Strich | null>(null);
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

  function zeichneAlles() {
    const ctx = kontext();
    if (!ctx) return;
    ctx.clearRect(0, 0, BREITE, HOEHE);
    for (const s of striche.current) zeichneStrich(ctx, s);
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
    aktiv.current = { farbe, punkte: [punkt(e)] };
    const ctx = kontext();
    if (ctx) zeichneStrich(ctx, aktiv.current);
  }

  function ziehe(e: React.PointerEvent<HTMLCanvasElement>) {
    const s = aktiv.current;
    if (!s || e.pointerId !== finger.current) return;
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
    if (!aktiv.current) return;
    striche.current.push(aktiv.current);
    aktiv.current = null;
    setzeAnzahl(striche.current.length);
    // Sauber neu zeichnen: Die schnellen Teilstuecke beim Ziehen sind eckiger
    // als die geglaettete Linie.
    zeichneAlles();
  }

  function rueckgaengig() {
    striche.current.pop();
    setzeAnzahl(striche.current.length);
    zeichneAlles();
  }

  function leeren() {
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
            Mit dem Finger schreiben oder malen. Das Gästebuch bekommt nur der Gastgeber – es erscheint in
            keiner Galerie.
          </p>
        </div>
      </div>

      <div className="gaestebuch__flaeche">
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
