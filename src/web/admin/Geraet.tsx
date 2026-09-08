import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Geraet {
  datenpfad: string;
  druckerName: string;
  sumatraPfad: string;
  digicamcontrolPfad: string;
  speicherWarnungGb: number;
  besitzerPinGesetzt: boolean;
  lanAdresse: string | null;
  hardware: string;
  kamera: { iso: string; blende: string; verschlusszeit: string };
  kalibrierung: {
    versatzXMm: number;
    versatzYMm: number;
    skalierungXProzent: number;
    skalierungYProzent: number;
  };
}

const KAMERA_BESCHRIFTUNG = {
  iso: 'ISO',
  blende: 'Blende',
  verschlusszeit: 'Verschlusszeit',
} as const;

/**
 * Geraeteeinstellungen.
 *
 * Sie gehoeren zur Fotobox, nicht zur Veranstaltung: einmal einrichten und nie
 * wieder anfassen. Deshalb wandern Druckkalibrierung, Kameraprofil und PIN auch
 * nicht mit einem Event-Export auf einen anderen Rechner.
 */
export function GeraetSeite() {
  const [geraet, setzeGeraet] = useState<Geraet | null>(null);
  const [pin, setzePin] = useState('');
  const [meldung, setzeMeldung] = useState<string | null>(null);

  useEffect(() => {
    void lade();
  }, []);

  if (!geraet) return <p>Einen Moment…</p>;
  const k = geraet.kalibrierung;

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Gerät</h1>
      {meldung && <p style={{ color: 'var(--akzent)' }}>{meldung}</p>}

      <div className="karte">
        <h2>Überblick</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)' }}>
          Datenpfad: <code>{geraet.datenpfad}</code>
          <br />
          Netzwerkadresse: <code>{geraet.lanAdresse ?? 'keine gefunden'}</code>
          <br />
          Hardware: {geraet.hardware === 'echt' ? 'digiCamControl und Windows-Druck' : 'Mock (Entwicklung)'}
        </p>
      </div>

      <div className="karte">
        <h2>Drucker</h2>
        <div className="zeile">
          <div className="feld" style={{ flex: 1 }}>
            <label>Windows-Druckername</label>
            <input
              value={geraet.druckerName}
              onChange={(e) => setzeGeraet({ ...geraet, druckerName: e.target.value })}
              onBlur={() => void speichere({ druckerName: geraet.druckerName })}
              placeholder="DS-RX1"
            />
          </div>
          <div className="feld" style={{ flex: 1 }}>
            <label>Pfad zu SumatraPDF.exe</label>
            <input
              value={geraet.sumatraPfad}
              onChange={(e) => setzeGeraet({ ...geraet, sumatraPfad: e.target.value })}
              onBlur={() => void speichere({ sumatraPfad: geraet.sumatraPfad })}
            />
          </div>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)', marginBottom: 0 }}>
          Randlos, Papierformat und das ICC-Farbprofil von DNP werden einmalig im Windows-Treiber
          eingestellt. Ohne Profil treffen Thermosublimationsdrucker Hauttöne und Rot spürbar daneben.
        </p>
      </div>

      <div className="karte">
        <h2>Druckkalibrierung</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
          Randloser Druck überzeichnet den Rand leicht, und jeder Drucker tut das ein bisschen
          anders. Erst das Testbild drucken, dann an den Millimeterskalen ablesen, wie viel fehlt
          oder übersteht, und die Werte hier eintragen. Die PDF-Seite bleibt immer exakt
          152,4 × 101,6 mm — nur das eingebettete Bild wird verschoben.
        </p>
        <div className="zeile">
          <Wert
            name="Versatz waagerecht (mm)"
            wert={k.versatzXMm}
            min={-5}
            max={5}
            schritt={0.1}
            beiWechsel={(v) => void speichere({ kalibrierung: { ...k, versatzXMm: v } })}
          />
          <Wert
            name="Versatz senkrecht (mm)"
            wert={k.versatzYMm}
            min={-5}
            max={5}
            schritt={0.1}
            beiWechsel={(v) => void speichere({ kalibrierung: { ...k, versatzYMm: v } })}
          />
          <Wert
            name="Skalierung waagerecht (%)"
            wert={k.skalierungXProzent}
            min={95}
            max={105}
            schritt={0.1}
            beiWechsel={(v) => void speichere({ kalibrierung: { ...k, skalierungXProzent: v } })}
          />
          <Wert
            name="Skalierung senkrecht (%)"
            wert={k.skalierungYProzent}
            min={95}
            max={105}
            schritt={0.1}
            beiWechsel={(v) => void speichere({ kalibrierung: { ...k, skalierungYProzent: v } })}
          />
        </div>
        <div className="zeile">
          <button className="knopf knopf--neben" onClick={() => void kalibrierdruck()}>
            Kalibrier-Testbild drucken
          </button>
          <button
            className="knopf knopf--neben"
            onClick={() =>
              void speichere({
                kalibrierung: {
                  versatzXMm: 0,
                  versatzYMm: 0,
                  skalierungXProzent: 100,
                  skalierungYProzent: 100,
                },
              })
            }
          >
            Zurücksetzen
          </button>
        </div>
      </div>

      <div className="karte">
        <h2>Kamera</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
          Mit LED-Dauerlicht lohnt der M-Modus mit festen Werten: Die Bilder bleiben über den ganzen
          Abend gleich hell, und die Vorschau entspricht dem Ergebnis.
        </p>
        <div className="zeile">
          {(['iso', 'blende', 'verschlusszeit'] as const).map((feld) => (
            <div className="feld feld--klein" key={feld}>
              {/* Die Schluesselnamen standen vorher unveraendert als Beschriftung
                  auf dem Schirm - "iso" und "verschlusszeit" klein geschrieben. */}
              <label>{KAMERA_BESCHRIFTUNG[feld]}</label>
              <input
                value={geraet.kamera[feld]}
                onChange={(e) => setzeGeraet({ ...geraet, kamera: { ...geraet.kamera, [feld]: e.target.value } })}
                onBlur={() => void speichere({ kamera: geraet.kamera })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="karte">
        <h2>Besitzer-PIN</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
          {geraet.besitzerPinGesetzt
            ? 'Gesetzt. Sie öffnet Verwaltung, Vollbild verlassen und Herunterfahren.'
            : 'Noch nicht gesetzt — ohne sie lässt sich keine Veranstaltung starten.'}{' '}
          Es gibt bewusst keine ausgelieferte Standard-PIN.
        </p>
        <div className="zeile">
          <div className="feld feld--klein">
            <label>Neue PIN (4–8 Ziffern)</label>
            <input value={pin} onChange={(e) => setzePin(e.target.value)} />
          </div>
          <button
            className="knopf knopf--neben"
            disabled={pin.length < 4}
            onClick={() => void speichere({ besitzerPin: pin }).then(() => setzePin(''))}
          >
            PIN setzen
          </button>
        </div>
      </div>

      <div className="karte">
        <h2>Speicher</h2>
        <div className="feld feld--klein">
          <label>Warnschwelle (GB)</label>
          <input
            type="number"
            min={0}
            value={geraet.speicherWarnungGb}
            onChange={(e) => setzeGeraet({ ...geraet, speicherWarnungGb: Number(e.target.value) })}
            onBlur={() => void speichere({ speicherWarnungGb: geraet.speicherWarnungGb })}
          />
        </div>
      </div>
    </>
  );

  async function lade() {
    setzeGeraet(await api.hole<Geraet>('/api/admin/geraet'));
  }

  async function speichere(teil: Record<string, unknown>) {
    await api.aendere('/api/admin/geraet', teil);
    await lade();
    setzeMeldung('Gespeichert.');
    setTimeout(() => setzeMeldung(null), 1500);
  }

  async function kalibrierdruck() {
    await api.sende('/api/admin/geraet/kalibrierdruck', { preset: '10x15-quer' });
    setzeMeldung('Testbild in der Warteschlange. Es zählt nicht in den Auslagenersatz.');
  }
}

function Wert({
  name,
  wert,
  min,
  max,
  schritt,
  beiWechsel,
}: {
  name: string;
  wert: number;
  min: number;
  max: number;
  schritt: number;
  beiWechsel: (wert: number) => void;
}) {
  return (
    <div className="feld feld--klein">
      <label>{name}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={schritt}
        value={wert}
        onChange={(e) => beiWechsel(Number(e.target.value))}
      />
    </div>
  );
}
