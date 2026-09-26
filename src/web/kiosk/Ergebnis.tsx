import { useEffect, useState } from 'react';
import { toene } from './toene.js';
import { EmailEingabe } from './Email.js';
import { Mengenwahl, Quittung, useDrucken } from './Drucken.js';
import { useZeitgeber } from './zeitgeber.js';

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
  // Jede Beruehrung zaehlt als Eingabe. Vorher lief die Uhr auch weiter,
  // waehrend der Gast an der Kopienzahl drehte - und die Seite verschwand
  // unter seinem Finger.
  const [beruehrt, setzeBeruehrt] = useState(0);
  const druck = useDrucken(ausgabeId, 'kiosk', beiFertig);

  useEffect(() => {
    if (tonAn) toene.ergebnis();
  }, [tonAn]);

  // Rueckkehr zum Startbildschirm, wenn der Gast gar nichts tut. Das lief
  // vorher nie ab (siehe zeitgeber.ts) - der naechste Gast stand vor dem Foto
  // seines Vorgaengers, mit aktivem Druckknopf. Waehrend der E-Mail-Eingabe
  // steht die Uhr: Wer eine Adresse tippt, braucht laenger als 20 Sekunden,
  // und die Eingabe hat ihren eigenen Leerlauf.
  useZeitgeber(beiFertig, emailOffen ? null : rueckkehrSekunden * 1000, [druck.quittung, beruehrt]);

  const druckMoeglich = ausgabe.druckAktiv && !ausgabe.druckLimitErreicht && hoechstens >= 1;

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
      </div>

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
