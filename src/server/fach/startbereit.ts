import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { leseGeraet } from '../db/geraet.js';
import { holeVorlage } from './vorlagen.js';
import { wurzelpfade } from './pfade.js';
import { lanAdresse } from '../netzwerk.js';
import type { Veranstaltung } from '../../shared/typen.js';
import type { Betrieb } from '../betrieb.js';
import type { Konfig } from '../konfig.js';

/**
 * Startbereit-Check.
 *
 * Eine Seite, die vor dem Losgehen alles einmal durchprueft. Der groesste
 * Praxisgewinn fuer den Verleih: Ein leeres Farbband merkt man sonst erst,
 * wenn die ersten Gaeste anstehen.
 *
 * Bewusst OHNE Testdruck - der verbraucht nur Material, und das Einlegen der
 * Rolle war in der Praxis noch nie das Problem. Der Probedruck gehoert in den
 * Vorlagen-Editor.
 */

export interface Pruefpunkt {
  schluessel: string;
  titel: string;
  bestanden: boolean;
  hinweis: string;
  /** Warnungen halten den Start nicht auf, Fehler schon. */
  nurWarnung?: boolean;
}

export interface Startbereitergebnis {
  bestanden: boolean;
  punkte: Pruefpunkt[];
}

export async function startbereitPruefung(
  event: Veranstaltung,
  betrieb: Betrieb,
  konfig: Konfig,
): Promise<Startbereitergebnis> {
  const punkte: Pruefpunkt[] = [];
  const status = await betrieb.status();
  const geraet = leseGeraet();
  const wurzel = wurzelpfade(konfig.datenpfad);

  punkte.push({
    schluessel: 'kamera',
    titel: 'Kamera verbunden, Live-View liefert ein Bild',
    bestanden: status.kamera === 'bereit',
    hinweis:
      status.kamera === 'bereit'
        ? 'Kamera antwortet.'
        : 'Kamera meldet sich nicht. USB-Kabel und digiCamControl pruefen.',
  });

  punkte.push({
    schluessel: 'drucker',
    titel: 'Drucker eingeschaltet, bereit und ohne Fehlerzustand',
    bestanden: status.drucker === 'bereit',
    hinweis:
      status.drucker === 'bereit'
        ? 'Drucker meldet sich bereit. (Kein Testdruck - der verbraucht nur Material.)'
        : 'Drucker meldet einen Fehlerzustand.',
  });

  const materialRest = Math.max(0, event.einstellungen.materialStart - event.materialVerbraucht);
  punkte.push({
    schluessel: 'material',
    titel: 'Restbestand erfasst',
    bestanden: materialRest > 20,
    nurWarnung: true,
    hinweis: `Noch ${materialRest} Blatt. Bei Bedarf im Servicemenue "Neue Rolle eingelegt" waehlen.`,
  });

  punkte.push({
    schluessel: 'speicher',
    titel: 'Freier Speicherplatz ueber der Warnschwelle',
    bestanden: status.speicherFreiGb >= geraet.speicherWarnungGb,
    hinweis: `${status.speicherFreiGb} GB frei, Warnschwelle ${geraet.speicherWarnungGb} GB.`,
  });

  // Vorlagen samt aller Bilddateien und Schriften ihrer Ebenen
  const fehlendeDateien: string[] = [];
  let vorlagenOk = event.einstellungen.vorlagen.length > 0;
  for (const id of event.einstellungen.vorlagen) {
    const vorlage = holeVorlage(id);
    if (!vorlage) {
      vorlagenOk = false;
      fehlendeDateien.push(`Vorlage ${id} fehlt`);
      continue;
    }
    for (const ebene of vorlage.ebenen) {
      if (ebene.typ === 'bild' && !existsSync(join(wurzel.vorlagen, ebene.datei))) {
        fehlendeDateien.push(`${vorlage.name}: ${ebene.datei}`);
      }
      if (ebene.typ === 'text' && ebene.schriftDatei) {
        if (!existsSync(join(wurzel.vorlagen, ebene.schriftDatei))) {
          fehlendeDateien.push(`${vorlage.name}: ${ebene.schriftDatei}`);
        }
      }
    }
  }
  punkte.push({
    schluessel: 'vorlagen',
    titel: 'Mindestens eine Vorlage zugeordnet, alle Dateien vorhanden',
    bestanden: vorlagenOk && fehlendeDateien.length === 0,
    hinweis:
      fehlendeDateien.length > 0
        ? `Fehlt: ${fehlendeDateien.join(', ')}`
        : vorlagenOk
          ? `${event.einstellungen.vorlagen.length} Vorlage(n) freigegeben.`
          : 'Der Veranstaltung ist keine Vorlage zugeordnet.',
  });

  if (event.einstellungen.galerieAktiv) {
    const adresse = lanAdresse();
    punkte.push({
      schluessel: 'galerie',
      titel: 'Galerie im Netz erreichbar',
      bestanden: adresse !== null,
      hinweis: adresse
        ? `Galerie laeuft unter http://${adresse}:${konfig.portOeffentlich}/g/${event.galerieToken}`
        : 'Keine Netzwerkadresse gefunden. Haengt die Box am Reise-Router?',
    });
  }

  punkte.push({
    schluessel: 'pins',
    titel: 'Besitzer-PIN und Betreuer-PIN gesetzt',
    bestanden: geraet.besitzerPinHash !== null && event.betreuerPinHash !== null,
    hinweis:
      geraet.besitzerPinHash === null
        ? 'Es gibt keine Besitzer-PIN. Ohne sie laesst sich kein Event starten.'
        : event.betreuerPinHash === null
          ? 'Die Betreuer-PIN fehlt - der Gastgeber kaeme an nichts heran.'
          : 'Beide PINs sind gesetzt.',
  });

  punkte.push({
    schluessel: 'unterlagen',
    titel: event.einstellungen.galerieAktiv
      ? 'Kurzanleitung und QR-Aushang ausgedruckt'
      : 'Kurzanleitung ausgedruckt',
    bestanden: true,
    nurWarnung: true,
    hinweis: 'Bitte vor Ort in die Box legen bzw. aussen ankleben.',
  });

  punkte.push({
    schluessel: 'windows',
    titel: 'Windows vorbereitet',
    bestanden: true,
    nurWarnung: true,
    hinweis:
      'Anzeigeskalierung 100 %, Bildschirmschoner und Energiesparen aus, ' +
      'Benachrichtigungen stumm, Update-Neustarts unterdrueckt.',
  });

  const bestanden = punkte.every((p) => p.bestanden || p.nurWarnung === true);
  return { bestanden, punkte };
}
