/**
 * Was ein Tipper auf der Bildschirmtastatur aus der Adresse macht.
 *
 * Die Anbietertasten haengten vorher blind an: "anna@" und dann "@gmail.com"
 * ergab "anna@@gmail.com", ein ".de" danach "anna@@gmail.com.de". Wer sich
 * beim Anbieter vertippt hatte, musste alles bis zum @ zuruecklöschen. Jetzt
 * ersetzt eine Anbietertaste den Teil ab dem @, und Tipper, die die Adresse
 * nur kaputt machen koennen, werden ignoriert.
 */
export function tippeInAdresse(adresse: string, taste: string): string {
  const at = adresse.indexOf('@');
  const domain = at >= 0 ? adresse.slice(at + 1) : null;

  let neu: string;
  if (taste.startsWith('@') && taste.length > 1) {
    // "@gmail.com": ersetzt den Anbieter; ohne Namen davor ergibt es keinen Sinn.
    const lokal = at >= 0 ? adresse.slice(0, at) : adresse;
    // Ein Punkt direkt vor dem @ macht die Adresse ungueltig.
    if (!lokal || lokal.endsWith('.')) return adresse;
    neu = lokal + taste;
  } else if (taste === '@') {
    if (!adresse || at >= 0 || adresse.endsWith('.')) return adresse;
    neu = adresse + '@';
  } else if (taste.startsWith('.') && taste.length > 1) {
    // ".de", ".com": nur als Ende eines Anbieters, der noch keine Endung hat.
    if (!domain || domain.includes('.') || domain.endsWith('-')) return adresse;
    neu = adresse + taste;
  } else if (taste === '.') {
    // Kein Punkt am Anfang, direkt nach dem @ oder zweimal hintereinander.
    if (!adresse || adresse.endsWith('.') || adresse.endsWith('@')) return adresse;
    neu = adresse + '.';
  } else {
    neu = adresse + taste;
  }
  return neu.slice(0, 254);
}
