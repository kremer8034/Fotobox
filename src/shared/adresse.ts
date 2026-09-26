/**
 * Was als E-Mail-Adresse durchgeht - an einer Stelle fuer Kiosk und Server,
 * damit "Senden" nie freigegeben wird, wenn der Server die Adresse danach
 * ablehnt.
 *
 * Im lokalen Teil vor dem @ nur Buchstaben, Ziffern und ". _ % + -", danach
 * ein ordentlicher Domainname. Vorher war jedes Zeichen ausser @ und Leerraum
 * erlaubt - "gast@web.de,postmaster" ging durch, und der Mailserver haette
 * daraus zwei Empfaenger gemacht. Ein Punkt am Anfang oder Ende des lokalen
 * Teils ("anna.@web.de") nahm der Server an, die Mail kam aber als
 * unzustellbar zurueck, waehrend der Gast "Ist unterwegs!" gelesen hatte.
 */
const EMAIL_MUSTER =
  /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,63}$/;

export function pruefeAdresse(adresse: string): boolean {
  if (adresse.length > 254 || !EMAIL_MUSTER.test(adresse) || adresse.includes('..')) return false;
  const lokal = adresse.slice(0, adresse.indexOf('@'));
  return !lokal.startsWith('.') && !lokal.endsWith('.');
}
