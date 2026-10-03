import { createSocket } from 'node:dgram';
import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { lesbarerFehler, OHNE_FORTSCHRITT } from './treiber/powershell.js';

const fuehreAus = promisify(execFile);

/** Die Adresse, ueber die die Box zuletzt ins Netz ging - siehe aktualisiereRoutenAdresse. */
let routenAdresse: string | null = null;

/**
 * Welche eigene Adresse benutzt die Box fuer den Weg ins Netz? Ein UDP-Socket,
 * der sich mit einer Adresse draussen "verbindet", verraet das - verschickt
 * wird dabei nichts. Das ist der WLAN-Adapter, mit dem die Box wirklich
 * verbunden ist, nicht irgendeiner aus der Liste: Hat der PC noch einen
 * virtuellen Adapter (Hyper-V, VPN, Docker) oder einen USB-Netzwerkadapter,
 * landete sonst gern dessen Adresse im QR-Code - und das Handy lud ins Leere.
 */
export async function aktualisiereRoutenAdresse(): Promise<string | null> {
  routenAdresse = await new Promise<string | null>((fertig) => {
    const sock = createSocket('udp4');
    const ende = (adresse: string | null) => {
      try {
        sock.close();
      } catch {
        // schon zu
      }
      fertig(adresse);
    };
    sock.once('error', () => ende(null));
    try {
      sock.connect(53, '1.1.1.1', () => {
        try {
          ende(sock.address().address);
        } catch {
          ende(null);
        }
      });
    } catch {
      ende(null);
    }
  });
  return routenAdresse;
}

/**
 * Ermittelt die LAN-Adresse der Box. Sie steckt im QR-Code der Galerie, deshalb
 * bekommt der Fotobox-PC im Reise-Router am besten eine feste Adresse - dann
 * bleibt der Link ueber alle Veranstaltungen stabil.
 */
export function lanAdresse(): string | null {
  const kandidaten = alleLanAdressen();
  if (routenAdresse && kandidaten.includes(routenAdresse)) return routenAdresse;
  // Private Netze bevorzugen: Der Reise-Router spannt ein Insel-Netz auf.
  const privat = kandidaten.find(
    (a) => a.startsWith('192.168.') || a.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(a),
  );
  return privat ?? kandidaten[0] ?? null;
}

/**
 * Alle IPv4-Adressen der Box ausser 127.0.0.1. Mehr als eine heisst: Die Box
 * haengt in mehreren Netzen - etwa im Reise-Router und per Kabel im Netz der
 * Location. Dann ist nicht sicher, in welchem die Galerie landet.
 */
export function alleLanAdressen(): string[] {
  const kandidaten: string[] = [];
  for (const eintraege of Object.values(networkInterfaces())) {
    for (const eintrag of eintraege ?? []) {
      if (eintrag.family !== 'IPv4' || eintrag.internal) continue;
      // 169.254.x.x: Windows vergibt sie sich selbst, wenn kein Router antwortet - darueber erreicht niemand die Box.
      if (eintrag.address.startsWith('169.254.')) continue;
      kandidaten.push(eintrag.address);
    }
  }
  return kandidaten;
}

/** WLAN-QR-Code nach dem Format, das Android und iOS direkt lesen. */
export function wlanQrText(ssid: string, passwort: string): string {
  const maskieren = (t: string) => t.replace(/([\;,:"])/g, '\\$1');
  return `WIFI:S:${maskieren(ssid)};T:WPA;P:${maskieren(passwort)};;`;
}

/**
 * Die Adresse der Handy-Galerie, wie sie in einen QR-Code gehoert.
 *
 * Steht hier, damit der ausgedruckte Aushang und der Code am Startbildschirm
 * dieselbe Adresse zeigen. Der Startbildschirm hatte sie vorher im Browser
 * aus window.location zusammengebaut - und der Kiosk laeuft auf localhost.
 * Heraus kam http://127.0.0.1:8787/g/..., was auf einem Handy das Handy selbst
 * ist: Der Code hat nie funktioniert.
 *
 * Ohne LAN-Adresse gibt es null statt einer Adresse, die ins Leere fuehrt.
 */
export function galerieUrl(token: string, port: number): string | null {
  const adresse = lanAdresse();
  return adresse ? `http://${adresse}:${port}/g/${token}` : null;
}

export interface NetzDiagnose {
  /** Name des Netzes laut Windows - beim WLAN der WLAN-Name. */
  netz: string | null;
  /** "Public", "Private" oder "DomainAuthenticated". */
  kategorie: string | null;
  adapter: string | null;
  /** Gibt es die Firewall-Freigabe der Fotobox, und fuer welche Profile? */
  regel: boolean;
  regelProfile: string | null;
}

/**
 * Wie Windows das Netz der Galerie-Adresse sieht: WLAN-Name, Netzwerkprofil
 * und ob die Firewall-Freigabe dazu passt. Bis 1.0.4 galt die Freigabe nur
 * fuer "private" Netze - Windows 11 stuft ein neues WLAN aber als
 * "oeffentlich" ein. Dann lud die Galerie auf dem Handy endlos.
 */
export async function netzDiagnose(adresse: string): Promise<NetzDiagnose | null> {
  if (process.platform !== 'win32') return null;
  const skript =
    OHNE_FORTSCHRITT +
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8;' +
    ' $a = Get-NetIPAddress -IPAddress $env:FOTOBOX_IP -ErrorAction SilentlyContinue | Select-Object -First 1;' +
    ' $p = if ($a) { Get-NetConnectionProfile -InterfaceIndex $a.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1 };' +
    " $r = Get-NetFirewallRule -DisplayName 'Fotobox Galerie' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' } | Select-Object -First 1;" +
    ' [pscustomobject]@{ netz = $p.Name; kategorie = "$($p.NetworkCategory)"; adapter = $a.InterfaceAlias;' +
    ' regel = [bool]$r; regelProfile = "$($r.Profile)" } | ConvertTo-Json -Compress';
  try {
    const { stdout } = await fuehreAus('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', skript], {
      timeout: 15_000,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, FOTOBOX_IP: adresse },
    });
    const roh = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const text = (w: unknown) => (typeof w === 'string' && w.trim() !== '' ? w.trim() : null);
    return {
      netz: text(roh.netz),
      kategorie: text(roh.kategorie),
      adapter: text(roh.adapter),
      regel: roh.regel === true,
      regelProfile: text(roh.regelProfile),
    };
  } catch (fehler) {
    const f = fehler as { stderr?: string; message?: string };
    console.error(`Netzdiagnose: ${lesbarerFehler(f.stderr ?? '') || f.message}`);
    return null;
  }
}

/**
 * Was die Diagnose fuer die Galerie bedeutet - null, wenn alles passt.
 * Die Freigabe gilt seit 1.0.5 fuer alle Profile; aeltere Installationen
 * haben nur "Private".
 */
export function galerieBlockiert(d: NetzDiagnose): string | null {
  if (!d.regel) {
    return 'Die Windows-Firewall-Freigabe der Fotobox fehlt. Das Setup der Fotobox noch einmal ausführen - es legt sie an.';
  }
  const profile = (d.regelProfile ?? '').toLowerCase();
  const kategorie = (d.kategorie ?? '').toLowerCase();
  const erlaubt = profile.includes('any') || (kategorie === 'public' ? profile.includes('public') : profile.includes('private'));
  if (!erlaubt && kategorie === 'public') {
    return (
      `Windows stuft das Netz${d.netz ? ` „${d.netz}“` : ''} als öffentlich ein, und die Firewall-Freigabe gilt nur für private Netze - ` +
      'die Handys kommen nicht durch. Abhilfe: in Windows unter Einstellungen → Netzwerk und Internet → WLAN → dieses Netz → ' +
      '„Privates Netzwerk“ wählen.'
    );
  }
  return null;
}
