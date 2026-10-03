/**
 * Gemeinsames fuer alle Aufrufe der Windows-PowerShell.
 *
 * Laeuft PowerShell mit umgeleiteter Ausgabe, schreibt sie Fortschritts-
 * anzeigen ("Preparing modules for first use") als CLIXML in den Fehlerkanal.
 * Wer dort die Fehlermeldung sucht, findet dann XML statt des Grundes - so
 * geschehen im Windows-Probelauf: Statt "Windows kennt keinen Drucker ..."
 * kam nur "<Objs ...>Preparing modules...</Objs>" in der Verwaltung an.
 */

/** Vor jedes Skript setzen: keine Fortschrittsanzeigen, die den Fehlerkanal fuellen. */
export const OHNE_FORTSCHRITT = "$ProgressPreference = 'SilentlyContinue'; ";

/** Aus dem Fehlerkanal von PowerShell die letzte lesbare Zeile holen. */
export function lesbarerFehler(stderr: string): string {
  const ohneXml = stderr.replace(/#< CLIXML/g, '').replace(/<Objs[\s\S]*?<\/Objs>/g, '');
  return (
    ohneXml
      .split(/\r?\n/)
      .map((zeile) => zeile.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  );
}
