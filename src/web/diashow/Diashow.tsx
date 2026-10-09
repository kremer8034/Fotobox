import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { api } from '../api.js';

export interface DiashowBild {
  id: string;
  /** Adresse des Bildes in voller Groesse. */
  url: string;
  erstellt: string;
}

/** Wie oft die Diashow nach neuen Fotos schaut. */
const NACHLADEN_MS = 10_000;
/** Ein Foto gilt als "gerade eben entstanden", solange es juenger ist als das. */
const NEU_MS = 10 * 60_000;

/**
 * Laedt die Bilder der Diashow und haelt sie aktuell. `null`, solange noch
 * nichts geladen ist - eine leere Liste heisst: Es gibt (noch) keine Fotos.
 */
export function useDiashowBilder(lade: () => Promise<DiashowBild[]>): DiashowBild[] | null {
  const [bilder, setzeBilder] = useState<DiashowBild[] | null>(null);
  const aktuell = useRef(lade);
  aktuell.current = lade;
  useEffect(() => {
    let aus = false;
    const hole = () =>
      aktuell
        .current()
        .then((neu) => {
          if (aus) return;
          // Nur neu setzen, wenn sich etwas geaendert hat - sonst springt die Anzeige.
          setzeBilder((alt) =>
            alt && alt.length === neu.length && alt.every((b, i) => b.id === neu[i]?.id) ? alt : neu,
          );
        })
        .catch(() => undefined);
    void hole();
    const uhr = setInterval(() => void hole(), NACHLADEN_MS);
    return () => {
      aus = true;
      clearInterval(uhr);
    };
  }, []);
  return bilder;
}

/**
 * Die Diashow selbst: ein Foto nach dem anderen, sanft ueberblendet und
 * langsam herangezoomt.
 *
 * Neue Fotos kommen sofort an die Reihe - wer gerade aus der Box kommt, will
 * sich auf dem grossen Bildschirm sehen. Danach laufen alle Fotos der Feier in
 * gemischter Reihenfolge, damit nicht immer dieselben vorne stehen.
 */
export function Diashow({
  bilder,
  wechselSekunden,
  kinder,
}: {
  bilder: DiashowBild[];
  wechselSekunden: number;
  /** Was ueber den Fotos liegt - Titel, Hinweise. */
  kinder?: React.ReactNode;
}) {
  const gezeigt = useRef(new Set<string>());
  const reihe = useRef<string[]>([]);
  const [jetzt, setzeJetzt] = useState<{ bild: DiashowBild; neu: boolean; nr: number } | null>(null);
  const [vorher, setzeVorher] = useState<DiashowBild | null>(null);
  const bilderJetzt = useRef(bilder);
  bilderJetzt.current = bilder;

  // Das naechste Bild: erst alles, was noch nie zu sehen war (das neueste
  // zuerst), dann eine gemischte Runde durch alle.
  const naechstes = (aktuelleId: string | null): { bild: DiashowBild; neu: boolean } | null => {
    const alle = bilderJetzt.current;
    if (alle.length === 0) return null;
    const ungesehen = alle.filter((b) => !gezeigt.current.has(b.id));
    if (ungesehen.length > 0 && gezeigt.current.size > 0) {
      const bild = ungesehen.sort((a, b) => b.erstellt.localeCompare(a.erstellt))[0]!;
      return { bild, neu: Date.now() - Date.parse(bild.erstellt) < NEU_MS };
    }
    if (reihe.current.length === 0) {
      reihe.current = mische(alle.map((b) => b.id));
      // Nicht zweimal dasselbe Bild hintereinander.
      if (reihe.current.length > 1 && reihe.current[0] === aktuelleId) reihe.current.push(reihe.current.shift()!);
    }
    while (reihe.current.length > 0) {
      const id = reihe.current.shift()!;
      const bild = alle.find((b) => b.id === id);
      if (bild) return { bild, neu: false };
    }
    return null;
  };

  const jetztRef = useRef(jetzt);
  jetztRef.current = jetzt;
  const zeigeNaechstes = () => {
    const alt = jetztRef.current;
    const n = naechstes(alt?.bild.id ?? null);
    if (!n) return;
    gezeigt.current.add(n.bild.id);
    setzeVorher(alt?.bild ?? null);
    setzeJetzt({ ...n, nr: (alt?.nr ?? 0) + 1 });
  };

  // Erstes Bild, sobald es Bilder gibt.
  useEffect(() => {
    if (!jetzt && bilder.length > 0) {
      // Beim ersten Mal alle als bekannt merken - "neu" ist erst, was danach kommt.
      for (const b of bilder) gezeigt.current.add(b.id);
      const start = [...bilder].sort((a, b) => b.erstellt.localeCompare(a.erstellt))[0]!;
      reihe.current = mische(bilder.map((b) => b.id).filter((id) => id !== start.id));
      setzeJetzt({ bild: start, neu: Date.now() - Date.parse(start.erstellt) < NEU_MS, nr: 1 });
    }
    // Ein Bild, das inzwischen aus der Galerie genommen wurde, verschwindet sofort.
    if (jetzt && !bilder.some((b) => b.id === jetzt.bild.id)) zeigeNaechstes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bilder]);

  useEffect(() => {
    if (!jetzt) return;
    const uhr = setTimeout(zeigeNaechstes, Math.max(3, wechselSekunden) * 1000);
    return () => clearTimeout(uhr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jetzt?.nr, wechselSekunden]);

  // Vorladen: Das kommende Bild liegt schon im Speicher des Browsers.
  useEffect(() => {
    const kandidat = reihe.current[0] ? bilder.find((b) => b.id === reihe.current[0]) : null;
    if (kandidat) new Image().src = kandidat.url;
  }, [jetzt?.nr, bilder]);

  const dauer = `${Math.max(3, wechselSekunden) + 1.5}s`;
  return (
    <div className="diashow">
      {vorher && (
        <div className="diashow__bild diashow__bild--vorher" key={`v-${vorher.id}-${jetzt?.nr ?? 0}`}>
          <div className="diashow__hg" style={{ backgroundImage: `url("${vorher.url}")` }} />
          <img src={vorher.url} alt="" />
        </div>
      )}
      {jetzt && (
        <div
          className="diashow__bild diashow__bild--jetzt"
          key={`j-${jetzt.bild.id}-${jetzt.nr}`}
          style={{ '--diashow-dauer': dauer } as React.CSSProperties}
        >
          <div className="diashow__hg" style={{ backgroundImage: `url("${jetzt.bild.url}")` }} />
          <img src={jetzt.bild.url} alt="" />
          {jetzt.neu && <div className="diashow__neu">Gerade eben entstanden</div>}
        </div>
      )}
      {kinder}
    </div>
  );
}

function mische<T>(liste: T[]): T[] {
  const kopie = [...liste];
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopie[i], kopie[j]] = [kopie[j]!, kopie[i]!];
  }
  return kopie;
}

/**
 * Die Diashow am Startbildschirm: Steht die Box eine Weile unberuehrt, laufen
 * die Fotos der Feier - unten laedt ein Band zum Mitmachen ein. Ein Tipp
 * irgendwohin holt den Startbildschirm zurueck (und loest nicht gleich etwas
 * aus). Ohne Fotos gibt es nichts zu zeigen; dann bleibt der Start stehen.
 */
export function KioskDiashow({
  wechselSekunden,
  titel,
  beiEnde,
}: {
  wechselSekunden: number;
  titel?: string;
  beiEnde: () => void;
}) {
  const bilder = useDiashowBilder(async () =>
    (await api.hole<{ bilder: { id: string; erstellt: string }[] }>('/api/kiosk/diashow')).bilder.map((b) => ({
      id: b.id,
      erstellt: b.erstellt,
      url: `/medien/ausgabe/${b.id}.jpg`,
    })),
  );
  const ende = useRef(beiEnde);
  ende.current = beiEnde;
  useEffect(() => {
    if (bilder && bilder.length === 0) ende.current();
  }, [bilder]);

  if (!bilder || bilder.length === 0) return null;
  return (
    <div className="diashow--kiosk" onClick={beiEnde} role="button" aria-label="Zurück zum Start">
      <Diashow
        bilder={bilder}
        wechselSekunden={wechselSekunden}
        kinder={
          <>
            {titel && <div className="diashow__titel">{titel}</div>}
            <div className="diashow__einladung">
              <span className="diashow__finger" aria-hidden="true" />
              Tippt auf den Bildschirm – und macht euer eigenes Foto!
            </div>
          </>
        }
      />
    </div>
  );
}
