import { useEffect, useState } from 'react';
import { api } from '../api.js';

type Ebene = 'betreuer' | 'besitzer';

interface WasIstLos {
  kamera: string;
  drucker: string;
  stoerungstext: { titel: string; folge: string; tun: string } | null;
  warteschlangeOffen: number;
  materialRest: number;
  speicherFreiGb: number;
  drucke: number;
  sitzungen: number;
}

/**
 * Kiosk-Sperre mit zwei PIN-Ebenen.
 *
 * Das Schloss oben rechts ist kaum sichtbar und reagiert erst auf langes
 * Druecken (2 Sekunden) - ein neugieriger Gast tippt einmal drauf und es
 * passiert nichts.
 *
 * Nach der PIN kommt nicht der Windows-Desktop, sondern ein Servicemenue. Und
 * welches, haengt von der eingegebenen PIN ab: Der Kunde bekommt die
 * Betreuer-PIN und damit nur die Handgriffe des Alltags.
 */
export function Schloss({ beiOeffnen }: { beiOeffnen: () => void }) {
  const [gedruecktSeit, setzeGedruecktSeit] = useState<number | null>(null);

  useEffect(() => {
    if (gedruecktSeit === null) return;
    const uhr = setTimeout(beiOeffnen, 2000);
    return () => clearTimeout(uhr);
  }, [gedruecktSeit, beiOeffnen]);

  return (
    <div
      className="schloss"
      onPointerDown={() => setzeGedruecktSeit(Date.now())}
      onPointerUp={() => setzeGedruecktSeit(null)}
      onPointerLeave={() => setzeGedruecktSeit(null)}
      aria-hidden
    >
      🔒
    </div>
  );
}

export function PinAbfrage({
  beiErfolg,
  beiAbbruch,
}: {
  beiErfolg: (ebene: Ebene) => void;
  beiAbbruch: () => void;
}) {
  const [pin, setzePin] = useState('');
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [wasIstLos, setzeWasIstLos] = useState<WasIstLos | null>(null);

  // Abbruch automatisch nach 10 Sekunden Untaetigkeit.
  useEffect(() => {
    const uhr = setTimeout(beiAbbruch, 10_000);
    return () => clearTimeout(uhr);
  }, [pin, wasIstLos, beiAbbruch]);

  if (wasIstLos) {
    return (
      <div className="seite kiosk">
        <h1 className="titel">Was ist los?</h1>
        <div className="mitte" style={{ alignItems: 'stretch', textAlign: 'left' }}>
          <div className="karte" style={{ fontSize: '0.95rem', lineHeight: 1.8 }}>
            <div>Kamera: {wasIstLos.kamera === 'bereit' ? 'in Ordnung' : 'meldet sich nicht'}</div>
            <div>Drucker: {druckerText(wasIstLos)}</div>
            <div>{wasIstLos.warteschlangeOffen} Foto(s) warten auf den Druck</div>
            <div>Noch {wasIstLos.materialRest} Blatt Papier</div>
            <div>{wasIstLos.speicherFreiGb} GB Speicher frei</div>
            <div>
              {wasIstLos.sitzungen} Durchgänge, {wasIstLos.drucke} Ausdrucke bisher
            </div>
          </div>
          {wasIstLos.stoerungstext && (
            <p className="untertitel">
              {wasIstLos.stoerungstext.titel} {wasIstLos.stoerungstext.tun}
            </p>
          )}
        </div>
        <div className="reihe reihe--ende">
          <button className="knopf knopf--neben" onClick={() => setzeWasIstLos(null)}>
            Zurück
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="seite kiosk">
      <div className="mitte">
        <h1 className="titel">PIN eingeben</h1>
        <div className="pin-punkte">{'•'.repeat(pin.length)}</div>
        {meldung && <p className="untertitel">{meldung}</p>}
        <div className="pinfeld">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((z) => (
            <button key={z} onClick={() => tippe(z)}>
              {z}
            </button>
          ))}
          <button onClick={() => setzePin('')}>C</button>
          <button onClick={() => tippe('0')}>0</button>
          <button onClick={() => void pruefe()}>OK</button>
        </div>
      </div>
      <div className="reihe reihe--ende">
        {/* Ohne PIN erreichbar, damit auch ein Gast das Problem weitergeben kann. */}
        <button className="knopf knopf--neben" onClick={() => void ladeWasIstLos()}>
          Was ist los?
        </button>
        <button className="knopf knopf--neben" onClick={beiAbbruch}>
          Abbrechen
        </button>
      </div>
    </div>
  );

  function tippe(ziffer: string) {
    setzeMeldung(null);
    setzePin((alt) => (alt.length >= 8 ? alt : alt + ziffer));
  }

  async function pruefe() {
    try {
      const antwort = await api.sende<{ ebene: Ebene }>('/api/kiosk/pin', { pin });
      beiErfolg(antwort.ebene);
    } catch (fehler) {
      setzePin('');
      setzeMeldung(fehler instanceof Error ? fehler.message : 'PIN stimmt nicht.');
    }
  }

  async function ladeWasIstLos() {
    setzeWasIstLos(await api.hole<WasIstLos>('/api/kiosk/wasistlos'));
  }
}

function druckerText(w: WasIstLos): string {
  if (w.drucker === 'bereit') return 'in Ordnung';
  return w.stoerungstext?.titel ?? 'meldet einen Fehler';
}

/**
 * Servicemenue. Der Kunde kann alles erledigen, was im Alltag anfaellt, aber
 * nichts kaputt machen.
 */
export function Servicemenue({
  ebene,
  beiSchliessen,
  beiGalerie,
  beiAdmin,
}: {
  ebene: Ebene;
  beiSchliessen: () => void;
  beiGalerie: () => void;
  beiAdmin: () => void;
}) {
  const [meldung, setzeMeldung] = useState<string | null>(null);

  return (
    <div className="seite kiosk">
      <h1 className="titel">Servicemenü</h1>
      <p className="untertitel">
        {ebene === 'besitzer' ? 'Besitzer — voller Zugriff' : 'Betreuer — Handgriffe des Alltags'}
      </p>
      {meldung && <p className="untertitel">{meldung}</p>}

      <div className="mitte" style={{ justifyContent: 'flex-start', paddingTop: 'var(--abstand)' }}>
        <div className="raster" style={{ gridTemplateColumns: '1fr 1fr', width: '100%' }}>
          <button className="knopf" onClick={beiSchliessen}>
            Zurück zum Kiosk
          </button>
          <button className="knopf" onClick={beiGalerie}>
            Nachdruck aus der Galerie
          </button>
          <button className="knopf" onClick={() => void tue('/api/kiosk/service/fortsetzen', 'Warteschlange läuft weiter.')}>
            Papier gewechselt — weiter drucken
          </button>
          <button className="knopf" onClick={() => void tue('/api/kiosk/service/neue-rolle', 'Materialzähler zurückgesetzt.')}>
            Neue Rolle eingelegt
          </button>

          {ebene === 'besitzer' && (
            <>
              <button className="knopf" onClick={beiAdmin}>
                Verwaltung öffnen
              </button>
              <button
                className="knopf"
                onClick={() => {
                  // Vollbild verlassen; den Kiosk beendet danach Windows.
                  void document.exitFullscreen?.().catch(() => undefined);
                  setzeMeldung('Vollbild verlassen.');
                }}
              >
                Vollbild verlassen
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  async function tue(pfad: string, erfolgstext: string) {
    try {
      await api.sende(pfad, {});
      setzeMeldung(erfolgstext);
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    }
  }
}
