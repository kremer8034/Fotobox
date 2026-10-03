import { useEffect, useState } from 'react';
import { toene } from './toene.js';
import { EmailEingabe } from './Email.js';
import { Mengenwahl, Quittung, useDrucken } from './Drucken.js';
import { useZeitgeber } from './zeitgeber.js';
import { api } from '../api.js';

/**
 * Ergebnis und Ausgabe auf einer Seite: das fertige Layout gross oben, darunter
 * nur die tatsaechlich freigeschalteten Knoepfe. Kein Zeitlimit fuer die
 * Entscheidung - der Gast sieht sein Bild und entscheidet in Ruhe; erst wenn er
 * gar nichts tut, kehrt die Box nach der eingestellten Zeit zum Start zurueck.
 *
 * Es wird nie ungefragt gedruckt: Ohne bewusstes Antippen bleibt das Layout
 * digital.
 */
export function Ergebnis({
  ausgabeId,
  ausgabe,
  rueckkehrSekunden,
  tonAn,
  beiFertig,
}: {
  ausgabeId: string;
  ausgabe: {
    druckAktiv: boolean;
    emailAktiv: boolean;
    einwilligungstext: string;
    kopienVorgabe: number;
    kopienMax: number;
    druckLimitErreicht: boolean;
    druckRest?: number | null;
  };
  rueckkehrSekunden: number;
  tonAn: boolean;
  beiFertig: () => void;
}) {
  // Nie mehr anbieten, als das Druck-Limit der Feier noch hergibt.
  const hoechstens = Math.min(ausgabe.kopienMax, ausgabe.druckRest ?? Infinity);
  const [kopien, setzeKopien] = useState(Math.max(1, Math.min(ausgabe.kopienVorgabe, hoechstens)));
  const [emailOffen, setzeEmailOffen] = useState(false);
  // Erst fragen, dann loeschen - ein Fehltipp soll kein Foto kosten.
  const [loeschenFragen, setzeLoeschenFragen] = useState(false);
  const [loeschFehler, setzeLoeschFehler] = useState<string | null>(null);
  // Jede Beruehrung zaehlt als Eingabe. Vorher lief die Uhr auch weiter,
  // waehrend der Gast an der Kopienzahl drehte - und die Seite verschwand
  // unter seinem Finger.
  const [beruehrt, setzeBeruehrt] = useState(0);
  // Nach dem Drucken ging es vorher sofort zum Start - wer danach das Foto
  // noch per E-Mail wollte, kam nicht mehr heran. Gibt es E-Mail, bleibt die
  // Seite stehen (ohne Druckknopf, damit niemand aus Versehen nachlegt), und
  // die normale Rueckkehr-Uhr uebernimmt.
  const [gedruckt, setzeGedruckt] = useState(false);
  const druck = useDrucken(ausgabeId, 'kiosk', () => {
    if (ausgabe.emailAktiv) setzeGedruckt(true);
    else beiFertig();
  });

  useEffect(() => {
    if (tonAn) toene.ergebnis();
  }, [tonAn]);

  // Rueckkehr zum Startbildschirm, wenn der Gast gar nichts tut. Das lief
  // vorher nie ab (siehe zeitgeber.ts) - der naechste Gast stand vor dem Foto
  // seines Vorgaengers, mit aktivem Druckknopf. Waehrend der E-Mail-Eingabe
  // steht die Uhr: Wer eine Adresse tippt, braucht laenger als 20 Sekunden,
  // und die Eingabe hat ihren eigenen Leerlauf.
  useZeitgeber(beiFertig, emailOffen || loeschenFragen ? null : rueckkehrSekunden * 1000, [druck.quittung, beruehrt]);

  async function loeschen() {
    try {
      await api.sende(`/api/kiosk/ausgabe/${ausgabeId}/loeschen`, {});
      beiFertig();
    } catch (fehler) {
      setzeLoeschenFragen(false);
      setzeLoeschFehler(fehler instanceof Error ? fehler.message : 'Das Foto ließ sich nicht löschen.');
    }
  }

  const druckMoeglich = ausgabe.druckAktiv && !ausgabe.druckLimitErreicht && hoechstens >= 1 && !gedruckt;

  return (
    <div
      className="seite kiosk"
      style={{ position: 'relative' }}
      onPointerDown={() => setzeBeruehrt((n) => n + 1)}
    >
      <img className="ergebnis__bild" src={`/medien/ausgabe/${ausgabeId}.jpg`} alt="Dein Foto" />

      <div className="ergebnis__leiste">
        {druckMoeglich && (
          <>
            <Mengenwahl kopien={Math.min(kopien, hoechstens)} max={hoechstens} beiAendern={setzeKopien} />
            <button
              className="knopf knopf--haupt"
              onClick={() => void druck.drucke(Math.min(kopien, hoechstens))}
              disabled={druck.beschaeftigt}
            >
              {Math.min(kopien, hoechstens) === 1 ? 'Drucken' : `${Math.min(kopien, hoechstens)}× drucken`}
            </button>
          </>
        )}

        {/* Ist der E-Mail-Versand aus, ist der Knopf nicht ausgegraut,
            sondern gar nicht da. */}
        {ausgabe.emailAktiv && (
          <button className="knopf" onClick={() => setzeEmailOffen(true)}>
            Per E-Mail schicken
          </button>
        )}

        <button className="knopf" onClick={beiFertig}>
          Fertig
        </button>

        {/* Gefaellt das Foto nicht: weg damit - es wird nicht gedruckt und
            erscheint in keiner Galerie. In der Galerie selbst gibt es das
            bewusst nicht, sonst koennte jeder fremde Fotos loeschen. */}
        <button className="knopf ergebnis__loeschen" onClick={() => setzeLoeschenFragen(true)}>
          Löschen
        </button>
      </div>

      {loeschenFragen && (
        <div className="quittung">
          <div className="quittung__karte">
            <p className="quittung__text">Foto wirklich löschen?</p>
            <p style={{ margin: '0 0 1.2rem', color: 'var(--schrift-leise)' }}>
              {gedruckt
                ? 'Es erscheint in keiner Galerie. Ein Ausdruck, der noch auf den Drucker wartet, wird abgebrochen.'
                : 'Es wird nicht gedruckt und erscheint in keiner Galerie.'}
            </p>
            <div className="ergebnis__frage">
              <button className="knopf knopf--haupt" onClick={() => setzeLoeschenFragen(false)}>
                Behalten
              </button>
              <button className="knopf ergebnis__loeschen" onClick={() => void loeschen()}>
                Ja, löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {loeschFehler && (
        <Quittung text={loeschFehler} fehlgeschlagen beiZurueck={() => setzeLoeschFehler(null)} />
      )}

      {emailOffen && (
        <EmailEingabe
          ausgabeId={ausgabeId}
          einwilligungstext={ausgabe.einwilligungstext}
          beiSchliessen={() => setzeEmailOffen(false)}
        />
      )}

      {druck.quittung && (
        <Quittung
          text={druck.quittung.text}
          fehlgeschlagen={druck.quittung.fehlgeschlagen}
          beiZurueck={druck.schliesseQuittung}
        />
      )}
    </div>
  );
}
