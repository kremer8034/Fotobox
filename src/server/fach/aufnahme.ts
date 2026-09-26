import chokidar from 'chokidar';
import { mkdirSync, readdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Wartet darauf, dass die Kamera-Software eine neue Datei im ueberwachten
 * Ordner ablegt.
 *
 * Zwei Fallstricke, die hier abgefangen werden:
 *  - Der Dateiwaechter meldet die Datei, bevor sie fertig geschrieben ist.
 *    Deshalb wird gewartet, bis die Dateigroesse stabil ist.
 *  - Faellt die Kamera aus, darf nicht ewig gewartet werden; das Zeitlimit
 *    fuehrt zu einem sauberen Fehler, den die Oberflaeche als freundlichen
 *    Wartehinweis zeigt.
 */
export type Dateiwarten = Promise<string> & {
  /** Erfuellt, sobald der Waechter wirklich zuschaut - erst dann ausloesen. */
  bereit: Promise<void>;
};

export function warteAufNeueDatei(
  ordner: string,
  optionen: { zeitlimitMs?: number; muster?: RegExp; abbruch?: AbortSignal } = {},
): Dateiwarten {
  const zeitlimit = optionen.zeitlimitMs ?? 20_000;
  // Nur JPEG. Steht die 600D auf RAW+JPEG, kommt die .CR2 womoeglich zuerst
  // an - und die kann sharp nicht lesen. Frueher wurde sie trotzdem genommen,
  // und die Sitzung scheiterte erst beim Zusammensetzen.
  const muster = optionen.muster ?? /\.jpe?g$/i;

  // Was schon da ist, zaehlt nicht als neu. Der Ordner muss existieren, sonst
  // bekommt der Waechter unter Windows spaeter angelegte Dateien nicht mit.
  mkdirSync(ordner, { recursive: true });
  const vorher = new Set(readdirSync(ordner));

  let meldeBereit: () => void = () => undefined;
  const bereit = new Promise<void>((r) => (meldeBereit = r));

  const warten = new Promise<string>((fertig, fehler) => {
    let erledigt = false;
    const waechter = chokidar.watch(ordner, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      depth: 0,
    });
    const ende = (ergebnis: { datei: string } | { fehler: Error }) => {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(uhr);
      meldeBereit();
      void waechter.close();
      if ('datei' in ergebnis) fertig(ergebnis.datei);
      else fehler(ergebnis.fehler);
    };

    const uhr = setTimeout(
      () => ende({ fehler: new Error('Die Kamera hat innerhalb der Wartezeit keine Datei abgelegt.') }),
      zeitlimit,
    );

    waechter.on('add', (pfad) => {
      if (muster.test(pfad)) ende({ datei: pfad });
    });

    /*
     * Unter Windows braucht der Waechter nach dem Anlegen einen Moment, bis
     * er zuschaut. Was in dieser Zeit ankommt, haelt er fuer "schon da" und
     * meldet es nie (ignoreInitial) - im Windows-Test lief genau so ein Foto
     * ins Leere. Deshalb schaut er beim Bereitwerden selbst nach, was seit
     * dem Anlegen dazugekommen ist.
     */
    waechter.on('ready', () => {
      meldeBereit();
      try {
        const neu = readdirSync(ordner).find((name) => !vorher.has(name) && muster.test(name));
        if (neu) ende({ datei: join(ordner, neu) });
      } catch {
        // Der Ordner ist gerade weg; das Zeitlimit greift.
      }
    });

    waechter.on('error', (ursache) => {
      ende({ fehler: ursache instanceof Error ? ursache : new Error(String(ursache)) });
    });

    optionen.abbruch?.addEventListener('abort', () => ende({ fehler: new Error('Warten abgebrochen.') }));
  });
  // Wer das Warten abbricht - weil schon der Ausloeser scheiterte -, fragt nie
  // mehr nach dem Ergebnis. Ohne diese Zeile galt die Ablehnung als
  // unbehandelt, und Node beendete daraufhin den ganzen Server: Ein einziger
  // Ausloeser, bei dem der Autofokus nicht griff, legte die Box still. Der
  // Aufrufer bekommt die Ablehnung trotzdem, wenn er wartet.
  warten.catch(() => undefined);
  return Object.assign(warten, { bereit });
}

/** Zusaetzliche Sicherung: erst zurueckgeben, wenn die Datei wirklich lesbar ist. */
export async function warteAufStabileDatei(pfad: string, versuche = 20): Promise<void> {
  let letzteGroesse = -1;
  for (let i = 0; i < versuche; i += 1) {
    try {
      const info = await stat(pfad);
      if (info.size > 0 && info.size === letzteGroesse) return;
      letzteGroesse = info.size;
    } catch {
      // Datei noch nicht da.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}
