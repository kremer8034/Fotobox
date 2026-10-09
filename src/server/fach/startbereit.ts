import { istOnline, leseMailzugang } from './email.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { leseGeraet } from '../db/geraet.js';
import { holeVorlage } from './vorlagen.js';
import { wurzelpfade } from './pfade.js';
import { schriftenOrdner } from './schriften.js';
import { aktualisiereRoutenAdresse, alleLanAdressen, galerieBlockiert, lanAdresse, netzDiagnose } from '../netzwerk.js';
import { fotoEbenen, type Veranstaltung } from '../../shared/typen.js';
import { portalNetzEingerichtet } from '../portal/adresse.js';
import { holePortal } from '../portal/steuerung.js';
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

  // Den Probelauf schaltet man vor Ort schnell im Servicemenue ein - und
  // vergisst leicht, ihn wieder auszuschalten. Dann waere die ganze Feier
  // gratis und die Galerie leer.
  punkte.push({
    schluessel: 'probelauf',
    titel: 'Probelauf ausgeschaltet',
    bestanden: !event.probelauf,
    nurWarnung: true,
    hinweis: event.probelauf
      ? 'Der Probelauf ist noch an: Drucke werden nicht berechnet, Fotos erscheinen in keiner Galerie.'
      : 'Fotos und Drucke zählen ganz normal.',
  });

  punkte.push({
    schluessel: 'kamera',
    titel: 'Kamera verbunden, Live-View liefert ein Bild',
    bestanden: status.kamera === 'bereit',
    hinweis:
      status.kamera === 'bereit'
        ? 'Kamera antwortet.'
        : (status.kameraHinweis ?? 'Kamera meldet sich nicht. USB-Kabel und digiCamControl prüfen.'),
  });

  punkte.push({
    schluessel: 'drucker',
    titel: 'Drucker eingeschaltet, bereit und ohne Fehlerzustand',
    bestanden: status.drucker === 'bereit',
    hinweis:
      status.drucker === 'bereit'
        ? 'Drucker meldet sich bereit. (Kein Testdruck – der verbraucht nur Material.)'
        : 'Drucker meldet einen Fehlerzustand.',
  });

  // Der Vorrat kommt allein vom Drucker (DNP PrinterInfo).
  const vomDrucker = status.druckerVorrat ?? null;
  punkte.push({
    schluessel: 'material',
    titel: 'Papiervorrat laut Drucker',
    bestanden: vomDrucker !== null && vomDrucker.rest > 20,
    nurWarnung: true,
    hinweis: vomDrucker
      ? `Noch ${vomDrucker.rest} Blatt laut Drucker.`
      : 'Der Drucker meldet gerade keinen Vorrat – unter „Gerät“ → „Papiervorrat laut Drucker“ nachsehen.',
  });

  punkte.push({
    schluessel: 'speicher',
    titel: 'Freier Speicherplatz über der Warnschwelle',
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
    // Ohne sichtbare Foto-Ebene nimmt die Box kein Foto auf - der Gast
    // bekaeme nur die leere Vorlage.
    if (fotoEbenen(vorlage).length === 0) {
      fehlendeDateien.push(`${vorlage.name}: keine sichtbare Foto-Ebene`);
    }
    for (const ebene of vorlage.ebenen) {
      if (ebene.typ === 'bild' && !existsSync(join(wurzel.vorlagen, ebene.datei))) {
        fehlendeDateien.push(`${vorlage.name}: ${ebene.datei}`);
      }
      // Eigene Schriften liegen in Fotobox-Daten/schriften, nicht bei den
      // Vorlagen-Bildern. Eine geloeschte Schrift faellt sonst erst beim
      // Ausdruck auf - dann steht der Text in irgendeiner Ersatzschrift.
      if (ebene.typ === 'text' && ebene.schriftDatei) {
        if (!existsSync(join(schriftenOrdner(konfig.datenpfad), ebene.schriftDatei))) {
          fehlendeDateien.push(`${vorlage.name}: Schrift ${ebene.schrift ?? ebene.schriftDatei}`);
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
        ? `Stimmt nicht: ${fehlendeDateien.join(', ')}`
        : vorlagenOk
          ? `${event.einstellungen.vorlagen.length} Vorlage(n) freigegeben.`
          : 'Der Veranstaltung ist keine Vorlage zugeordnet.',
  });

  // E-Mail an, aber kein Mailserver: Der Knopf "Per E-Mail schicken" fehlt
  // dann still - so auf der Box geschehen. Jetzt steht hier, warum.
  if (event.einstellungen.emailAktiv) {
    const zugang = leseMailzugang() !== null;
    const online = zugang ? await istOnline() : false;
    punkte.push({
      schluessel: 'email',
      titel: 'E-Mail-Versand eingerichtet',
      bestanden: zugang && online,
      nurWarnung: true,
      hinweis: !zugang
        ? 'Kein Mailserver eingetragen (Gerät → E-Mail). Solange erscheint der Knopf „Per E-Mail schicken“ nicht.'
        : online
          ? 'Mailserver eingetragen, die Box ist online.'
          : 'Die Box ist gerade offline. Der Knopf „Per E-Mail schicken“ erscheint erst mit Internet.',
    });
  }

  if (event.einstellungen.galerieAktiv) {
    await aktualisiereRoutenAdresse();
    const adresse = lanAdresse();
    const diagnose = adresse ? await netzDiagnose(adresse) : null;
    const blockiert = diagnose ? galerieBlockiert(diagnose) : null;
    punkte.push({
      schluessel: 'galerie',
      titel: 'Galerie im Netz erreichbar',
      bestanden: adresse !== null && blockiert === null,
      hinweis: !adresse
        ? 'Keine Netzwerkadresse gefunden. Hängt die Box am Reise-Router?'
        : blockiert ??
          `Galerie läuft unter http://${adresse}:${konfig.portOeffentlich}/g/${event.galerieToken}` +
            (diagnose?.netz ? ` – die Handys müssen im WLAN „${diagnose.netz}“ sein.` : ' – die Handys müssen im selben WLAN sein wie die Box.'),
    });

    // Captive Portal (Test): Vor dem Start laufen Namensdienst und Portal noch
    // nicht - sie starten mit der Veranstaltung. Pruefen laesst sich, ob das
    // Netz eingerichtet ist und der Adressdienst ungestoert laeuft.
    if (geraet.portalAktiv) {
      const z = holePortal()?.zustand() ?? null;
      const eingerichtet = portalNetzEingerichtet();
      const problem = !eingerichtet
        ? 'Das Netz für das Portal ist nicht eingerichtet – unter „WLAN & Portal“ → Selbstdiagnose.'
        : z?.fremderDhcp
          ? `Unter ${z.fremderDhcp} verteilt noch ein anderes Gerät Adressen (vermutlich der Vonets) – dort den DHCP-Server ausschalten.`
          : z && !z.dhcp
            ? `Der Adressdienst läuft nicht. ${z.fehler.join(' ')}`
            : !geraet.wlan?.name?.trim()
              ? 'Unter „WLAN & Portal“ fehlt der WLAN-Name – ohne ihn steht in der Anleitung nur „das WLAN der Fotobox“.'
              : null;
      punkte.push({
        schluessel: 'portal',
        titel: 'Galerie öffnet sich beim WLAN-Beitritt (Test)',
        bestanden: problem === null,
        nurWarnung: true,
        hinweis: problem ?? 'Netz eingerichtet, Adressdienst läuft. Mit dem Start der Veranstaltung öffnet sich die Galerie von selbst.',
      });
    }

    // Haengt die Box zusaetzlich in einem fremden Netz (Kabel der Location,
    // Hotel-WLAN), koennte die Galerie dort statt im eigenen Router landen -
    // offen fuer alle in diesem Netz.
    const alle = alleLanAdressen();
    if (alle.length > 1) {
      punkte.push({
        schluessel: 'netze',
        titel: 'Box hängt nur im eigenen Netz',
        bestanden: false,
        nurWarnung: true,
        hinweis:
          `Die Box hat mehrere Netzwerkadressen (${alle.join(', ')}); die Galerie läuft unter ${adresse}. ` +
          'Ist das nicht der Reise-Router, andere Verbindungen trennen (Netzwerkkabel ziehen, fremdes WLAN vergessen).',
      });
    }
  }

  /*
   * Zwei getrennte Punkte: Die Besitzer-PIN gilt fuer die ganze Box und wird
   * einmal unter "Geraet" gesetzt, die Betreuer-PIN gehoert zur einzelnen
   * Veranstaltung. Vorher standen beide in einem Punkt "Besitzer-PIN und
   * Betreuer-PIN gesetzt" - fehlte bei einer neuen Feier nur die
   * Betreuer-PIN, sah es aus, als fehle die Besitzer-PIN.
   */
  punkte.push({
    schluessel: 'besitzerPin',
    titel: 'Besitzer-PIN der Box gesetzt',
    bestanden: geraet.besitzerPinHash !== null,
    hinweis:
      geraet.besitzerPinHash === null
        ? 'Unter „Gerät“ eine Besitzer-PIN festlegen – sie gilt für die ganze Box. Ohne sie kommt am Kiosk niemand in die Verwaltung.'
        : 'Gesetzt unter „Gerät“ – sie gilt für alle Veranstaltungen.',
  });

  punkte.push({
    schluessel: 'betreuerPin',
    titel: 'Betreuer-PIN dieser Veranstaltung gesetzt',
    bestanden: event.betreuerPinHash !== null,
    hinweis:
      event.betreuerPinHash === null
        ? 'Unter „Aussehen & PIN“ setzen – ohne sie kommt der Gastgeber nicht ins Servicemenü (Papier wechseln, nachdrucken).'
        : 'Gesetzt – der Gastgeber bekommt sie mit der Kurzanleitung.',
  });

  // Erinnerungen: Ob etwas ausgedruckt in der Box liegt, sieht die Software
  // nicht. Vorher stand hier ein gruener Haken - als waere es geprueft.
  punkte.push({
    schluessel: 'unterlagen',
    titel: event.einstellungen.galerieAktiv
      ? 'Erinnerung: Kurzanleitung und Aushang ausdrucken'
      : 'Erinnerung: Kurzanleitung ausdrucken',
    bestanden: false,
    nurWarnung: true,
    hinweis: event.einstellungen.galerieAktiv
      ? 'Die Kurzanleitung (Reiter „Übergabe“) in die Box legen, den Aushang für die Gäste („WLAN & Portal“) außen ankleben.'
      : 'Die Kurzanleitung (Reiter „Übergabe“) in die Box legen.',
  });

  punkte.push({
    schluessel: 'windows',
    titel: 'Erinnerung: Windows-Einstellungen',
    bestanden: false,
    nurWarnung: true,
    hinweis:
      'Energiesparen und Update-Neustarts hat das Setup erledigt. Von Hand einmal prüfen: ' +
      'Anzeigeskalierung 100 %, Benachrichtigungen aus („Bitte nicht stören“), kein Bildschirmschoner.',
  });

  const bestanden = punkte.every((p) => p.bestanden || p.nurWarnung === true);
  return { bestanden, punkte };
}
