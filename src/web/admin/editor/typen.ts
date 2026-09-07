export interface Ebene {
  id: string;
  typ: 'bild' | 'foto' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  sichtbar?: boolean;
  gesperrt?: boolean;
  datei?: string;
  deckkraft?: number;
  index?: number;
  einpassung?: string;
  radius?: number;
  text?: string;
  groesse?: number;
  farbe?: string;
  ausrichtung?: string;
}

export interface Vorlage {
  id: string;
  name: string;
  canvas: { preset: string; breiteMm: number; hoeheMm: number };
  ebenen: Ebene[];
  hintergrundFarbe?: string;
}
