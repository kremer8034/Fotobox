import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiFehler } from '../api.js';
import { mehrzahl, Statusliste } from '../Statusliste.js';
import { STOERUNGSTEXTE } from '../../shared/typen.js';

interface GalerieDaten {
  veranstaltung: string;
  datum: string;
  bilder: { id: string; erstellt: string }[];
}

interface StatusDaten {
  veranstaltung: string;
  zustand: {
    kamera: string;
    drucker: string;
    stoerung: string | null;
    warteschlangeOffen: number;
    speicherFreiGb: number;
  };
  zahlen: { sitzungen: number; drucke: number; materialRest: number | null };
}

/** Wie oft die Galerie nach neuen Fotos schaut - der Abend geht weiter. */
const NACHLADEN_MS = 30_000;

/**
 * Welcher Weg zum Speichern funktioniert, haengt am Handy - besonders, wenn
 * sich die Galerie als Anmeldefenster (Captive Portal) oeffnet: Android
 * kennt dort kein Gedrueckthalten, laedt aber herunter; am iPhone ist es eher
 * umgekehrt. (Am echten Android-Handy getestet: Gedrueckthalten tut nichts,
 * „Aufs Handy laden“ klappt.)
 */
type Geraet = 'android' | 'iphone' | 'anderes';
const GERAET: Geraet = (() => {
  const kennung = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Android/i.test(kennung)) return 'android';
  // iPads melden sich als Mac - aber mit Touchscreen.
  if (/iPhone|iPad|iPod/i.test(kennung) || (/Macintosh/i.test(kennung) && navigator.maxTouchPoints > 1)) return 'iphone';
  return 'anderes';
})();

/** Der Weg nach dem Oeffnen eines Fotos - je Geraet der, der dort funktioniert. */
const SPEICHER_WEG: Record<Geraet, string[]> = {
  android: [
    'Auf „Aufs Handy laden“ tippen.',
    'Das Foto liegt jetzt in deiner Galerie-App.',
    'Von dort teilen – etwa per WhatsApp.',
  ],
  iphone: [
    'Das Foto oben gedrückt halten.',
    '„Zu Fotos hinzufügen“ wählen.',
    'In der Fotos-App teilen – etwa per WhatsApp.',
  ],
  anderes: [
    'Auf „Aufs Handy laden“ tippen.',
    'Das Foto aus den Downloads öffnen und von dort teilen.',
  ],
};

const SPEICHER_TIPP: Record<Geraet, string> = {
  android: 'Tipp: Foto antippen → „Aufs Handy laden“. Danach liegt es in deiner Galerie-App.',
  iphone: 'Tipp: Foto gedrückt halten → „Zu Fotos hinzufügen“ oder „Teilen“.',
  anderes: 'Tipp: Foto antippen → „Aufs Handy laden“.',
};

/**
 * Handy-Ansicht im WLAN.
 *
 * Zwei Betriebsarten unter demselben Bauteil:
 *  - /g/<token>: die Galerie fuer die Gaeste, mit Download aufs Handy.
 *  - /s/<token>: die schreibgeschuetzte Statusseite fuer den Gastgeber. Nur
 *    lesen, keine Aktionen - damit er die Box im Blick hat, ohne etwas
 *    verstellen zu koennen.
 */
export function HandyGalerie({ token, nurStatus }: { token: string; nurStatus?: boolean }) {
  const [galerie, setzeGalerie] = useState<GalerieDaten | null>(null);
  const [status, setzeStatus] = useState<StatusDaten | null>(null);
  const [stand, setzeStand] = useState<string | null>(null);
  /*
   * Zwei Arten von Fehlern, frueher in einen Topf geworfen:
   *  - ungueltig: Der Server kennt den Link nicht (404) - er wurde erneuert
   *    oder die Feier ist vorbei.
   *  - getrennt: Keine Antwort, etwa weil das Handy kurz aus dem WLAN war.
   * Vorher machte schon ein einziger Aussetzer die Galerie dauerhaft zu "Dieser
   * Link gilt nicht mehr" - auch dann, wenn die naechste Abfrage laengst wieder
   * geklappt haette. Jetzt bleiben die Fotos stehen, oben steht ein Hinweis,
   * und die naechste gelungene Abfrage raeumt ihn weg.
   */
  const [ungueltig, setzeUngueltig] = useState(false);
  const [getrennt, setzeGetrennt] = useState(false);
  const [gross, setzeGross] = useState<string | null>(() => fotoAusAdresse());
  const [grossFehlt, setzeGrossFehlt] = useState(false);

  useEffect(() => {
    const laden = async () => {
      try {
        if (nurStatus) setzeStatus(await api.hole<StatusDaten>(`/api/status/${token}`));
        else setzeGalerie(await api.hole<GalerieDaten>(`/api/galerie/${token}`));
        setzeUngueltig(false);
        setzeGetrennt(false);
        setzeStand(new Date().toISOString());
      } catch (ursache) {
        if (ursache instanceof ApiFehler && ursache.status === 404) setzeUngueltig(true);
        else setzeGetrennt(true);
      }
    };
    void laden();
    // Nach einem Aussetzer schneller wieder nachsehen.
    const uhr = setInterval(laden, nurStatus ? 10_000 : getrennt ? 5_000 : NACHLADEN_MS);
    return () => clearInterval(uhr);
  }, [token, nurStatus, getrennt]);

  useEffect(() => {
    const titel = nurStatus ? status?.veranstaltung : galerie?.veranstaltung;
    if (titel) document.title = nurStatus ? `Status · ${titel}` : `Fotos · ${titel}`;
  }, [galerie?.veranstaltung, status?.veranstaltung, nurStatus]);

  /*
   * Die Zurueck-Taste des Handys schliesst das grosse Foto, statt die Galerie
   * zu verlassen. Vorher fuehrte sie aus der Galerie hinaus - bei einem
   * frisch per QR-Code geoeffneten Link auf eine leere Seite. Das offene Foto
   * steht dafuer als #kennung in der Adresse.
   */
  useEffect(() => {
    const beiZurueck = () => {
      setzeGross(fotoAusAdresse());
      setzeGrossFehlt(false);
    };
    window.addEventListener('popstate', beiZurueck);
    return () => window.removeEventListener('popstate', beiZurueck);
  }, []);

  // Die Stelle in der Liste merken - sonst beginnt sie nach jedem Foto von vorn.
  const scrollStand = useRef(0);
  useLayoutEffect(() => {
    if (gross) window.scrollTo(0, 0);
    else window.scrollTo(0, scrollStand.current);
  }, [gross]);

  function oeffne(id: string) {
    scrollStand.current = window.scrollY;
    window.history.pushState({ foto: id }, '', `${window.location.pathname}#${id}`);
    setzeGrossFehlt(false);
    setzeGross(id);
  }

  function schliesse() {
    // Ueber die Browsergeschichte, damit Knopf und Zurueck-Taste dasselbe tun.
    if (window.history.state?.foto) window.history.back();
    else {
      window.history.replaceState(null, '', window.location.pathname);
      setzeGross(null);
    }
  }

  if (ungueltig) {
    return (
      <div className="handy">
        <h1>Nicht verfügbar</h1>
        <p style={{ color: 'var(--schrift-leise)' }}>
          Dieser Link gilt nicht mehr. Frag bitte kurz beim Gastgeber nach.
        </p>
      </div>
    );
  }

  const verbindungsHinweis = getrennt && (
    <p className="handy__hinweis" role="status">
      Keine Verbindung zur Fotobox. Bist du noch in ihrem WLAN? Es geht von selbst weiter.
    </p>
  );

  if (nurStatus) {
    if (!status) return <div className="handy">{verbindungsHinweis || 'Einen Moment…'}</div>;
    return (
      <div className="handy">
        {verbindungsHinweis}
        <h1>{status.veranstaltung}</h1>
        <p className="handy__unterzeile">Status der Fotobox — aktualisiert sich von selbst.</p>
        <Statusliste
          zustand={{
            kamera: status.zustand.kamera,
            drucker: status.zustand.drucker,
            druckerStoerung:
              status.zustand.drucker === 'bereit'
                ? null
                : (STOERUNGSTEXTE[status.zustand.stoerung as keyof typeof STOERUNGSTEXTE]?.titel ??
                  'Drucker meldet einen Fehler'),
            stoerungArt: status.zustand.stoerung,
            warteschlangeOffen: status.zustand.warteschlangeOffen,
            materialRest: status.zahlen.materialRest,
            speicherFreiGb: status.zustand.speicherFreiGb,
            sitzungen: status.zahlen.sitzungen,
            drucke: status.zahlen.drucke,
          }}
          // Die Zeit der letzten gelungenen Abfrage - nicht die des Zeichnens.
          // Sonst stand bei abgerissener Verbindung eine frische Uhrzeit ueber
          // alten Zahlen.
          stand={stand ?? undefined}
        />
        <p className="handy__tipp">Hier lässt sich nichts verstellen — die Seite zeigt nur an.</p>
      </div>
    );
  }

  if (!galerie) return <div className="handy">{verbindungsHinweis || 'Einen Moment…'}</div>;

  // Vom Gastgeber herausgenommen, waehrend es hier offen war.
  const nichtMehrDa = grossFehlt || (gross !== null && !galerie.bilder.some((b) => b.id === gross));

  if (gross) {
    return (
      <div className="handy">
        {verbindungsHinweis}
        <button className="handy__zurueck" onClick={schliesse}>
          ‹ Alle Fotos
        </button>
        {nichtMehrDa ? (
          <p className="handy__unterzeile">Dieses Foto ist nicht mehr in der Galerie.</p>
        ) : (
          <>
            <img
              className="handy__bild"
              src={`/medien/galerie/${token}/${gross}.jpg?gross=1`}
              alt=""
              onError={() => setzeGrossFehlt(true)}
            />
            <a
              className="knopf knopf--haupt handy__laden"
              href={`/medien/download/${token}/${gross}.jpg`}
              download
            >
              Aufs Handy laden
            </a>
            {/* Kein Teilen-Knopf: Teilen direkt aus einer Webseite erlaubt das Handy
                nur auf verschluesselten Seiten - die Galerie laeuft offline im WLAN
                der Box. Stattdessen der Weg, der auf diesem Geraet funktioniert. */}
            <div className="handy__tipp handy__tipp--hervor handy__weg">
              <strong>Speichern und teilen</strong>
              <ol>
                {SPEICHER_WEG[GERAET].map((schritt) => (
                  <li key={schritt}>{schritt}</li>
                ))}
              </ol>
            </div>
          </>
        )}

      </div>
    );
  }

  return (
    <div className="handy">
      {verbindungsHinweis}
      <h1>{galerie.veranstaltung}</h1>
      <p className="handy__unterzeile">
        {galerie.bilder.length === 0
          ? 'Noch keine Fotos — die ersten kommen bestimmt gleich.'
          : `${mehrzahl(galerie.bilder.length, 'Foto', 'Fotos')} — tippe eines an, um es zu laden.`}
      </p>
      {galerie.bilder.length > 0 && <p className="handy__tipp handy__tipp--hervor">{SPEICHER_TIPP[GERAET]}</p>}
      <div className="handy__raster">
        {galerie.bilder.map((bild) => (
          <button key={bild.id} className="handy__kachel" onClick={() => oeffne(bild.id)}>
            <img
              src={`/medien/galerie/${token}/${bild.id}.jpg`}
              alt=""
              loading="lazy"
              // Inzwischen herausgenommen: Kachel ausblenden statt eines
              // zerbrochenen Bildsymbols. Die naechste Abfrage raeumt sie weg.
              onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = 'none')}
            />
          </button>
        ))}
      </div>
      {/* Fuer den Betreuer, bewusst unauffaellig unten rechts: die Kurzanleitung
          mit der Betreuer-PIN aufs eigene Handy. Gewollt in Kauf genommen: Wer
          die Galerie sieht, koennte sie auch laden. */}
      <a className="handy__betreuer" href={`/medien/kurzanleitung/${token}.pdf`} download>
        Für Betreuer: Kurzanleitung
      </a>
    </div>
  );
}

/** Das offene Foto steht als #kennung in der Adresse. */
function fotoAusAdresse(): string | null {
  const kennung = window.location.hash.slice(1);
  return /^[0-9a-f-]{36}$/i.test(kennung) ? kennung : null;
}
