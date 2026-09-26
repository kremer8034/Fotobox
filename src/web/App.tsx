import { useEffect, useState } from 'react';
import { Kiosk } from './kiosk/Kiosk.js';
import { Admin } from './admin/Admin.js';
import { HandyGalerie } from './galerie/HandyGalerie.js';
import { Absturzschutz } from './Absturzschutz.js';

/**
 * Drei Oberflaechen aus einer Codebasis:
 *   /            Kiosk am Touchscreen
 *   /admin       Verwaltung, nur ueber 127.0.0.1 erreichbar
 *   /g/<token>   Handy-Galerie im WLAN
 *   /s/<token>   schreibgeschuetzte Statusseite
 */
export function App() {
  const [pfad, setzePfad] = useState(window.location.pathname);

  useEffect(() => {
    const beiWechsel = () => setzePfad(window.location.pathname);
    window.addEventListener('popstate', beiWechsel);
    return () => window.removeEventListener('popstate', beiWechsel);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('admin', pfad.startsWith('/admin'));
    document.documentElement.classList.toggle(
      'handy-ansicht',
      pfad.startsWith('/g/') || pfad.startsWith('/s/'),
    );
  }, [pfad]);

  const bereich = pfad.startsWith('/admin')
    ? 'admin'
    : pfad.startsWith('/g/') || pfad.startsWith('/s/')
      ? 'handy'
      : 'kiosk';
  return (
    // Der Schluessel setzt den Schutz beim Wechsel zwischen Kiosk und
    // Verwaltung zurueck - nicht bei jedem Unterpunkt der Verwaltung.
    <Absturzschutz kiosk={bereich === 'kiosk'} key={bereich}>
      {pfad.startsWith('/admin') ? (
        <Admin pfad={pfad} navigiere={navigiere} />
      ) : pfad.startsWith('/g/') ? (
        <HandyGalerie token={pfad.slice(3)} />
      ) : pfad.startsWith('/s/') ? (
        <HandyGalerie token={pfad.slice(3)} nurStatus />
      ) : (
        <Kiosk navigiere={navigiere} />
      )}
    </Absturzschutz>
  );

  function navigiere(ziel: string) {
    window.history.pushState({}, '', ziel);
    setzePfad(ziel);
  }
}
