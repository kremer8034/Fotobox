import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { holeDb, jetzt } from '../db/index.js';
import { baueLayout, layoutMasse } from '../bild/layout.js';
import { wendeFilterAn } from '../bild/filter.js';
import { schreibeDruckPdf } from '../bild/pdf.js';
import { eventpfade } from './pfade.js';
import { holeFilter } from './filter.js';
import { holeVorlage } from './vorlagen.js';
import { fotoEbenen, type Ausgabe, type Veranstaltung, type Vorlage } from '../../shared/typen.js';

/**
 * Eine Sitzung ist der Durchlauf eines Gastes: Vorlage waehlen, Fotos machen,
 * Filter waehlen, Layout bekommen.
 *
 * Jeder Schritt wird sofort in die Datenbank geschrieben. Stuerzt der Server ab
 * oder faellt der Strom aus, ist hoechstens die laufende Sitzung verloren -
 * niemals das Event oder die Zaehler.
 */

/** Arbeitsgroesse: lange Kante 2000 px reicht fuer 300 dpi auf 10x15 und fuer
 *  den Handy-Download. Der Filter laeuft NACH dem Verkleinern. */
const ARBEITSGROESSE = 2000;

export interface SitzungZustand {
  id: string;
  eventId: string;
  vorlage: Vorlage;
  istTest: boolean;
  benoetigteFotos: number;
  gemachteFotos: number;
}

export function starteSitzung(event: Veranstaltung, vorlageId: string): SitzungZustand {
  const vorlage = holeVorlage(vorlageId);
  if (!vorlage) throw new Error('Vorlage nicht gefunden.');
  if (!event.einstellungen.vorlagen.includes(vorlageId)) {
    throw new Error('Diese Vorlage ist fuer die Veranstaltung nicht freigegeben.');
  }

  const id = randomUUID();
  holeDb()
    .prepare(
      `INSERT INTO sitzungen (id, event_id, vorlage_id, filter_id, gestartet, beendet, ist_test)
       VALUES (?, ?, ?, NULL, ?, NULL, ?)`,
    )
    .run(id, event.id, vorlageId, jetzt(), event.probelauf ? 1 : 0);

  return {
    id,
    eventId: event.id,
    vorlage,
    istTest: event.probelauf,
    benoetigteFotos: fotoEbenen(vorlage).length,
    gemachteFotos: 0,
  };
}

export function brichSitzungAb(sitzungId: string): void {
  // Die bereits gemachten Fotos bleiben im Ordner; nur die Sitzung wird
  // beendet, damit die Box wieder frei ist.
  holeDb().prepare('UPDATE sitzungen SET beendet = ? WHERE id = ?').run(jetzt(), sitzungId);
}

/**
 * Verbucht eine frisch aufgenommene Datei. Die Kamera legt sie bereits im
 * richtigen Ordner ab, deshalb wird hier nur noch registriert - und, falls die
 * Datei woanders landete, hereinkopiert.
 */
export async function verbucheFoto(
  sitzung: SitzungZustand,
  event: Veranstaltung,
  quellPfad: string,
  ebeneIndex: number,
): Promise<string> {
  const pfade = eventpfade(event.ordner, sitzung.istTest);
  await mkdir(pfade.originale, { recursive: true });

  const zielName = `${sitzung.id}_${ebeneIndex}${extension(quellPfad)}`;
  const ziel = join(pfade.originale, zielName);
  if (quellPfad !== ziel) await verschiebe(quellPfad, ziel);

  holeDb()
    .prepare(
      'INSERT INTO fotos (id, sitzung_id, ebene_index, pfad_original, pfad_bearbeitet) VALUES (?, ?, ?, ?, NULL)',
    )
    .run(randomUUID(), sitzung.id, ebeneIndex, ziel);

  return ziel;
}

/**
 * Setzt die Sitzung fertig: Fotos filtern, in die Vorlage einpassen, Layout
 * bauen und als Druck-PDF verpacken.
 *
 * Der Filter wird ausschliesslich auf die Fotos angewendet, nie auf Bild- und
 * Textebenen der Vorlage.
 */
export async function stelleFertig(
  sitzung: SitzungZustand,
  event: Veranstaltung,
  filterId: string | null,
  kontext: { lutOrdner: string; vorlagenOrdner: string; kalibrierung: Parameters<typeof schreibeDruckPdf>[2]['kalibrierung'] },
): Promise<Ausgabe> {
  const pfade = eventpfade(event.ordner, sitzung.istTest);
  await mkdir(pfade.bearbeitet, { recursive: true });
  await mkdir(pfade.layouts, { recursive: true });
  await mkdir(pfade.druck, { recursive: true });

  const preset = filterId ? holeFilter(filterId) : null;
  const zeilen = holeDb()
    .prepare('SELECT id, ebene_index, pfad_original FROM fotos WHERE sitzung_id = ? ORDER BY ebene_index')
    .all(sitzung.id) as { id: string; ebene_index: number; pfad_original: string }[];

  const fotos = new Map<number, Buffer>();
  for (const zeile of zeilen) {
    const original = await readFile(zeile.pfad_original);
    // Erst verkleinern, dann filtern: Damit rechnet auch eine 3D-LUT ueber
    // wenige hunderttausend Pixel statt ueber achtzehn Millionen.
    const verkleinert = await sharp(original)
      .rotate()
      .resize(ARBEITSGROESSE, ARBEITSGROESSE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
    const gefiltert = await wendeFilterAn(verkleinert, preset, { lutOrdner: kontext.lutOrdner });

    const bearbeitetPfad = join(pfade.bearbeitet, `${sitzung.id}_${zeile.ebene_index}.jpg`);
    await writeFile(bearbeitetPfad, gefiltert);
    holeDb()
      .prepare('UPDATE fotos SET pfad_bearbeitet = ? WHERE id = ?')
      .run(bearbeitetPfad, zeile.id);

    fotos.set(zeile.ebene_index, gefiltert);
  }

  const layout = await baueLayout(
    sitzung.vorlage,
    {
      fotos,
      assetsOrdner: kontext.vorlagenOrdner,
      platzhalter: platzhalterFuer(event),
    },
    layoutMasse(sitzung.vorlage),
  );

  const layoutPfad = join(pfade.layouts, `${sitzung.id}.jpg`);
  await writeFile(layoutPfad, layout);

  const pdfPfad = join(pfade.druck, `${sitzung.id}.pdf`);
  await schreibeDruckPdf(layout, pdfPfad, {
    canvas: sitzung.vorlage.canvas,
    kalibrierung: kontext.kalibrierung,
  });

  const ausgabeId = randomUUID();
  holeDb()
    .prepare(
      'INSERT INTO ausgaben (id, sitzung_id, pfad_layout, pfad_druck_pdf, erstellt) VALUES (?, ?, ?, ?, ?)',
    )
    .run(ausgabeId, sitzung.id, layoutPfad, pdfPfad, jetzt());

  holeDb()
    .prepare('UPDATE sitzungen SET filter_id = ?, beendet = ? WHERE id = ?')
    .run(filterId, jetzt(), sitzung.id);

  return {
    id: ausgabeId,
    sitzungId: sitzung.id,
    pfadLayout: layoutPfad,
    pfadDruckPdf: pdfPfad,
    erstellt: jetzt(),
  };
}

/** Werte fuer die Platzhalter in Textebenen. */
export function platzhalterFuer(event: Veranstaltung): Record<string, string> {
  const jetztZeit = new Date();
  const zaehler = holeDb()
    .prepare('SELECT COUNT(*) AS n FROM sitzungen WHERE event_id = ? AND ist_test = 0')
    .get(event.id) as { n: number };
  return {
    veranstaltung: event.name,
    datum: new Date(event.datum).toLocaleDateString('de-DE'),
    uhrzeit: jetztZeit.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    nummer: String(zaehler.n),
  };
}

/** Fertige Layouts einer Veranstaltung - das ist der Galerie-Inhalt. */
export function galerieEintraege(eventId: string): {
  ausgabeId: string;
  sitzungId: string;
  pfadLayout: string;
  erstellt: string;
}[] {
  const zeilen = holeDb()
    .prepare(
      `SELECT a.id AS ausgabe_id, a.sitzung_id, a.pfad_layout, a.erstellt
         FROM ausgaben a JOIN sitzungen s ON s.id = a.sitzung_id
        WHERE s.event_id = ? AND s.ist_test = 0
        ORDER BY a.erstellt DESC`,
    )
    .all(eventId) as {
    ausgabe_id: string;
    sitzung_id: string;
    pfad_layout: string;
    erstellt: string;
  }[];
  return zeilen.map((z) => ({
    ausgabeId: z.ausgabe_id,
    sitzungId: z.sitzung_id,
    pfadLayout: z.pfad_layout,
    erstellt: z.erstellt,
  }));
}

export function holeAusgabe(id: string): (Ausgabe & { eventId: string }) | null {
  const zeile = holeDb()
    .prepare(
      `SELECT a.*, s.event_id FROM ausgaben a JOIN sitzungen s ON s.id = a.sitzung_id WHERE a.id = ?`,
    )
    .get(id) as
    | {
        id: string;
        sitzung_id: string;
        pfad_layout: string;
        pfad_druck_pdf: string | null;
        erstellt: string;
        event_id: string;
      }
    | undefined;
  if (!zeile) return null;
  return {
    id: zeile.id,
    sitzungId: zeile.sitzung_id,
    pfadLayout: zeile.pfad_layout,
    pfadDruckPdf: zeile.pfad_druck_pdf,
    erstellt: zeile.erstellt,
    eventId: zeile.event_id,
  };
}

/**
 * Die Kamera legt die Datei bereits im richtigen Ordner ab; wir geben ihr nur
 * einen sprechenden Namen. Verschieben statt kopieren, damit das Original genau
 * einmal existiert - sonst laege jedes Foto doppelt im Uebergabeordner.
 */
async function verschiebe(quelle: string, ziel: string): Promise<void> {
  try {
    await rename(quelle, ziel);
  } catch {
    // Ueber Laufwerksgrenzen hinweg geht nur kopieren und danach aufraeumen.
    await copyFile(quelle, ziel);
    await unlink(quelle).catch(() => undefined);
  }
}

function extension(pfad: string): string {
  const name = basename(pfad);
  const punkt = name.lastIndexOf('.');
  return punkt >= 0 ? name.slice(punkt) : '.jpg';
}
