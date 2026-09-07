import { useEffect, useState } from 'react';
import { Kiosk } from './kiosk/Kiosk.js';
import { Admin } from './admin/Admin.js';
import { HandyGalerie } from './galerie/HandyGalerie.js';

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
  }, [pfad]);

  if (pfad.startsWith('/admin')) return <Admin pfad={pfad} navigiere={navigiere} />;
  if (pfad.startsWith('/g/')) return <HandyGalerie token={pfad.slice(3)} />;
  if (pfad.startsWith('/s/')) return <HandyGalerie token={pfad.slice(3)} nurStatus />;
  return <Kiosk navigiere={navigiere} />;

  function navigiere(ziel: string) {
    window.history.pushState({}, '', ziel);
    setzePfad(ziel);
  }
}
