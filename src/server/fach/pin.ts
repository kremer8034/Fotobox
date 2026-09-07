import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  passwort: string,
  salz: Buffer,
  laenge: number,
) => Promise<Buffer>;

/**
 * PINs werden niemals im Klartext gespeichert.
 *
 * Es gibt bewusst keine ausgelieferte Standard-PIN: Ohne gesetzte Besitzer-PIN
 * laesst sich kein Event starten.
 */

export async function hashePin(pin: string): Promise<string> {
  const salz = randomBytes(16);
  const abgeleitet = await scrypt(pin, salz, 64);
  return `scrypt$${salz.toString('hex')}$${abgeleitet.toString('hex')}`;
}

export async function pruefePin(pin: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  const [verfahren, salzHex, erwartetHex] = hash.split('$');
  if (verfahren !== 'scrypt' || !salzHex || !erwartetHex) return false;
  const erwartet = Buffer.from(erwartetHex, 'hex');
  const abgeleitet = await scrypt(pin, Buffer.from(salzHex, 'hex'), erwartet.length);
  return erwartet.length === abgeleitet.length && timingSafeEqual(erwartet, abgeleitet);
}

/** Zufallstoken fuer Galerie und Statusseite: 128 Bit, URL-tauglich. */
export function neuesToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Drosselung der PIN-Eingabe: nach drei Fehlversuchen 30 Sekunden Sperre,
 * danach ansteigend.
 */
export class PinDrossel {
  private fehlversuche = 0;
  private gesperrtBis = 0;

  gesperrtFuerMs(): number {
    return Math.max(0, this.gesperrtBis - Date.now());
  }

  merkeFehlversuch(): void {
    this.fehlversuche += 1;
    if (this.fehlversuche >= 3) {
      const stufe = this.fehlversuche - 2;
      this.gesperrtBis = Date.now() + Math.min(30_000 * 2 ** (stufe - 1), 15 * 60_000);
    }
  }

  merkeErfolg(): void {
    this.fehlversuche = 0;
    this.gesperrtBis = 0;
  }
}
