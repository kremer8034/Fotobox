import { networkInterfaces } from 'node:os';

/**
 * Das Netz des Captive Portals.
 *
 * Der Vonets (WLAN-Bruecke am Ethernet-Anschluss der Box) hat seine
 * Konfigurationsseite unter 192.168.254.254 - die Box nimmt dasselbe Netz, so
 * bleibt der Vonets auch nach der Umstellung erreichbar. Die Box selbst
 * bekommt die .1, die Handys Adressen ab .100.
 */
export const PORTAL_ADRESSE = '192.168.254.1';
export const PORTAL_PRAEFIX = 24;
export const PORTAL_MASKE = '255.255.255.0';
export const POOL_ERSTE = 100;
export const POOL_LETZTE = 199;
export const VONETS_ADRESSE = '192.168.254.254';

/**
 * Ist das Netz fuer das Portal eingerichtet? Massgeblich ist, was Windows
 * tatsaechlich eingestellt hat - nicht ein gespeicherter Merker: Steht die
 * feste Adresse am Adapter, laeuft der Adressdienst, sonst nicht.
 */
export function portalNetzEingerichtet(adressen: string[] = eigeneAdressen()): boolean {
  return adressen.includes(PORTAL_ADRESSE);
}

function eigeneAdressen(): string[] {
  const liste: string[] = [];
  for (const eintraege of Object.values(networkInterfaces())) {
    for (const e of eintraege ?? []) if (e.family === 'IPv4' && !e.internal) liste.push(e.address);
  }
  return liste;
}

/** "192.168.254.17" -> 17, wenn die Adresse im Portalnetz liegt, sonst null. */
export function hostAnteil(adresse: string): number | null {
  const teile = adresse.split('.').map(Number);
  if (teile.length !== 4 || teile.some((t) => !Number.isInteger(t))) return null;
  const netz = PORTAL_ADRESSE.split('.').slice(0, 3).join('.');
  return teile.slice(0, 3).join('.') === netz ? teile[3]! : null;
}

export function poolAdresse(host: number): string {
  return `${PORTAL_ADRESSE.split('.').slice(0, 3).join('.')}.${host}`;
}
