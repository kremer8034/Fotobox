import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { lesbarerFehler, OHNE_FORTSCHRITT } from '../treiber/powershell.js';
import { PORTAL_ADRESSE, PORTAL_PRAEFIX, VONETS_ADRESSE, hostAnteil } from './adresse.js';
import type { PortalZustand } from './steuerung.js';

const fuehreAus = promisify(execFile);

/**
 * Selbstdiagnose des Captive Portals - damit niemand in Windows-Einstellungen
 * oder `ipconfig` nachsehen muss. Sie sagt Zeile fuer Zeile, was passt und was
 * als Naechstes zu tun ist.
 */

export interface Netzadapter {
  index: number;
  name: string;
  beschreibung: string;
  verbunden: boolean;
  dhcp: boolean;
  adressen: string[];
  /** Von wem der Adapter seine Adresse hat, wenn er sie automatisch bezieht. */
  dhcpServer: string | null;
}

export interface Rohdiagnose {
  windows: boolean;
  /** Kabel-Netzwerkanschluesse (kein WLAN). */
  adapter: Netzadapter[];
  /** Firewall-Freigaben fuer das Portal vorhanden? */
  firewall: boolean;
  /** Wer haelt Anschluss 80 fuer alle Adressen besetzt? null = niemand (oder die Fotobox selbst). */
  port80: string | null;
}

export interface Pruefzeile {
  titel: string;
  /** true = gut, false = zu tun, null = nur zur Info. */
  ok: boolean | null;
  hinweis: string;
}

export interface PortalDiagnose {
  windows: boolean;
  adapter: Netzadapter | null;
  eingerichtet: boolean;
  /** Darf der Schalter eingeschaltet werden? */
  bereit: boolean;
  zeilen: Pruefzeile[];
}

const LESEN = `${OHNE_FORTSCHRITT}
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$liste = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
  Where-Object { $_.PhysicalMediaType -eq '802.3' -or $_.MediaType -eq '802.3' } | ForEach-Object {
    $ip = Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
    $adr = @(Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
    $cfg = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "InterfaceIndex=$($_.ifIndex)" -ErrorAction SilentlyContinue
    [pscustomobject]@{ index = $_.ifIndex; name = $_.Name; beschreibung = $_.InterfaceDescription;
      verbunden = ($_.Status -eq 'Up'); dhcp = ("$($ip.Dhcp)" -eq 'Enabled'); adressen = $adr; dhcpServer = "$($cfg.DHCPServer)" }
  })
$fw = @(Get-NetFirewallRule -Group 'Fotobox Portal' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }).Count
# Anschluss 80: Haelt ihn der Windows-Webdienst (HTTP.sys, Prozess 4), den
# dahinter laufenden Dienst nennen - sonst sieht man nur "System".
$p80 = $null
$l80 = @(Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -in '0.0.0.0', '${PORTAL_ADRESSE}' }) | Select-Object -First 1
if ($l80) {
  if ($l80.OwningProcess -eq 4) {
    $d = @(Get-Service W3SVC, WAS, PeerDistSvc, MsDepSvc, ReportServer -ErrorAction SilentlyContinue |
      Where-Object { $_.Status -eq 'Running' } | ForEach-Object { $_.DisplayName })
    $p80 = if ($d.Count) { $d -join ', ' } else { 'Windows-Webdienst (HTTP.sys)' }
  } else {
    $p80 = "$((Get-Process -Id $l80.OwningProcess -ErrorAction SilentlyContinue).ProcessName)"
    if (-not $p80) { $p80 = "Prozess $($l80.OwningProcess)" }
  }
}
[pscustomobject]@{ adapter = $liste; firewall = ($fw -ge 3); port80 = $p80; port80Prozess = $(if ($l80) { $l80.OwningProcess } else { $null }) } | ConvertTo-Json -Compress -Depth 4
`;

/** Liest den Zustand der Netzwerkanschluesse aus Windows. */
export async function leseRohdiagnose(): Promise<Rohdiagnose> {
  if (process.platform !== 'win32') return { windows: false, adapter: [], firewall: false, port80: null };
  try {
    const { stdout } = await fuehreAus(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', kodiere(LESEN)],
      { timeout: 30_000, windowsHide: true, encoding: 'utf8' },
    );
    return deuteRohdiagnose(stdout);
  } catch (fehler) {
    const f = fehler as { stderr?: string; message?: string };
    throw new Error(lesbarerFehler(f.stderr ?? '') || f.message || String(fehler));
  }
}

/** Die JSON-Ausgabe von PowerShell deuten - auch, wenn sie Einzelwerte statt Listen liefert. */
export function deuteRohdiagnose(json: string, eigenerProzess = process.pid): Rohdiagnose {
  const roh = JSON.parse(json.trim()) as { adapter?: unknown; firewall?: unknown; port80?: unknown; port80Prozess?: unknown };
  const liste = Array.isArray(roh.adapter) ? roh.adapter : roh.adapter ? [roh.adapter] : [];
  const adapter = liste.map((a) => {
    const e = a as Record<string, unknown>;
    const adressen = Array.isArray(e.adressen) ? e.adressen : e.adressen ? [e.adressen] : [];
    const server = String(e.dhcpServer ?? '').trim();
    return {
      index: Number(e.index),
      name: String(e.name ?? ''),
      beschreibung: String(e.beschreibung ?? ''),
      verbunden: e.verbunden === true,
      dhcp: e.dhcp === true,
      adressen: adressen.map(String).filter((x) => !x.startsWith('169.254.')),
      dhcpServer: server && server !== '255.255.255.255' ? server : null,
    };
  });
  // Haelt die Fotobox selbst Anschluss 80, laeuft dort gerade ihr eigenes Portal - kein Fremder.
  const eigenes = Number(roh.port80Prozess) === eigenerProzess;
  const port80 = !eigenes && typeof roh.port80 === 'string' && roh.port80.trim() ? roh.port80.trim() : null;
  return { windows: true, adapter, firewall: roh.firewall === true, port80 };
}

/** Der Anschluss mit dem Vonets: der mit der Portal-Adresse, sonst der verbundene. */
export function waehleAdapter(adapter: Netzadapter[]): Netzadapter | null {
  return (
    adapter.find((a) => a.adressen.includes(PORTAL_ADRESSE)) ??
    adapter.find((a) => a.verbunden && a.adressen.some((x) => hostAnteil(x) !== null)) ??
    adapter.find((a) => a.verbunden) ??
    adapter[0] ??
    null
  );
}

/** Ist der Vonets ueber das Kabel erreichbar? null, wenn die Box nicht in seinem Netz ist. */
export async function vonetsErreichbar(adapter: Netzadapter | null): Promise<boolean | null> {
  if (!adapter?.adressen.some((a) => hostAnteil(a) !== null)) return null;
  try {
    await fetch(`http://${VONETS_ADRESSE}/`, { signal: AbortSignal.timeout(2500), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

/** Laesst sich ein Anschluss belegen? true, oder die Fehlermeldung. */
export async function anschlussFrei(adresse: string, port: number, art: 'udp' | 'tcp'): Promise<true | string> {
  return new Promise((fertig) => {
    if (art === 'udp') {
      const s = createSocket('udp4');
      s.once('error', (f) => {
        s.close();
        fertig(f.message);
      });
      s.bind(port, adresse, () => s.close(() => fertig(true)));
    } else {
      const s = createServer();
      s.once('error', (f) => fertig(f.message));
      s.listen(port, adresse, () => s.close(() => fertig(true)));
    }
  });
}

export interface Zusatzbefunde {
  vonets: boolean | null;
  /** Ergebnis der Anschlusspruefung je Port (nur, wenn der Dienst nicht schon laeuft). */
  anschluesse: { port: number; ergebnis: true | string }[];
  zustand: PortalZustand | null;
  schalter: boolean;
}

/** Aus den Befunden die Zeilen fuer die Verwaltung machen. Rein - ohne Windows testbar. */
export function bewerte(roh: Rohdiagnose, zusatz: Zusatzbefunde): PortalDiagnose {
  if (!roh.windows) {
    return {
      windows: false,
      adapter: null,
      eingerichtet: false,
      bereit: false,
      zeilen: [{ titel: 'Nur auf der Fotobox', ok: null, hinweis: 'Die Selbstdiagnose prüft die Windows-Netzwerkeinstellungen der Box.' }],
    };
  }
  const adapter = waehleAdapter(roh.adapter);
  const eingerichtet = Boolean(adapter?.adressen.includes(PORTAL_ADRESSE)) && adapter?.dhcp === false;
  const zeilen: Pruefzeile[] = [];

  zeilen.push(
    !adapter
      ? { titel: 'Netzwerkkabel zum Vonets', ok: false, hinweis: 'Kein Kabel-Netzwerkanschluss gefunden. Das Kabel des Vonets am PC einstecken.' }
      : !adapter.verbunden
        ? { titel: 'Netzwerkkabel zum Vonets', ok: false, hinweis: `Der Anschluss „${adapter.name}“ ist getrennt. Steckt das Kabel des Vonets, und hat er Strom?` }
        : { titel: 'Netzwerkkabel zum Vonets', ok: true, hinweis: `Anschluss „${adapter.name}“ ist verbunden.` },
  );

  if (adapter) {
    zeilen.push(
      eingerichtet
        ? { titel: 'Feste Adresse für das Portal', ok: true, hinweis: `Die Box hat am Kabel die feste Adresse ${PORTAL_ADRESSE}.` }
        : {
            titel: 'Feste Adresse für das Portal',
            ok: false,
            hinweis:
              `Noch nicht eingerichtet${adapter.adressen.length ? ` (bisher ${adapter.adressen.join(', ')}` : ' (bisher keine Adresse'}` +
              `${adapter.dhcp && adapter.dhcpServer ? `, automatisch von ${adapter.dhcpServer})` : ')'}. ` +
              'Unten „Netzwerk für das Portal einrichten“ tippen.',
          },
    );
  }

  zeilen.push(
    zusatz.vonets === null
      ? { titel: 'Vonets erreichbar', ok: null, hinweis: 'Lässt sich erst prüfen, wenn die Box im Netz des Vonets ist.' }
      : zusatz.vonets
        ? { titel: 'Vonets erreichbar', ok: true, hinweis: `Seine Einstellungen öffnen sich unter http://${VONETS_ADRESSE}.` }
        : { titel: 'Vonets erreichbar', ok: false, hinweis: `Unter ${VONETS_ADRESSE} antwortet nichts. Hat der Vonets Strom und steckt das Kabel?` },
  );

  // Ein zweiter Adressverteiler: vorher am Adapter sichtbar (er bekommt seine
  // Adresse von dort), nachher meldet ihn der laufende Adressdienst.
  const fremd = zusatz.zustand?.fremderDhcp ?? (!eingerichtet && adapter?.dhcp ? adapter.dhcpServer : null);
  zeilen.push(
    fremd
      ? {
          titel: 'Kein zweiter Adressverteiler',
          ok: false,
          hinweis:
            `Unter ${fremd} verteilt noch ein anderes Gerät Adressen – vermutlich der Vonets. ` +
            `In seinen Einstellungen (http://${VONETS_ADRESSE}) unter „DHCP Server“ „Disable“ wählen.`,
        }
      : { titel: 'Kein zweiter Adressverteiler', ok: true, hinweis: 'Außer der Box verteilt niemand Adressen.' },
  );

  zeilen.push(
    roh.firewall
      ? { titel: 'Firewall-Freigaben', ok: true, hinweis: 'Die Anschlüsse 53, 67 und 80 sind freigegeben.' }
      : { titel: 'Firewall-Freigaben', ok: false, hinweis: 'Fehlen noch – kommen mit „Netzwerk für das Portal einrichten“.' },
  );

  // Anschluss 80 haelt oft ein Windows-Webdienst (IIS, BranchCache) - das
  // zeigt sich schon vor dem Einrichten, und dann mit Namen.
  const port80 = zusatz.zustand?.portal ? null : roh.port80;
  const belegt = zusatz.anschluesse.filter((a) => a.ergebnis !== true && !(port80 && a.port === 80));
  if (eingerichtet || port80) {
    const teile: string[] = [];
    if (port80) {
      teile.push(
        `Anschluss 80 hält „${port80}“. In Windows unter „Dienste“ diesen Dienst beenden und den Starttyp auf „Deaktiviert“ stellen.`,
      );
    }
    if (belegt.length) {
      teile.push(
        `Belegt: ${belegt.map((b) => b.port).join(', ')}. Läuft am PC der Windows-Hotspot („Mobiler Hotspot“) oder ein anderer Server? ` +
          'Dann ausschalten.',
      );
    }
    zeilen.push(
      teile.length
        ? { titel: 'Anschlüsse frei', ok: false, hinweis: teile.join(' ') }
        : { titel: 'Anschlüsse frei', ok: true, hinweis: 'Adress-, Namens- und Portaldienst können starten.' },
    );
  }

  const z = zusatz.zustand;
  if (z && eingerichtet) {
    const laeuft = [z.dhcp && 'Adressdienst', z.dns && 'Namensdienst', z.portal && 'Portal'].filter(Boolean).join(', ');
    zeilen.push({
      titel: 'Dienste',
      ok: z.fehler.length ? false : null,
      hinweis:
        (laeuft ? `Läuft: ${laeuft}. ` : '') +
        (z.geraete ? `${z.geraete} Handy(s) haben gerade eine Adresse. ` : '') +
        (zusatz.schalter && !z.portal ? 'Das Portal öffnet sich, sobald eine Veranstaltung mit Galerie läuft. ' : '') +
        z.fehler.join(' '),
    });
  }

  const bereit = eingerichtet && roh.firewall && !fremd && belegt.length === 0 && !port80;
  return { windows: true, adapter, eingerichtet, bereit, zeilen };
}

/** Komplette Diagnose: Windows lesen, Vonets und Anschluesse pruefen, bewerten. */
/**
 * Komplette Diagnose: Windows lesen, Vonets und Anschluesse pruefen, bewerten.
 *
 * Der Zustand der eigenen Dienste wird erst nach dem Lesen von Windows (das
 * dauert Sekunden) abgefragt und am Ende noch einmal: Startete die Box in der
 * Zwischenzeit selbst Namensdienst oder Portal, belegen die ihre Anschluesse
 * zu Recht. Vorher hielt die Diagnose das fuer einen fremden Dienst.
 */
export async function portalDiagnose(zustandJetzt: () => PortalZustand | null, schalter: boolean): Promise<PortalDiagnose> {
  const roh = await leseRohdiagnose();
  const adapter = roh.windows ? waehleAdapter(roh.adapter) : null;
  const anschluesse: Zusatzbefunde['anschluesse'] = [];
  if (adapter?.adressen.includes(PORTAL_ADRESSE)) {
    // Nur pruefen, was nicht schon laeuft - ein laufender Dienst belegt seinen
    // Anschluss ja gerade selbst.
    const vorher = zustandJetzt();
    if (!vorher?.dhcp) anschluesse.push({ port: 67, ergebnis: await anschlussFrei(PORTAL_ADRESSE, 67, 'udp') });
    if (!vorher?.dns) anschluesse.push({ port: 53, ergebnis: await anschlussFrei(PORTAL_ADRESSE, 53, 'udp') });
    if (!vorher?.portal) anschluesse.push({ port: 80, ergebnis: await anschlussFrei(PORTAL_ADRESSE, 80, 'tcp') });
  }
  const vonets = await vonetsErreichbar(adapter);
  const zustand = zustandJetzt();
  return bewerte(roh, { vonets, anschluesse: ohneEigene(anschluesse, zustand), zustand, schalter });
}

/** Anschluesse, die inzwischen ein eigener Dienst belegt, sind nicht "belegt". */
export function ohneEigene(anschluesse: Zusatzbefunde['anschluesse'], zustand: PortalZustand | null): Zusatzbefunde['anschluesse'] {
  const eigen: Record<number, boolean | undefined> = { 67: zustand?.dhcp, 53: zustand?.dns, 80: zustand?.portal };
  return anschluesse.filter((a) => !eigen[a.port]);
}

// ------------------------------------------------------------ Einrichten

export function einrichtenSkript(index: number): string {
  return `$ErrorActionPreference = 'Stop'
${OHNE_FORTSCHRITT}
$i = ${index}
Set-NetIPInterface -InterfaceIndex $i -AddressFamily IPv4 -Dhcp Disabled
Get-NetIPAddress -InterfaceIndex $i -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
Get-NetRoute -InterfaceIndex $i -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
New-NetIPAddress -InterfaceIndex $i -IPAddress '${PORTAL_ADRESSE}' -PrefixLength ${PORTAL_PRAEFIX} | Out-Null
Get-NetFirewallRule -Group 'Fotobox Portal' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Fotobox Portal DNS' -Group 'Fotobox Portal' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 53 -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Fotobox Portal DHCP' -Group 'Fotobox Portal' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 67 -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Fotobox Portal Web' -Group 'Fotobox Portal' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -Profile Any | Out-Null
`;
}

export function zuruecksetzenSkript(index: number): string {
  return `$ErrorActionPreference = 'Stop'
${OHNE_FORTSCHRITT}
$i = ${index}
Get-NetIPAddress -InterfaceIndex $i -AddressFamily IPv4 -IPAddress '${PORTAL_ADRESSE}' -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false
Set-NetIPInterface -InterfaceIndex $i -AddressFamily IPv4 -Dhcp Enabled
Set-DnsClientServerAddress -InterfaceIndex $i -ResetServerAddresses
Get-NetFirewallRule -Group 'Fotobox Portal' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
`;
}

/*
 * Das erhoehte Fenster ist unsichtbar. Seine Fehlermeldung kommt ueber eine
 * Datei im oeffentlichen Ordner zurueck - der gehoert jedem Konto, auch dem
 * Administrator, mit dem Windows das Skript ausfuehrt.
 */
const FEHLERDATEI = '$env:PUBLIC\\fotobox-portal-fehler.txt';

/** Die Netzwerkeinstellung braucht Administratorrechte - Windows fragt dafuer nach. */
async function alsAdministrator(skript: string): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Das geht nur auf der Fotobox (Windows).');
  const innen = `try {
${skript}
} catch {
  Set-Content -Path "${FEHLERDATEI}" -Value $_.Exception.Message -Encoding UTF8
  exit 1
}
`;
  const aussen = `${OHNE_FORTSCHRITT}
$ErrorActionPreference = 'Stop'
Remove-Item -Path "${FEHLERDATEI}" -ErrorAction SilentlyContinue
try {
  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${kodiere(innen)}')
} catch {
  [Console]::Error.WriteLine('ABGELEHNT')
  exit 2
}
if ($p.ExitCode -ne 0) {
  $grund = Get-Content -Path "${FEHLERDATEI}" -Raw -ErrorAction SilentlyContinue
  [Console]::Error.WriteLine("GRUND: $grund")
  exit 1
}
`;
  try {
    await fuehreAus('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', kodiere(aussen)], {
      timeout: 180_000,
      windowsHide: true,
      encoding: 'utf8',
    });
  } catch (fehler) {
    const f = fehler as { stderr?: string; code?: number; message?: string };
    const stderr = f.stderr ?? '';
    if (stderr.includes('ABGELEHNT')) {
      throw new Error('Windows hat nach Administratorrechten gefragt, und das wurde abgelehnt. Nichts wurde geändert.');
    }
    const grund = /GRUND:\s*(.+)/.exec(stderr)?.[1]?.trim();
    throw new Error(`Die Netzwerkeinstellung hat nicht geklappt${grund ? `: ${grund}` : ` (Code ${f.code ?? '?'})`}.`);
  }
}

export async function richteNetzEin(adapter: Netzadapter): Promise<void> {
  await alsAdministrator(einrichtenSkript(adapter.index));
}

export async function setzeNetzZurueck(adapter: Netzadapter): Promise<void> {
  await alsAdministrator(zuruecksetzenSkript(adapter.index));
}

function kodiere(skript: string): string {
  return Buffer.from(skript, 'utf16le').toString('base64');
}
