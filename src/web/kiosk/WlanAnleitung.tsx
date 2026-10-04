/**
 * Anleitung "So kommt ihr an eure Fotos" - mit Captive Portal statt eines
 * QR-Codes.
 *
 * Das WLAN der Fotobox ist dann offen. Wer es in den WLAN-Einstellungen
 * antippt, bekommt die Galerie von selbst - bei Android wie beim iPhone. Per
 * QR-Code verbunden, wartet Android dagegen auf einen zweiten Tipp, und das
 * iPhone zeigt das Fenster erst nach dem Schliessen der Kamera. Deshalb hier
 * bewusst kein Code, sondern drei kurze Schritte.
 *
 * Zwei Formen: als Karte unten links auf dem Startbildschirm und als Leiste
 * unten in der Galerie, links neben "Zurueck".
 */
export function WlanAnleitung({ name, form }: { name: string; form: 'karte' | 'leiste' }) {
  return (
    <div className={`wlan-hilfe wlan-hilfe--${form}`}>
      <span className="wlan-hilfe__symbol" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M2.5 9a14 14 0 0 1 19 0" />
          <path d="M5.8 12.5a9 9 0 0 1 12.4 0" />
          <path d="M9.1 16a4.3 4.3 0 0 1 5.8 0" />
          <circle cx="12" cy="19.3" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <div className="wlan-hilfe__text">
        <div className="wlan-hilfe__titel">Eure Fotos aufs Handy</div>
        <ol className="wlan-hilfe__schritte">
          <li>WLAN-Einstellungen öffnen</li>
          <li>
            {/* Eine Spanne: Der Listenpunkt ist ein Flex-Kasten, sonst stuende eine Luecke vor "antippen". */}
            <span>
              {name ? (
                <>
                  <strong>„{name}“</strong> antippen
                </>
              ) : (
                'Das WLAN der Fotobox antippen'
              )}
            </span>
          </li>
          <li>Die Fotos öffnen sich von selbst</li>
        </ol>
        {/* Rueckweg fuer alle, deren Anmeldefenster nicht aufging oder schon zu ist. */}
        <div className="wlan-hilfe__rueckweg">
          Schon im WLAN? Im Browser <strong>192.168.254.1</strong> eingeben
        </div>
      </div>
    </div>
  );
}
