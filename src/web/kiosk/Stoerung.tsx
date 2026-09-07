import type { Stoerungstext } from '../api.js';

/**
 * Gaeste bekommen keine technischen Fehlertexte - aber sehr wohl eine klare
 * Ansage. Kein Fehlercode, kein Geraetename, keine Aufforderung, selbst am
 * Drucker zu hantieren. Stattdessen drei Saetze in Alltagssprache, damit ein
 * Gast das Problem weitergeben kann, ohne es zu verstehen.
 */
export function Stoerungshinweis({ text }: { text: Stoerungstext }) {
  return (
    <div className="stoerung">
      <p className="stoerung__titel">{text.titel}</p>
      {text.folge && <p className="stoerung__folge">{text.folge}</p>}
      {text.tun && <p className="stoerung__tun">{text.tun}</p>}
    </div>
  );
}
