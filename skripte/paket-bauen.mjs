/**
 * Baut das Installationspaket fuer Windows: einen Ordner, der alles enthaelt,
 * was die Fotobox auf dem Box-PC braucht - ohne dass dort noch etwas aus dem
 * Internet geholt oder gebaut werden muss.
 *
 *   paket/Fotobox/
 *     node/node.exe          eigenes Node in genau der Version, mit der gebaut
 *                            wurde (die Datenbank-Bibliothek ist an sie gebunden)
 *     dist/                  fertig gebauter Server und Oberflaeche
 *     node_modules/          nur die Laufzeit-Bibliotheken, fuer Windows
 *     package.json           traegt die Versionsnummer
 *     windows/               Start- und Einrichtungsskripte, SumatraPDF
 *     docs/                  Anleitungen
 *
 * Laeuft auf dem Windows-Rechner der GitHub-Action (siehe
 * .github/workflows/windows-setup.yml). Vorher: npm ci && npm run build.
 * Danach macht Inno Setup aus dem Ordner die Setup-Datei.
 *
 * Mit --probe laeuft es auch unter Linux/macOS, ohne Windows-Teile - nur um
 * den Aufbau zu pruefen.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const WURZEL = resolve(import.meta.dirname, '..');
const ZIEL = join(WURZEL, 'paket', 'Fotobox');
const PROBE = process.argv.includes('--probe');
const WINDOWS = process.platform === 'win32';

/** SumatraPDF druckt ohne Dialog; die portable Fassung genuegt. */
const SUMATRA_VERSION = '3.5.2';
const SUMATRA_URL = `https://www.sumatrapdfreader.org/dl/rel/${SUMATRA_VERSION}/SumatraPDF-${SUMATRA_VERSION}-64.zip`;

/** Nur diese Startskripte gehoeren ins Paket - Installieren.* baut aus dem Quelltext und ist fuer Entwickler. */
const SKRIPTE = [
  'Fotobox starten.bat',
  'Kiosk starten.bat',
  'Verwaltung oeffnen.bat',
  'Einrichtung.ps1',
  'Fotobox-beenden.ps1',
  'Nach-Installation.ps1',
];

function schritt(text) {
  console.log(`\n=== ${text}`);
}

function fuehreAus(befehl, argumente, optionen = {}) {
  const ergebnis = spawnSync(befehl, argumente, { stdio: 'inherit', shell: WINDOWS, ...optionen });
  if (ergebnis.status !== 0) throw new Error(`${befehl} ${argumente.join(' ')} ist fehlgeschlagen (${ergebnis.status}).`);
}

async function lade(url) {
  const antwort = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!antwort.ok) throw new Error(`${url}: HTTP ${antwort.status}`);
  return Buffer.from(await antwort.arrayBuffer());
}

/** Entpackt ein ZIP. Unter Windows ueber PowerShell - das tar im PATH ist dort oft das von Git und kann kein ZIP. */
function entpacke(zip, ordner) {
  if (WINDOWS) {
    fuehreAus('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${ordner}' -Force`,
    ], { shell: false });
  } else {
    fuehreAus('unzip', ['-q', '-o', zip, '-d', ordner]);
  }
}

async function main() {
  if (!WINDOWS && !PROBE) {
    throw new Error('Das Paket muss unter Windows gebaut werden (Laufzeit-Bibliotheken). Zum Ausprobieren: --probe');
  }
  if (!existsSync(join(WURZEL, 'dist', 'server', 'index.js')) || !existsSync(join(WURZEL, 'dist', 'web', 'index.html'))) {
    throw new Error('dist/ fehlt - vorher "npm run build".');
  }
  const paket = JSON.parse(await readFile(join(WURZEL, 'package.json'), 'utf8'));
  console.log(`Fotobox ${paket.version}, Node ${process.version}${PROBE ? ' (Probelauf)' : ''}`);

  schritt('Zielordner leeren');
  await rm(join(WURZEL, 'paket'), { recursive: true, force: true });
  await mkdir(ZIEL, { recursive: true });

  schritt('Programm');
  await cp(join(WURZEL, 'dist'), join(ZIEL, 'dist'), { recursive: true });
  for (const datei of ['package.json', 'package-lock.json', 'LICENSE']) {
    await cp(join(WURZEL, datei), join(ZIEL, datei));
  }

  schritt('Laufzeit-Bibliotheken (ohne Entwicklungswerkzeuge)');
  fuehreAus('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: ZIEL });

  schritt('Startskripte');
  await mkdir(join(ZIEL, 'windows'), { recursive: true });
  for (const datei of SKRIPTE) {
    await cp(join(WURZEL, 'windows', datei), join(ZIEL, 'windows', datei));
  }

  schritt('Anleitungen');
  await mkdir(join(ZIEL, 'docs'), { recursive: true });
  for (const datei of await readdir(join(WURZEL, 'docs'))) {
    if (datei.endsWith('.md')) await cp(join(WURZEL, 'docs', datei), join(ZIEL, 'docs', datei));
  }
  await cp(join(WURZEL, 'README.md'), join(ZIEL, 'docs', 'README.md'));

  if (PROBE) {
    console.log('\nProbelauf: Node und SumatraPDF fuer Windows werden nicht geladen.');
    return;
  }

  schritt(`Node ${process.version} fuer Windows`);
  // Genau die Version, die gerade npm ci ausgefuehrt hat: Die Datenbank-
  // Bibliothek better-sqlite3 ist fest an deren Programmierschnittstelle gebunden.
  const version = process.version;
  const zipName = `node-${version}-win-x64.zip`;
  const zipDaten = await lade(`https://nodejs.org/dist/${version}/${zipName}`);
  const summen = (await lade(`https://nodejs.org/dist/${version}/SHASUMS256.txt`)).toString('utf8');
  const erwartet = summen.split('\n').find((z) => z.endsWith(`  ${zipName}`))?.split(/\s+/)[0];
  const tatsaechlich = createHash('sha256').update(zipDaten).digest('hex');
  if (!erwartet || erwartet !== tatsaechlich) throw new Error(`Pruefsumme von ${zipName} stimmt nicht.`);
  const arbeit = join(tmpdir(), `fotobox-paket-${Date.now()}`);
  await mkdir(arbeit, { recursive: true });
  await writeFile(join(arbeit, zipName), zipDaten);
  entpacke(join(arbeit, zipName), arbeit);
  const nodeOrdner = join(arbeit, `node-${version}-win-x64`);
  await mkdir(join(ZIEL, 'node'), { recursive: true });
  await cp(join(nodeOrdner, 'node.exe'), join(ZIEL, 'node', 'node.exe'));
  await cp(join(nodeOrdner, 'LICENSE'), join(ZIEL, 'node', 'LICENSE'));

  schritt(`SumatraPDF ${SUMATRA_VERSION}`);
  try {
    const sumatraZip = join(arbeit, 'sumatra.zip');
    await writeFile(sumatraZip, await lade(SUMATRA_URL));
    const sumatraOrdner = join(arbeit, 'sumatra');
    entpacke(sumatraZip, sumatraOrdner);
    const exe = (await readdir(sumatraOrdner)).find((d) => /^SumatraPDF.*\.exe$/i.test(d));
    if (!exe) throw new Error('Keine SumatraPDF-Datei im Archiv.');
    await cp(join(sumatraOrdner, exe), join(ZIEL, 'windows', 'SumatraPDF.exe'));
    await writeFile(
      join(ZIEL, 'windows', 'SumatraPDF-Lizenz.txt'),
      `SumatraPDF ${SUMATRA_VERSION} - (c) Krzysztof Kowalczyk und Mitwirkende.\r\n` +
        'Freie Software unter der GNU General Public License v3.\r\n' +
        'Quelltext und Lizenz: https://github.com/sumatrapdfreader/sumatrapdf\r\n',
    );
    console.log('  mitgeliefert: windows\\SumatraPDF.exe');
  } catch (fehler) {
    // Kein Grund, das ganze Paket scheitern zu lassen: Die Fotobox findet
    // eine selbst installierte Fassung ebenso, und die Verwaltung sagt, wenn
    // sie fehlt.
    console.warn(`  WARNUNG: SumatraPDF nicht mitgeliefert (${fehler.message}).`);
  }
  await rm(arbeit, { recursive: true, force: true });

  console.log(`\nFertig: ${ZIEL}`);
}

main().catch((fehler) => {
  console.error(`\nFEHLER: ${fehler.message}`);
  process.exit(1);
});
