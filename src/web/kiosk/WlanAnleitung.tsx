import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
 *
 * Fuer alle, die schon im WLAN sind, deren Anmeldefenster aber nicht aufging
 * oder schon zu ist: "Schon im WLAN verbunden?" zeigt auf Tipp einen QR-Code
 * mit dem Link zur Box - die leitet immer zur laufenden Galerie. Erst auf
 * Tipp, damit niemand den Code fuer den Hauptweg haelt.
 */
const RUECKWEG = "http://192.168.254.1/";
const RUECKWEG_ZU_MS = 45_000;

export function WlanAnleitung({
  name,
  form,
}: {
  name: string;
  form: "karte" | "leiste";
}) {
  const [codeOffen, setzeCodeOffen] = useState(false);

  // Von selbst wieder zu - sonst stuende der Code fuer den naechsten Gast noch da.
  useEffect(() => {
    if (!codeOffen) return;
    const uhr = setTimeout(() => setzeCodeOffen(false), RUECKWEG_ZU_MS);
    return () => clearTimeout(uhr);
  }, [codeOffen]);

  return (
    <div className={`wlan-hilfe wlan-hilfe--${form}`}>
      <span className="wlan-hilfe__symbol" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
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
                "Das WLAN der Fotobox antippen"
              )}
            </span>
          </li>
          <li>Die Fotos öffnen sich von selbst</li>
        </ol>
        <button
          type="button"
          className="wlan-hilfe__rueckweg"
          onClick={() => setzeCodeOffen(true)}
        >
          Schon im WLAN verbunden? <strong>Hier tippen</strong>
        </button>
      </div>

      {/* Direkt an die Seite gehaengt: Die Karte hat einen Weichzeichner
          (backdrop-filter), und der haelt fixierte Elemente in ihr gefangen -
          das Fenster sass sonst in der Karte statt in der Bildschirmmitte. */}
      {codeOffen &&
        createPortal(
          <div
            className="rueckweg"
            onClick={() => setzeCodeOffen(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="rueckweg__karte"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rueckweg__titel">Galerie direkt öffnen</div>
              <img
                className="rueckweg__code"
                src={`/api/qr?text=${encodeURIComponent(RUECKWEG)}`}
                alt=""
              />
              <p className="rueckweg__text">
                Mit der Handykamera scannen – die Galerie öffnet sich direkt.
                <br />
                Oder im Browser <strong>192.168.254.1</strong> eingeben.
              </p>
              <button
                type="button"
                className="knopf knopf--neben"
                onClick={() => setzeCodeOffen(false)}
              >
                Schließen
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
