import chokidar from 'chokidar';
import { stat } from 'node:fs/promises';

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
export async function warteAufNeueDatei(
  ordner: string,
  optionen: { zeitlimitMs?: number; muster?: RegExp } = {},
): Promise<string> {
  const zeitlimit = optionen.zeitlimitMs ?? 20_000;
  const muster = optionen.muster ?? /\.(jpe?g|png|cr2)$/i;

  return new Promise<string>((fertig, fehler) => {
    const waechter = chokidar.watch(ordner, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      depth: 0,
    });

    const uhr = setTimeout(() => {
      void waechter.close();
      fehler(new Error('Die Kamera hat innerhalb der Wartezeit keine Datei abgelegt.'));
    }, zeitlimit);

    waechter.on('add', (pfad) => {
      if (!muster.test(pfad)) return;
      clearTimeout(uhr);
      void waechter.close();
      fertig(pfad);
    });

    waechter.on('error', (ursache) => {
      clearTimeout(uhr);
      void waechter.close();
      fehler(ursache instanceof Error ? ursache : new Error(String(ursache)));
    });
  });
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
