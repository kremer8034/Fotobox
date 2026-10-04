import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Geraet {
  portalAktiv: boolean;
  wlan: { name: string; passwort: string } | null;
}

interface Pruefzeile {
  titel: string;
  ok: boolean | null;
  hinweis: string;
}

interface PortalDiagnose {
  windows: boolean;
  eingerichtet: boolean;
  bereit: boolean;
  zeilen: Pruefzeile[];
}

/**
 * WLAN des Vonets und Captive Portal (Test) - eigener Menuepunkt.
 *
 * Mit eingeschaltetem Portal oeffnet sich die Galerie von selbst, sobald ein
 * Handy dem Fotobox-WLAN beitritt - ein Scan statt zwei. Standardmaessig aus:
 * Dann laeuft die Box genau wie vorher. Der Schalter steht deshalb ganz oben;
 * die Selbstdiagnose darunter sagt, was am Netz dafuer noch fehlt, und richtet
 * es auf Knopfdruck ein.
 */
export function PortalSeite() {
  const [geraet, setzeGeraet] = useState<Geraet | null>(null);
  const [wlan, setzeWlan] = useState({ name: '', passwort: '' });
  const [diagnose, setzeDiagnose] = useState<PortalDiagnose | null>(null);
  const [arbeitet, setzeArbeitet] = useState<string | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);

  useEffect(() => {
    void lade().then((g) => g?.wlan && setzeWlan(g.wlan));
    void pruefe();
  }, []);

  if (!geraet) return <p>Einen Moment…</p>;
  const an = geraet.portalAktiv;
  const gesperrt = !an && !diagnose?.bereit;

  return (
    <>
      <h1 style={{ marginTop: 0 }}>WLAN &amp; Portal</h1>
      {meldung && <p style={{ color: 'var(--akzent)' }}>{meldung}</p>}

      <div className="karte">
        <h2>Galerie öffnet sich beim WLAN-Beitritt (Test)</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
          Ist das Portal an, geht es <strong>ohne Code</strong>: Gäste tippen das WLAN der Fotobox in ihren
          WLAN-Einstellungen an, und die Galerie öffnet sich von selbst – wie die Anmeldeseite im Hotel. Das Handy
          bleibt dabei über seine mobilen Daten online.
        </p>
        <div className="kippschalter-zeile">
          <button
            type="button"
            role="switch"
            aria-checked={an}
            aria-label="Captive Portal"
            className={`kippschalter${an ? ' kippschalter--an' : ''}`}
            disabled={gesperrt || arbeitet !== null}
            onClick={() =>
              void tue(!an ? 'Portal eingeschaltet.' : 'Portal ausgeschaltet – die Box läuft wie bisher.', () =>
                api.aendere('/api/admin/geraet', { portalAktiv: !an }),
              )
            }
          >
            <span className="kippschalter__knauf" />
          </button>
          <span>
            <strong>{an ? 'An' : 'Aus'}</strong>
            <span style={{ color: 'var(--schrift-leise)' }}>
              {an
                ? ' – Startbildschirm, Galerie und Aushang zeigen die Anleitung „WLAN antippen – Fotos öffnen sich“.'
                : gesperrt
                  ? ' – die Box läuft wie bisher. Einschalten geht, sobald die Selbstdiagnose unten grün ist.'
                  : ' – die Box läuft wie bisher.'}
            </span>
          </span>
        </div>
      </div>

      <div className="karte">
        <h2>WLAN des Vonets</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--schrift-leise)', marginTop: 0 }}>
          Für das Portal ist das WLAN <strong>offen – ohne Passwort</strong>: Gäste tippen es in ihren
          WLAN-Einstellungen an, und die Galerie öffnet sich von selbst. Am Vonets dafür unter „WiFi Repeater →
          WiFi Security“ den „Security Mode“ auf „Disable“ stellen. Der Name hier muss genau dem Namen am Vonets
          entsprechen – er steht in der Anleitung auf Startbildschirm und Aushang. Ein gut erkennbarer Name hilft,
          etwa „Fotobox-Fotos“.
        </p>
        <div className="zeile">
          <div className="feld">
            <label>WLAN-Name</label>
            <input value={wlan.name} maxLength={32} onChange={(e) => setzeWlan({ ...wlan, name: e.target.value })} />
          </div>
          <button
            className="knopf knopf--neben"
            disabled={!wlan.name.trim()}
            onClick={() =>
              void tue('WLAN-Name gespeichert.', () =>
                api.aendere('/api/admin/geraet', { wlan: { name: wlan.name.trim(), passwort: '' } }),
              )
            }
          >
            Speichern
          </button>
        </div>
      </div>

      <div className="karte">
        <h2>Selbstdiagnose</h2>
        {!diagnose && <p style={{ fontSize: '0.85rem' }}>{arbeitet ?? 'Wird geprüft …'}</p>}
        {diagnose && (
          <ul className="pruefliste">
            {diagnose.zeilen.map((z) => (
              <li key={z.titel} className={`pruefliste__zeile pruefliste__zeile--${z.ok === null ? 'info' : z.ok ? 'gut' : 'offen'}`}>
                <span className="pruefliste__zeichen" aria-hidden="true">
                  {z.ok === null ? 'i' : z.ok ? '✓' : '!'}
                </span>
                <span>
                  <strong>{z.titel}</strong>
                  <br />
                  <span style={{ color: 'var(--schrift-leise)' }}>{z.hinweis}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="zeile" style={{ marginTop: '0.6rem' }}>
          <button className="knopf knopf--neben" disabled={arbeitet !== null} onClick={() => void pruefe()}>
            Erneut prüfen
          </button>
          {diagnose?.windows && !diagnose.eingerichtet && (
            <button
              className="knopf"
              disabled={arbeitet !== null}
              onClick={() =>
                void netz('/api/admin/portal/einrichten', 'Windows fragt gleich nach Administratorrechten …', 'Netzwerk eingerichtet.')
              }
            >
              Netzwerk für das Portal einrichten
            </button>
          )}
          {diagnose?.windows && diagnose.eingerichtet && (
            <button
              className="knopf knopf--neben"
              disabled={arbeitet !== null}
              onClick={() =>
                void netz(
                  '/api/admin/portal/zuruecksetzen',
                  'Windows fragt gleich nach Administratorrechten …',
                  'Zurückgesetzt. Jetzt im Vonets (http://192.168.254.254) unter „DHCP Server“ wieder „Enable“ wählen.',
                )
              }
            >
              Zurücksetzen (wie vorher)
            </button>
          )}
        </div>
        {arbeitet && diagnose && <p style={{ fontSize: '0.85rem', marginBottom: 0 }}>{arbeitet}</p>}
      </div>
    </>
  );

  async function lade(): Promise<Geraet | null> {
    try {
      const g = await api.hole<Geraet>('/api/admin/geraet');
      setzeGeraet(g);
      return g;
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Die Einstellungen ließen sich nicht laden.');
      return null;
    }
  }

  async function pruefe() {
    setzeArbeitet('Wird geprüft …');
    try {
      setzeDiagnose((await api.hole<{ diagnose: PortalDiagnose }>('/api/admin/portal')).diagnose);
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Die Selbstdiagnose ging nicht.');
    } finally {
      setzeArbeitet(null);
    }
  }

  async function netz(pfad: string, warten: string, fertig: string) {
    setzeArbeitet(warten);
    setzeMeldung(null);
    try {
      setzeDiagnose((await api.sende<{ diagnose: PortalDiagnose }>(pfad, {})).diagnose);
      setzeMeldung(fertig);
      void lade();
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    } finally {
      setzeArbeitet(null);
    }
  }

  async function tue(fertig: string, aktion: () => Promise<unknown>) {
    setzeMeldung(null);
    try {
      await aktion();
      setzeMeldung(fertig);
      void lade();
      void pruefe();
    } catch (fehler) {
      setzeMeldung(fehler instanceof Error ? fehler.message : 'Hat nicht geklappt.');
    }
  }
}
