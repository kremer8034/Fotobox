/**
 * Der Zustand der Box als Ampel - fuer "Was ist los?", das Servicemenue und
 * die Statusseite am Handy.
 *
 * Alle drei zeigten vorher dieselben Zahlen als Textliste: "Drucker: in
 * Ordnung", "0 Foto(s) warten". Wer nicht weiss, was normal ist, sieht darin
 * nicht, ob etwas fehlt. Hier sagt die Farbe es zuerst, und was nicht stimmt,
 * steht oben.
 */

export type Ampel = 'gut' | 'warnung' | 'fehler';

export interface Boxzustand {
  kamera: string;
  drucker: string;
  druckerStoerung?: string | null;
  /** Welche Stoerung, als Schluessel - etwa "papier-leer". */
  stoerungArt?: string | null;
  warteschlangeOffen: number;
  materialRest: number;
  speicherFreiGb: number;
  sitzungen: number;
  drucke: number;
}

interface Eintrag {
  ampel: Ampel;
  text: string;
}

export function mehrzahl(n: number, eins: string, viele: string): string {
  return `${n} ${n === 1 ? eins : viele}`;
}

export function statusEintraege(z: Boxzustand): Eintrag[] {
  const druckerOk = z.drucker === 'bereit';
  const liste = [
    z.kamera === 'bereit'
      ? { ampel: 'gut', text: 'Kamera in Ordnung' }
      : { ampel: 'fehler', text: 'Kamera meldet sich nicht' },
    druckerOk
      ? { ampel: 'gut', text: 'Drucker in Ordnung' }
      : { ampel: 'fehler', text: z.druckerStoerung ?? 'Drucker meldet einen Fehler' },
    // Meldet der Drucker selbst "Papier leer", gilt das - der Zaehler ist nur
    // eine Schaetzung. Beide Zeilen nebeneinander ergaben vorher "Papier ist
    // leer" in Rot und "Noch 700 Blatt" in Gruen, und niemand wusste, was
    // stimmt.
    z.stoerungArt === 'papier-leer'
      ? null
      : z.materialRest <= 0
      ? { ampel: 'fehler', text: 'Kein Papier mehr' }
      : z.materialRest < 50
        ? { ampel: 'warnung', text: `Nur noch ${mehrzahl(z.materialRest, 'Blatt', 'Blatt')} Papier` }
        : { ampel: 'gut', text: `Noch ${z.materialRest} Blatt Papier` },
    // Eine volle Warteschlange ist bei laufendem Drucker normal - er druckt
    // gerade. Zur Warnung wird sie erst, wenn der Drucker steht.
    z.warteschlangeOffen === 0
      ? { ampel: 'gut', text: 'Nichts wartet auf den Druck' }
      : druckerOk
        ? { ampel: 'gut', text: `${mehrzahl(z.warteschlangeOffen, 'Foto wird', 'Fotos werden')} gerade gedruckt` }
        : {
            ampel: 'warnung',
            text: `${mehrzahl(z.warteschlangeOffen, 'Foto wartet', 'Fotos warten')} auf den Druck`,
          },
    z.speicherFreiGb < 2
      ? { ampel: 'fehler', text: `Speicher fast voll (${z.speicherFreiGb} GB frei)` }
      : z.speicherFreiGb < 10
        ? { ampel: 'warnung', text: `Speicher wird knapp (${z.speicherFreiGb} GB frei)` }
        : { ampel: 'gut', text: `${z.speicherFreiGb} GB Speicher frei` },
  ];
  // Was nicht stimmt, zuerst.
  const rang: Record<Ampel, number> = { fehler: 0, warnung: 1, gut: 2 };
  return liste
    .filter((e): e is Eintrag => e !== null)
    .sort((a, b) => rang[a.ampel] - rang[b.ampel]);
}

export function Statusliste({ zustand, stand }: { zustand: Boxzustand; stand?: string }) {
  const eintraege = statusEintraege(zustand);
  const schlimmste = eintraege[0]?.ampel ?? 'gut';

  return (
    <div className="statusliste">
      <p className={`statusliste__fazit statusliste__fazit--${schlimmste}`}>
        {schlimmste === 'gut'
          ? 'Alles in Ordnung.'
          : schlimmste === 'warnung'
            ? 'Läuft — aber bald braucht es jemanden:'
            : 'Hier stimmt etwas nicht:'}
      </p>
      <ul className="statusliste__liste">
        {eintraege.map((e) => (
          <li key={e.text} className={`statusliste__eintrag statusliste__eintrag--${e.ampel}`}>
            <span className="statusliste__punkt" aria-hidden="true">
              {e.ampel === 'gut' ? '✓' : e.ampel === 'warnung' ? '!' : '✕'}
            </span>
            {e.text}
          </li>
        ))}
      </ul>
      <p className="statusliste__zahlen">
        {mehrzahl(zustand.sitzungen, 'Durchgang', 'Durchgänge')},{' '}
        {mehrzahl(zustand.drucke, 'Ausdruck', 'Ausdrucke')} bisher
        {stand && (
          <>
            {' · '}Stand {new Date(stand).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
          </>
        )}
      </p>
    </div>
  );
}
