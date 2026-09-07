/**
 * Kamera-Anbindung.
 *
 * digiCamControl ist keine Programmbibliothek, sondern ein eigenstaendiges
 * Windows-Programm mit Fenster. Deshalb kapseln wir es hinter dieser
 * Schnittstelle: Sollte es eines Tages an einem Windows-Update scheitern, ist
 * der Ersatz (Canons EDSDK oder gphoto2 unter WSL) ein austauschbares Stueck
 * und kein Umbau der ganzen Software.
 *
 * Einen Webcam-Notbetrieb gibt es bewusst nicht. Die Box laeuft mit der 600D
 * oder gar nicht.
 */

export interface KameraStatus {
  verbunden: boolean;
  liveViewLaeuft: boolean;
  meldung?: string;
}

export interface KameraTreiber {
  readonly name: string;
  /** Verbindung aufbauen bzw. pruefen. Wirft nicht, meldet nur den Zustand. */
  pruefe(): Promise<KameraStatus>;
  starteLiveView(): Promise<void>;
  stoppeLiveView(): Promise<void>;
  /** Ein einzelnes Live-View-Bild als JPEG. null, wenn gerade keines vorliegt. */
  liveBild(): Promise<Buffer | null>;
  /**
   * Loest aus. Die Datei landet im konfigurierten Zielordner der Kamera-Software;
   * der Aufrufer wartet ueber den Dateiwaechter darauf. Zurueckgegeben wird nur,
   * ob der Ausloesebefehl angenommen wurde.
   */
  ausloesen(): Promise<void>;
  /** Zielordner setzen, in den die Kamera-Software die Aufnahmen ablegt. */
  setzeZielordner(pfad: string): Promise<void>;
  setzeBelichtung(werte: { iso?: string; blende?: string; verschlusszeit?: string }): Promise<void>;
}
