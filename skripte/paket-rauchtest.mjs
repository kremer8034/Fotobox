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
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PAKET = resolve(import.meta.dirname, '..', 'paket', 'Fotobox');
const PROBE = process.argv.includes('--probe');
const PORT = 8799;
const node = PROBE ? process.execPath : join(PAKET, 'node', 'node.exe');
const version = JSON.parse(readFileSync(join(PAKET, 'package.json'), 'utf8')).version;
const daten = mkdtempSync(join(tmpdir(), 'fotobox-rauchtest-'));

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
} catch (f) {
  fehler = f;
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(daten, { recursive: true, force: true });
}

if (fehler) {
  console.error(`\nRAUCHTEST FEHLGESCHLAGEN: ${fehler.message}\n--- Ausgabe des Servers ---\n${ausgabe}`);
  process.exit(1);
}
console.log('\nRauchtest bestanden.');
