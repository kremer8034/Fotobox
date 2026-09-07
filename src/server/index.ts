import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { leseKonfig } from './konfig.js';
import { oeffneDb, schliesseDb } from './db/index.js';
import { leseGeraet, schreibeGeraet } from './db/geraet.js';
import { wurzelpfade } from './fach/pfade.js';
import { legeStandardvorlagenAn } from './fach/vorlagen.js';
import { legeEingebauteFilterAn } from './fach/filter.js';
import { holeAktivesEvent } from './fach/events.js';
import { Betrieb, protokolliere } from './betrieb.js';
import { registriereKiosk } from './routen/kiosk.js';
import { registriereAdmin } from './routen/admin.js';
import { registriereOeffentlich } from './routen/oeffentlich.js';
import { registriereMedien } from './routen/medien.js';
import { registriereStream } from './routen/stream.js';
import { lanAdresse } from './netzwerk.js';

/**
 * Einstiegspunkt.
 *
 * Sicherheitsgrundsatz: Der Server bindet standardmaessig NUR auf 127.0.0.1.
 * Die LAN-Adresse kommt ausschliesslich dann dazu, wenn in einem Event die
 * Galerie aktiv ist - und dann laeuft dort eine zweite Instanz, die nur die
 * oeffentlichen Routen kennt. Kiosk und Admin sind ueber das Netz damit nicht
 * bloss versteckt, sondern gar nicht erst erreichbar.
 */

const konfig = leseKonfig();
const wurzel = wurzelpfade(konfig.datenpfad);

for (const ordner of [wurzel.wurzel, wurzel.vorlagen, wurzel.luts, wurzel.events]) {
  mkdirSync(ordner, { recursive: true });
}

oeffneDb(wurzel.db);
if (leseGeraet().datenpfad !== konfig.datenpfad) {
  schreibeGeraet({ datenpfad: konfig.datenpfad });
}
legeEingebauteFilterAn();
legeStandardvorlagenAn();

const betrieb = new Betrieb({
  echteHardware: konfig.echteHardware,
  mockDruckOrdner: resolve(konfig.datenpfad, 'mock-drucke'),
});
betrieb.starte();

// --------------------------------------------------------------------------
// Lokale Instanz: alles, aber nur auf 127.0.0.1
// --------------------------------------------------------------------------
const lokal = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
await lokal.register(fastifyMultipart, { limits: { fileSize: 30 * 1024 * 1024 } });

registriereKiosk(lokal, betrieb, konfig);
registriereAdmin(lokal, betrieb, konfig);
registriereMedien(lokal);
registriereStream(lokal, betrieb);
registriereOeffentlich(lokal, betrieb);
await registriereWeb(lokal);

await lokal.listen({ host: '127.0.0.1', port: konfig.portLokal });
protokolliere('info', 'server', `Kiosk und Admin laufen auf http://127.0.0.1:${konfig.portLokal}`);

// --------------------------------------------------------------------------
// Oeffentliche Instanz: nur Galerie und Status, nur wenn eine Veranstaltung
// die Galerie eingeschaltet hat
// --------------------------------------------------------------------------
let oeffentlich: FastifyInstance | null = null;

async function galerieAn(): Promise<void> {
  if (oeffentlich) return;
  const adresse = lanAdresse();
  if (!adresse) {
    protokolliere('warnung', 'server', 'Galerie gewuenscht, aber keine Netzwerkadresse gefunden.');
    return;
  }
  const app = Fastify({ logger: false });
  registriereOeffentlich(app, betrieb);
  await registriereWeb(app);
  await app.listen({ host: adresse, port: konfig.portOeffentlich });
  oeffentlich = app;
  protokolliere('info', 'server', `Galerie erreichbar unter http://${adresse}:${konfig.portOeffentlich}`);
}

async function galerieAus(): Promise<void> {
  if (!oeffentlich) return;
  await oeffentlich.close();
  oeffentlich = null;
  protokolliere('info', 'server', 'Galerie im Netz abgeschaltet.');
}

/**
 * Die Erreichbarkeit haengt am Schalter der laufenden Veranstaltung, nicht an
 * einer Firewall-Regel: Der Port ist zu, weil dort niemand zuhoert.
 */
async function pruefeGalerie(): Promise<void> {
  const event = holeAktivesEvent();
  const soll = Boolean(event && event.einstellungen.galerieAktiv);
  if (soll) await galerieAn();
  else await galerieAus();
}

await pruefeGalerie();
const galerieUhr = setInterval(() => void pruefeGalerie().catch(() => undefined), 5000);

/** Rettungsleine: Sitzungen, die haengen bleiben, werden verworfen. */
const abbruchUhr = setInterval(() => {
  const sitzung = betrieb.aktiveSitzung;
  if (!sitzung) return;
  const event = holeAktivesEvent();
  const grenzeMs = (event?.einstellungen.zeiten.sitzungAbbruch ?? 180) * 1000;
  if (Date.now() - betrieb.letzteBeruehrung > grenzeMs) {
    protokolliere('info', 'kiosk', 'Sitzung nach Untaetigkeit verworfen.');
    betrieb.aktiveSitzung = null;
  }
}, 5000);

async function registriereWeb(app: FastifyInstance): Promise<void> {
  const ordner = resolve(konfig.webOrdner);
  if (!existsSync(ordner)) return;
  await app.register(fastifyStatic, { root: ordner, prefix: '/' });
  // Die Oberflaeche ist eine Einzelseiten-Anwendung: Unbekannte Pfade liefern
  // index.html, damit /admin und /g/<token> direkt aufrufbar bleiben.
  app.setNotFoundHandler((anfrage, antwort) => {
    if (anfrage.url.startsWith('/api') || anfrage.url.startsWith('/medien')) {
      return antwort.code(404).send({ fehler: 'Nicht gefunden.' });
    }
    return antwort.sendFile('index.html');
  });
}

async function beende(): Promise<void> {
  clearInterval(galerieUhr);
  clearInterval(abbruchUhr);
  await betrieb.beende();
  await oeffentlich?.close();
  await lokal.close();
  schliesseDb();
  process.exit(0);
}

process.on('SIGINT', () => void beende());
process.on('SIGTERM', () => void beende());
