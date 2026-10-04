import { DhcpDienst } from './dhcp.js';
import { DnsDienst } from './dns.js';
import { PortalDienst } from './http.js';

/**
 * Wann laeuft welcher Teil des Captive Portals?
 *
 * - Netz nicht eingerichtet und Schalter aus (der Normalfall): nichts. Die
 *   Box laeuft genau wie vor dem Portal.
 * - Netz eingerichtet (feste Adresse am Ethernet-Anschluss): der Adressdienst
 *   laeuft immer - sonst bekaemen die Handys keine Adresse mehr, sobald am
 *   Vonets der DHCP aus ist, und auch die normale Galerie waere weg.
 * - Zusaetzlich Schalter an und eine Veranstaltung mit Galerie aktiv: DNS und
 *   Portal auf Port 80 - die Galerie oeffnet sich beim WLAN-Beitritt.
 */
export interface PortalSoll {
  dhcp: boolean;
  dns: boolean;
  portal: boolean;
}

export function portalSoll(lage: { schalter: boolean; eingerichtet: boolean; galerieAktiv: boolean }): PortalSoll {
  const offen = lage.eingerichtet && lage.schalter && lage.galerieAktiv;
  return { dhcp: lage.eingerichtet, dns: offen, portal: offen };
}

export interface PortalZustand {
  dhcp: boolean;
  dns: boolean;
  portal: boolean;
  geraete: number;
  fremderDhcp: string | null;
  /** Der letzte Startfehler je Dienst, in Worten - etwa ein belegter Port. */
  fehler: string[];
}

export class Portalsteuerung {
  readonly dhcp: DhcpDienst;
  readonly dns: DnsDienst;
  readonly portal: PortalDienst;
  private fehler = new Map<string, string>();

  constructor(
    galerieZiel: () => string | null,
    private readonly melde: (text: string) => void,
    dienste?: { dhcp?: DhcpDienst; dns?: DnsDienst; portal?: PortalDienst },
  ) {
    this.dhcp = dienste?.dhcp ?? new DhcpDienst(undefined, undefined, melde);
    this.dns = dienste?.dns ?? new DnsDienst(undefined, undefined, melde);
    this.portal = dienste?.portal ?? new PortalDienst(galerieZiel);
  }

  /** Bringt die Dienste auf den Sollzustand. Fehler eines Dienstes halten die anderen nicht auf. */
  async abgleichen(soll: PortalSoll): Promise<void> {
    await this.schalte('dhcp', soll.dhcp, this.dhcp, 'Adressdienst (UDP 67)');
    await this.schalte('dns', soll.dns, this.dns, 'Namensdienst (UDP 53)');
    await this.schalte('portal', soll.portal, this.portal, 'Portal (TCP 80)');
  }

  private async schalte(
    name: string,
    an: boolean,
    dienst: { laeuft: boolean; starte(): Promise<void>; stoppe(): Promise<void> },
    titel: string,
  ): Promise<void> {
    try {
      if (an && !dienst.laeuft) {
        await dienst.starte();
        this.melde(`${titel} gestartet.`);
      } else if (!an && dienst.laeuft) {
        await dienst.stoppe();
        this.melde(`${titel} beendet.`);
      }
      this.fehler.delete(name);
    } catch (f) {
      const text = f instanceof Error ? f.message : String(f);
      // Nur einmal melden, nicht alle fuenf Sekunden.
      if (this.fehler.get(name) !== text) this.melde(`${titel} startet nicht: ${text}`);
      this.fehler.set(name, `${titel}: ${erklaere(text)}`);
    }
  }

  zustand(): PortalZustand {
    return {
      dhcp: this.dhcp.laeuft,
      dns: this.dns.laeuft,
      portal: this.portal.laeuft,
      geraete: this.dhcp.geraete(),
      fremderDhcp: this.dhcp.fremderServer,
      fehler: [...this.fehler.values()],
    };
  }

  async stoppeAlles(): Promise<void> {
    await this.abgleichen({ dhcp: false, dns: false, portal: false });
  }
}

/** Die eine Steuerung des laufenden Servers - fuer Verwaltung und Startbereit-Check. */
let instanz: Portalsteuerung | null = null;
/** Bringt die Dienste sofort auf den Sollzustand (statt erst beim naechsten 5-Sekunden-Takt). */
let abgleich: () => Promise<void> = async () => undefined;

export function setzePortal(p: Portalsteuerung, sofort?: () => Promise<void>): void {
  instanz = p;
  if (sofort) abgleich = sofort;
}

/**
 * Nach dem Umlegen des Schalters oder dem Einrichten des Netzes: Dienste
 * gleich starten oder stoppen. So zeigt die Selbstdiagnose danach schon den
 * neuen Stand - vorher pruefte sie mitten in den Start hinein.
 */
export async function gleichePortalAb(): Promise<void> {
  try {
    await abgleich();
  } catch {
    // Startfehler stehen im Zustand der Steuerung und damit in der Diagnose.
  }
}

export function holePortal(): Portalsteuerung | null {
  return instanz;
}

/** Fehlermeldungen des Betriebssystems in Worte fassen. */
function erklaere(text: string): string {
  if (/EADDRINUSE/.test(text)) return 'der Anschluss ist schon belegt (läuft der Windows-Hotspot oder ein anderer Dienst?)';
  if (/EACCES/.test(text)) return 'Windows verweigert den Anschluss (meist hält ihn ein Windows-Webdienst – die Selbstdiagnose nennt ihn)';
  if (/EADDRNOTAVAIL/.test(text)) return 'die Portal-Adresse ist am Netzwerkanschluss nicht eingerichtet';
  return text;
}
