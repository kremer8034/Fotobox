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
richteSchriftenEin(leseKonfig().datenpfad);
