/**
 * Toene ohne Audiodateien: kurze Sinustoene aus der Web-Audio-Schnittstelle.
 * Auf einer lauten Feier ist der Countdown-Ton oft wichtiger als die Zahl auf
 * dem Bildschirm.
 */
let kontext: AudioContext | null = null;

function hole(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  kontext ??= new AudioContext();
  void kontext.resume();
  return kontext;
}

function ton(frequenz: number, dauerMs: number, lautstaerke = 0.15): void {
  const ac = hole();
  if (!ac) return;
  const oszillator = ac.createOscillator();
  const huellkurve = ac.createGain();
  oszillator.type = 'sine';
  oszillator.frequency.value = frequenz;
  huellkurve.gain.setValueAtTime(0, ac.currentTime);
  huellkurve.gain.linearRampToValueAtTime(lautstaerke, ac.currentTime + 0.01);
  huellkurve.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dauerMs / 1000);
  oszillator.connect(huellkurve).connect(ac.destination);
  oszillator.start();
  oszillator.stop(ac.currentTime + dauerMs / 1000);
}

export const toene = {
  countdown: () => ton(880, 120),
  ausloeser: () => {
    ton(1320, 90, 0.22);
    setTimeout(() => ton(990, 160, 0.18), 90);
  },
  ergebnis: () => {
    ton(660, 120, 0.15);
    setTimeout(() => ton(880, 200, 0.15), 120);
  },
};
