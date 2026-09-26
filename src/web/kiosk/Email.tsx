import { useRef, useState } from 'react';
import { useZeitgeber } from './zeitgeber.js';
import { api } from '../api.js';
import { pruefeAdresse } from '../../shared/adresse.js';
import { tippeInAdresse } from './adresse-tippen.js';

/*
 * Tastaturbelegung. QWERTZ, weil das die Gaeste von ihrem eigenen Handy kennen,
 * und nur Kleinbuchstaben: E-Mail-Adressen unterscheiden nicht zwischen gross
 * und klein, und eine Umschalttaste waere nur eine Gelegenheit zum Vertippen.
 */
const ANBIETER = ['@', '@gmail.com', '@web.de', '@gmx.de', '@t-online.de', '.de', '.com'];
const REIHEN = [
  '1234567890'.split(''),
  'qwertzuiop'.split(''),
  [...'asdfghjkl'.split(''), '_'],
  [...'yxcvbnm'.split(''), '.', '-'],
];

/** Wie lange die Maske offen bleibt, wenn niemand mehr tippt. */
const LEERLAUF_MS = 60_000;

type Zustand = 'eingabe' | 'senden' | 'fertig';

/**
 * Foto per E-Mail - mit eigener Bildschirmtastatur.
 *
 * Am Kiosk haengt keine Tastatur, und die Windows-Bildschirmtastatur springt
 * im Vollbild-Browser unzuverlaessig auf. Deshalb ist die Adresse auch kein
 * Eingabefeld, sondern eine Anzeige: Ein fokussiertes Feld wuerde Windows
 * genau diese Tastatur aufrufen lassen, und die laege dann ueber unserer.
 *
 * Die Einwilligung muss aktiv angetippt werden - ein vorausgefuelltes Haekchen
 * ist nach DSGVO keine Einwilligung.
 */
export function EmailEingabe({
  ausgabeId,
  einwilligungstext,
  beiSchliessen,
}: {
  ausgabeId: string;
  einwilligungstext: string;
  beiSchliessen: () => void;
}) {
  const [adresse, setzeAdresse] = useState('');
  const [einverstanden, setzeEinverstanden] = useState(false);
  const [zustand, setzeZustand] = useState<Zustand>('eingabe');
  const [fehler, setzeFehler] = useState<string | null>(null);
  // Ein Ref, kein Zustand: Zwei Tipper im selben Bildaufbau saehen "eingabe"
  // beide noch und verschickten zwei Mails.
  const sendetGerade = useRef(false);

  // Wer mitten in der Eingabe weggeht, blockiert sonst die Box fuer den
  // naechsten Gast. Jeder Tipper setzt die Uhr zurueck.
  useZeitgeber(
    beiSchliessen,
    zustand === 'senden' ? null : zustand === 'fertig' ? 4000 : LEERLAUF_MS,
    [adresse, einverstanden, zustand, fehler],
  );

  // Dieselbe Regel wie auf dem Server: "Senden" ist nur frei, wenn er die
  // Adresse auch annimmt.
  const siehtGutAus = pruefeAdresse(adresse);
  const bereit = siehtGutAus && einverstanden && zustand === 'eingabe';

  if (zustand === 'fertig') {
    return (
      <div className="quittung">
        <div className="quittung__karte">
          <p className="quittung__text">Ist unterwegs!</p>
          <p className="untertitel">
            Schau in ein paar Minuten in dein Postfach — notfalls auch im Spam-Ordner.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="email">
      <div className="email__kopf">
        {/* Anzeige statt Eingabefeld - siehe oben. */}
        <div className={`email__feld${adresse ? '' : ' email__feld--leer'}`} aria-live="polite">
          {adresse ? zeigeEnde(adresse) : 'deine@adresse.de'}
          <span className="email__schreibmarke" />
        </div>
        <button className="knopf knopf--haupt" disabled={!bereit} onClick={() => void senden()}>
          {zustand === 'senden' ? 'Wird verschickt…' : 'Senden'}
        </button>
      </div>

      <div className="email__kopf">
        <button
          className={`einwilligung${einverstanden ? ' einwilligung--an' : ''}`}
          onClick={() => setzeEinverstanden((a) => !a)}
          aria-pressed={einverstanden}
        >
          <span className="einwilligung__kasten">{einverstanden ? '✓' : ''}</span>
          <span className="einwilligung__text">{einwilligungstext}</span>
        </button>
        <button className="knopf knopf--neben" onClick={beiSchliessen}>
          Abbrechen
        </button>
      </div>

      {fehler && <p className="email__fehler">{fehler}</p>}

      <div className="tastatur">
        <div className="tastatur__reihe">
          {ANBIETER.map((t) => (
            <button key={t} className="taste taste--breit" onClick={() => tippe(t)}>
              {t}
            </button>
          ))}
        </div>
        {REIHEN.map((reihe, i) => (
          <div className="tastatur__reihe" key={i}>
            {reihe.map((t) => (
              <button key={t} className="taste" onClick={() => tippe(t)}>
                {t}
              </button>
            ))}
            {i === REIHEN.length - 1 && (
              <button
                className="taste taste--loeschen"
                onClick={() => setzeAdresse((a) => a.slice(0, -1))}
                aria-label="Letztes Zeichen löschen"
              >
                ⌫
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  function tippe(zeichen: string) {
    setzeFehler(null);
    setzeAdresse((a) => tippeInAdresse(a, zeichen));
  }

  async function senden() {
    if (sendetGerade.current) return;
    sendetGerade.current = true;
    setzeZustand('senden');
    setzeFehler(null);
    try {
      await api.sende('/api/kiosk/email', { ausgabeId, adresse, einwilligung: true });
      setzeZustand('fertig');
    } catch (u) {
      // Die Texte vom Server sind schon fuer Gaeste geschrieben ("Diese Adresse
      // sieht nicht richtig aus.", "Die Box ist gerade nicht online.").
      setzeFehler(u instanceof Error ? u.message : 'Hat nicht geklappt.');
      setzeZustand('eingabe');
    } finally {
      sendetGerade.current = false;
    }
  }
}

/**
 * Eine lange Adresse zeigt ihr Ende, nicht ihren Anfang: Dort wird gerade
 * getippt, und dort sieht man den Tippfehler.
 */
function zeigeEnde(text: string): string {
  const MAX = 34;
  return text.length > MAX ? `…${text.slice(-(MAX - 1))}` : text;
}
