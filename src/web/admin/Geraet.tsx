import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

interface Geraet {
  datenpfad: string;
  druckerName: string;
  sumatraPfad: string;
  digicamcontrolPfad: string;
  speicherWarnungGb: number;
  besitzerPinGesetzt: boolean;
  mail: Mail | null;
  mailPasswortGesetzt: boolean;
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

interface Mail {
  host: string;
  port: number;
  benutzer: string;
  absender: string;
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
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setzePin(e.target.value)}
            />
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

      <MailKarte
        mail={geraet.mail}
        passwortGesetzt={geraet.mailPasswortGesetzt}
        beiSpeichern={(teil) => speichere(teil)}
      />

      <SoftwareKarte />

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

/**
 * Der Postausgangsserver fuer "Foto per E-Mail".
 *
 * Das Passwortfeld ist immer leer: Das gespeicherte Passwort verlaesst den
 * Server nie, auch nicht in die Verwaltung. Leer lassen heisst "unveraendert".
 */
function MailKarte({
  mail,
  passwortGesetzt,
  beiSpeichern,
}: {
  mail: Mail | null;
  passwortGesetzt: boolean;
  beiSpeichern: (teil: Record<string, unknown>) => Promise<void>;
}) {
  const [entwurf, setzeEntwurf] = useState<Mail>(
    mail ?? { host: '', port: 587, benutzer: '', absender: '' },
  );
  const [passwort, setzePasswort] = useState('');
  const [testAn, setzeTestAn] = useState('');
  const [ergebnis, setzeErgebnis] = useState<string | null>(null);
  const feld = (name: keyof Mail, text: string, art = 'text') => (
    <div className="feld">
      <label>{text}</label>
      <input
        type={art}
        value={entwurf[name]}
        onChange={(e) =>
          setzeEntwurf({ ...entwurf, [name]: art === 'number' ? Number(e.target.value) : e.target.value })
        }
      />
    </div>
  );

  return (
    <div className="karte">
      <h2>E-Mail-Versand</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
        Nötig für „Foto per E-Mail". Nimm ein <strong>eigenes Konto für die Fotobox</strong> und
        dort ein <strong>App-Passwort</strong> — nie das Passwort deines privaten Postfachs: Es liegt
        auf der Box. Die Verbindung ist immer verschlüsselt (Port 465 oder 587).
      </p>
      <div className="zeile">
        {feld('host', 'Postausgangsserver, etwa smtp.gmail.com')}
        {feld('port', 'Port', 'number')}
      </div>
      <div className="zeile">
        {feld('benutzer', 'Benutzername')}
        <div className="feld">
          <label>Passwort {passwortGesetzt ? '(gespeichert — leer lassen zum Behalten)' : ''}</label>
          <input
            type="password"
            autoComplete="new-password"
            value={passwort}
            onChange={(e) => setzePasswort(e.target.value)}
          />
        </div>
      </div>
      {feld('absender', 'Absender, etwa Fotobox <fotobox@example.de>')}
      <div className="zeile">
        <button
          className="knopf"
          disabled={!entwurf.host || !entwurf.absender}
          onClick={() =>
            void beiSpeichern({ mail: entwurf, ...(passwort ? { mailPasswort: passwort } : {}) }).then(() =>
              setzePasswort(''),
            )
          }
        >
          Speichern
        </button>
        {mail && (
          <button className="knopf knopf--neben" onClick={() => void beiSpeichern({ mail: null })}>
            Zugang entfernen
          </button>
        )}
      </div>
      {mail && (
        <div className="zeile" style={{ marginTop: '1rem' }}>
          <div className="feld">
            <label>Testmail an</label>
            <input type="email" value={testAn} onChange={(e) => setzeTestAn(e.target.value)} />
          </div>
          <button className="knopf knopf--neben" disabled={!testAn} onClick={() => void testmail()}>
            Testmail senden
          </button>
        </div>
      )}
      {ergebnis && <p style={{ marginBottom: 0 }}>{ergebnis}</p>}
    </div>
  );

  async function testmail() {
    setzeErgebnis('Wird verschickt …');
    try {
      await api.sende('/api/admin/geraet/testmail', { an: testAn });
      setzeErgebnis('Die Testmail ist raus. Schau ins Postfach.');
    } catch (fehler) {
      setzeErgebnis(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    }
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

interface UpdateInfo {
  aktuell: string;
  neueste: string | null;
  neuerVerfuegbar: boolean;
  titel: string | null;
  hinweise: string | null;
  veroeffentlicht: string | null;
  setup: { name: string; groesse: number } | null;
}

interface UpdateStand {
  phase: 'bereit' | 'laedt' | 'prueft' | 'startet' | 'gestartet' | 'simuliert' | 'fehler';
  version: string | null;
  geladen: number;
  gesamt: number;
  meldung: string | null;
  aktuell: string;
}

/**
 * Software-Update. Gesucht und installiert wird nur auf Knopfdruck; die Box
 * schaut nie von selbst nach. Ohne Internet geht dasselbe per USB-Stick: die
 * Setup-Datei der neuen Version auf der Box starten.
 */
function SoftwareKarte() {
  const [stand, setzeStand] = useState<UpdateStand | null>(null);
  const [info, setzeInfo] = useState<UpdateInfo | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);
  const [sucht, setzeSucht] = useState(false);
  // Mit welcher Version das Update begann - daran erkennt die Seite, dass die
  // neue Version laeuft.
  const vorher = useRef<string | null>(null);
  const [beobachten, setzeBeobachten] = useState(false);

  useEffect(() => {
    void api.hole<UpdateStand>('/api/admin/update/stand').then((s) => {
      setzeStand(s);
      if (['laedt', 'prueft', 'startet', 'gestartet'].includes(s.phase)) {
        vorher.current = s.aktuell;
        setzeBeobachten(true);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!beobachten) return;
    const uhr = setInterval(() => {
      api
        .hole<UpdateStand>('/api/admin/update/stand')
        .then((s) => {
          setzeStand(s);
          if (vorher.current && s.aktuell !== vorher.current) {
            setzeMeldung(`Fertig - die Fotobox läuft jetzt mit Version ${s.aktuell}.`);
            setzeInfo(null);
            setzeBeobachten(false);
          } else if (s.phase === 'fehler' || s.phase === 'simuliert') {
            setzeBeobachten(false);
          }
        })
        // Keine Antwort: Der Installer hat den Server beendet und tauscht
        // gerade die Dateien aus.
        .catch(() => setzeMeldung('Die Fotobox wird gerade aktualisiert und startet gleich neu …'));
    }, 1500);
    return () => clearInterval(uhr);
  }, [beobachten]);

  const laeuft = stand !== null && ['laedt', 'prueft', 'startet'].includes(stand.phase);
  const prozent = stand && stand.gesamt > 0 ? Math.min(100, Math.round((stand.geladen / stand.gesamt) * 100)) : 0;

  return (
    <div className="karte">
      <h2>Software</h2>
      <p style={{ marginTop: 0 }}>
        Installiert: <strong>Version {stand?.aktuell ?? '…'}</strong>
      </p>
      <div className="zeile">
        <button className="knopf knopf--neben" disabled={sucht || laeuft} onClick={() => void suche()}>
          {sucht ? 'Suche …' : 'Nach Updates suchen'}
        </button>
      </div>

      {info && !info.neuerVerfuegbar && (
        <p>{info.neueste ? `Das ist die neueste Version (${info.neueste}).` : 'Es ist noch keine Version veröffentlicht.'}</p>
      )}

      {info?.neuerVerfuegbar && (
        <div style={{ marginTop: '0.8rem' }}>
          <p style={{ margin: 0 }}>
            <strong>Version {info.neueste}</strong> ist verfügbar
            {info.veroeffentlicht && ` (veröffentlicht am ${new Date(info.veroeffentlicht).toLocaleDateString('de-DE')})`}
            {info.setup && `, ${Math.round(info.setup.groesse / 1024 / 1024)} MB`}.
          </p>
          {info.hinweise && (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                fontSize: '0.82rem',
                maxHeight: '12rem',
                overflow: 'auto',
                background: 'var(--flaeche-2, rgba(127,127,127,0.1))',
                padding: '0.6rem',
                borderRadius: '0.4rem',
              }}
            >
              {info.hinweise}
            </pre>
          )}
          <button className="knopf" disabled={laeuft || beobachten} onClick={() => void installiere()}>
            Jetzt installieren
          </button>
        </div>
      )}

      {stand && stand.phase === 'laedt' && <p>Wird geladen … {prozent} %</p>}
      {stand && stand.phase === 'prueft' && <p>Prüfsumme wird kontrolliert …</p>}
      {stand && ['gestartet', 'simuliert', 'fehler'].includes(stand.phase) && stand.meldung && !meldung && (
        <p style={{ color: stand.phase === 'fehler' ? 'var(--fehler, #c33)' : undefined }}>{stand.meldung}</p>
      )}
      {meldung && <p>{meldung}</p>}

      <p style={{ fontSize: '0.78rem', color: 'var(--schrift-leise)', marginBottom: 0 }}>
        Ohne Internet: die Datei „Fotobox-Setup-…exe“ der neuen Version per USB-Stick auf die Box bringen und
        doppelklicken. Fotos, Veranstaltungen und Einstellungen bleiben dabei erhalten; die Datenbank wird
        vorher gesichert.
      </p>
    </div>
  );

  async function suche() {
    setzeSucht(true);
    setzeMeldung(null);
    try {
      setzeInfo(await api.sende<UpdateInfo>('/api/admin/update/pruefen', {}));
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Die Suche hat nicht geklappt.');
    } finally {
      setzeSucht(false);
    }
  }

  async function installiere() {
    if (
      !window.confirm(
        `Version ${info?.neueste} jetzt installieren?\n\n` +
          'Die Fotobox wird dafür kurz beendet (Kiosk und Server) und startet danach von selbst neu. ' +
          'Windows fragt einmal nach Administratorrechten - bitte mit „Ja“ bestätigen.\n\n' +
          'Nicht während einer laufenden Feier.',
      )
    ) {
      return;
    }
    setzeMeldung(null);
    try {
      vorher.current = stand?.aktuell ?? null;
      await api.sende('/api/admin/update/installieren', {});
      setzeBeobachten(true);
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Das Update ließ sich nicht starten.');
    }
  }
}
