import { describe, expect, it } from 'vitest';
import { tippeInAdresse } from '../adresse-tippen.js';
import { pruefeAdresse } from '../../../shared/adresse.js';

const tippe = (...tasten: string[]) => tasten.reduce(tippeInAdresse, '');

describe('Bildschirmtastatur für E-Mail-Adressen', () => {
  it('ersetzt den Anbieter statt ein zweites @ anzuhängen', () => {
    expect(tippe('a', 'n', 'n', 'a', '@', '@gmail.com')).toBe('anna@gmail.com');
    expect(tippe('a', 'n', 'n', 'a', '@gmail.com', '@web.de')).toBe('anna@web.de');
  });

  it('hängt eine Endung nur an einen Anbieter ohne Endung', () => {
    expect(tippe('a', 'n', 'n', 'a', '@gmail.com', '.de')).toBe('anna@gmail.com');
    expect(tippe('a', 'n', 'n', 'a', '@', 'f', 'i', 'r', 'm', 'a', '.de')).toBe('anna@firma.de');
    expect(tippe('a', 'n', 'n', 'a', '.de')).toBe('anna');
  });

  it('lässt kein @ und keinen Anbieter ohne Namen davor zu', () => {
    expect(tippe('@')).toBe('');
    expect(tippe('@gmail.com')).toBe('');
    expect(tippe('a', '@', '@')).toBe('a@');
  });

  it('verhindert Punkte an Stellen, an denen die Adresse ungültig würde', () => {
    expect(tippe('.')).toBe('');
    expect(tippe('a', '.', '.')).toBe('a.');
    expect(tippe('a', '@', '.')).toBe('a@');
    expect(tippe('b', 'e', 'n', '.', '@web.de')).toBe('ben.');
    expect(tippe('b', 'e', 'n', '.', '@')).toBe('ben.');
  });
});

describe('Adressprüfung', () => {
  it('lehnt einen Punkt am Anfang oder Ende des Namens ab', () => {
    expect(pruefeAdresse('anna.@web.de')).toBe(false);
    expect(pruefeAdresse('.anna@web.de')).toBe(false);
    expect(pruefeAdresse('anna.b@web.de')).toBe(true);
  });
});
