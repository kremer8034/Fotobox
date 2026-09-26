import { spawnSync } from 'node:child_process';
import { leseKonfig } from './konfig.js';
import { richteSchriftenEin } from './fach/schriften.js';

/**
 * Schriftenordner anlegen und fontconfig bekannt machen - als Seiteneffekt
 * beim Laden dieses Moduls.
 *
 * Warum das eine eigene Datei ist und ganz oben in index.ts steht: fontconfig
 * liest FONTCONFIG_PATH beim Initialisieren der Bibliothek, und die wird
 * geladen, sobald sharp geladen wird. In einem ES-Modul werden alle Importe
 * ausgewertet, bevor die erste Zeile des Moduls laeuft - ein Aufruf im Rumpf
 * von index.ts kaeme also zu spaet, und eine selbst hinzugefuegte Schrift
 * bliebe unauffindbar. Nachgewiesen: Ohne diese Reihenfolge rendert der Test
 * "findet eine Schrift, die es nur im Schriftenordner gibt" mit der
 * Ersatzschrift.
 *
 * Dieses Modul darf deshalb nichts importieren, was seinerseits sharp zieht.
 */
const ordner = richteSchriftenEin(leseKonfig().datenpfad);

/*
 * Unter Windows reicht es nicht, FONTCONFIG_PATH zur Laufzeit zu setzen:
 * fontconfig liest die Variable dort ueber die C-Laufzeit, und die kennt nur
 * die Umgebung vom Start des Prozesses. Im Windows-Test blieb eine Schrift aus
 * dem Schriftenordner deshalb unauffindbar, obwohl alles richtig eingetragen
 * war. Also startet der Server sich unter Windows einmal selbst neu - mit den
 * Variablen von Anfang an - und reicht den Rueckgabewert durch, damit die
 * Neustart-Schleife in "Fotobox starten.bat" weiter funktioniert.
 */
if (process.platform === 'win32' && process.env.FOTOBOX_SCHRIFTEN_GESETZT !== ordner) {
  const kind = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      FONTCONFIG_PATH: ordner,
      PANGOCAIRO_BACKEND: 'fc',
      FOTOBOX_SCHRIFTEN_GESETZT: ordner,
    },
  });
  process.exit(kind.status ?? 1);
}
