import { networkInterfaces } from 'node:os';

/**
 * Ermittelt die LAN-Adresse der Box. Sie steckt im QR-Code der Galerie, deshalb
 * bekommt der Fotobox-PC im Reise-Router am besten eine feste Adresse - dann
 * bleibt der Link ueber alle Veranstaltungen stabil.
 */
export function lanAdresse(): string | null {
  const schnittstellen = networkInterfaces();
  const kandidaten: string[] = [];
  for (const eintraege of Object.values(schnittstellen)) {
    for (const eintrag of eintraege ?? []) {
      if (eintrag.family !== 'IPv4' || eintrag.internal) continue;
      kandidaten.push(eintrag.address);
    }
  }
  // Private Netze bevorzugen: Der Reise-Router spannt ein Insel-Netz auf.
  const privat = kandidaten.find(
    (a) => a.startsWith('192.168.') || a.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(a),
  );
  return privat ?? kandidaten[0] ?? null;
}

/** WLAN-QR-Code nach dem Format, das Android und iOS direkt lesen. */
export function wlanQrText(ssid: string, passwort: string): string {
  const maskieren = (t: string) => t.replace(/([\;,:"])/g, '\\$1');
  return `WIFI:S:${maskieren(ssid)};T:WPA;P:${maskieren(passwort)};;`;
}
