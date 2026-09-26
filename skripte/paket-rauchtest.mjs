/**
 * Rauchtest des fertigen Pakets: Startet den Server genau so, wie er auf der
 * Box laeuft - mit dem mitgelieferten Node aus paket/Fotobox/node und nur den
 * Laufzeit-Bibliotheken -, und prueft, dass er antwortet, die Oberflaeche
 * ausliefert und die richtige Version meldet.
 *
 * Faengt genau die Fehler, die sonst erst auf der Box auffallen: eine
 * Bibliothek, die nur als Entwicklungswerkzeug installiert war, eine fehlende
 * schema.sql, eine Datenbank-Bibliothek fuer die falsche Node-Version.
 *
 * Mit --probe (unter Linux/macOS) nimmt es das Node, mit dem es aufgerufen wurde.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PAKET = resolve(import.meta.dirname, '..', 'paket', 'Fotobox');
const PROBE = process.argv.includes('--probe');
const PORT = 8799;
const node = PROBE ? process.execPath : join(PAKET, 'node', 'node.exe');
const version = JSON.parse(readFileSync(join(PAKET, 'package.json'), 'utf8')).version;
const daten = mkdtempSync(join(tmpdir(), 'fotobox-rauchtest-'));

/*
 * Eine eigene Schrift, die es nur im Schriftenordner der Fotobox gibt - so wie
 * eine aus Canva mitgebrachte. Eine Kopie einer Systemschrift mit einem
 * Familiennamen gleicher Laenge, den es sonst nirgends gibt.
 */
const WINDOWS = process.platform === 'win32';
const schriftVorlage = WINDOWS
  ? { datei: 'C:\\Windows\\Fonts\\cour.ttf', alt: 'Courier New', neu: 'Fotobox Xyz' }
  : { datei: '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf', alt: 'Liberation Mono', neu: 'Fotobox Testxyz' };
let eigeneSchrift = null;
if (existsSync(schriftVorlage.datei)) {
  const utf16 = (t) => t.split('').map((z) => '\u0000' + z).join('');
  const inhalt = readFileSync(schriftVorlage.datei)
    .toString('latin1')
    .split(schriftVorlage.alt)
    .join(schriftVorlage.neu)
    .split(utf16(schriftVorlage.alt))
    .join(utf16(schriftVorlage.neu));
  mkdirSync(join(daten, 'schriften'), { recursive: true });
  writeFileSync(join(daten, 'schriften', 'eigene.ttf'), Buffer.from(inhalt, 'latin1'));
  eigeneSchrift = schriftVorlage.neu;
}

const server = spawn(node, [join('dist', 'server', 'index.js')], {
  cwd: PAKET,
  env: {
    ...process.env,
    FOTOBOX_DATEN: daten,
    FOTOBOX_HARDWARE: 'mock',
    FOTOBOX_PORT: String(PORT),
    FOTOBOX_WEB: join('dist', 'web'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let ausgabe = '';
server.stdout.on('data', (d) => (ausgabe += d));
server.stderr.on('data', (d) => (ausgabe += d));

async function hole(pfad) {
  const antwort = await fetch(`http://127.0.0.1:${PORT}${pfad}`, { signal: AbortSignal.timeout(3000) });
  return { status: antwort.status, text: await antwort.text() };
}

function pruefe(bedingung, text) {
  if (!bedingung) throw new Error(text);
  console.log(`  OK  ${text}`);
}

let fehler = null;
try {
  let bereit = false;
  for (let i = 0; i < 60 && !bereit; i += 1) {
    if (server.exitCode !== null) throw new Error(`Der Server ist beim Start beendet worden (Code ${server.exitCode}).`);
    try {
      bereit = (await hole('/api/kiosk/start')).status === 200;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  pruefe(bereit, 'Server antwortet');
  const status = JSON.parse((await hole('/api/admin/status')).text);
  pruefe(status.version === version, `meldet Version ${version}`);
  const seite = await hole('/admin');
  pruefe(seite.status === 200 && seite.text.includes('<div id="wurzel">'), 'liefert die Oberflaeche aus');
  const vorlagen = JSON.parse((await hole('/api/admin/vorlagen')).text);
  pruefe(Array.isArray(vorlagen) && vorlagen.length > 0, 'Datenbank angelegt, Standardvorlagen vorhanden');
  const vorschau = await fetch(`http://127.0.0.1:${PORT}/api/admin/vorlagen/${vorlagen[0].id}/vorschau.jpg`);
  pruefe(vorschau.status === 200 && vorschau.headers.get('content-type')?.includes('image/jpeg'), 'Bildbearbeitung (sharp) arbeitet');

  if (eigeneSchrift) {
    // Dieselbe Textebene einmal mit der eigenen Schrift, einmal mit einem
    // Namen, den es nicht gibt (Ersatzschrift). Gefunden heisst: anders.
    const dunkel = async (schrift) => {
      const antwort = await fetch(`http://127.0.0.1:${PORT}/api/admin/vorlagen`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `Schrift ${schrift}`,
          preset: '10x15-quer',
          hintergrundFarbe: '#ffffff',
          ebenen: [
            { id: 't', typ: 'text', x: 0.05, y: 0.3, w: 0.9, h: 0.4, text: 'Anna & Ben', groesse: 0.18, farbe: '#000000', schrift },
          ],
        }),
      });
      const vorlage = await antwort.json();
      if (!antwort.ok) throw new Error(`Vorlage abgelehnt: ${JSON.stringify(vorlage)}`);
      const bild = Buffer.from(
        await (await fetch(`http://127.0.0.1:${PORT}/api/admin/vorlagen/${vorlage.id}/vorschau.jpg`)).arrayBuffer(),
      );
      const { default: sharp } = await import('sharp');
      const roh = await sharp(bild).greyscale().raw().toBuffer();
      let n = 0;
      for (const w of roh) if (w < 128) n += 1;
      return n;
    };
    const mitEigener = await dunkel(eigeneSchrift);
    const mitErsatz = await dunkel('Gibtesnichtxyz123');
    pruefe(mitEigener !== mitErsatz, `eigene Schrift aus dem Schriftenordner wird gerendert (${mitEigener} / ${mitErsatz})`);
  } else {
    console.log('  --  eigene Schrift nicht pruefbar (Vorlage-Schrift fehlt)');
  }
} catch (f) {
  fehler = f;
} finally {
  // Unter Windows startet sich der Server einmal selbst neu (Schriften, siehe
  // schriften-start.ts) - also den ganzen Prozessbaum beenden, nicht nur den
  // aeusseren Prozess.
  if (WINDOWS) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
  await new Promise((r) => setTimeout(r, 1000));
  try {
    rmSync(daten, { recursive: true, force: true });
  } catch {
    // Unter Windows kann die Datenbank noch kurz gesperrt sein - nur ein Testordner.
  }
}

if (fehler) {
  console.error(`\nRAUCHTEST FEHLGESCHLAGEN: ${fehler.message}\n--- Ausgabe des Servers ---\n${ausgabe}`);
  process.exit(1);
}
console.log('\nRauchtest bestanden.');
