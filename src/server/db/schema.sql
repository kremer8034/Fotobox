-- Schema der Fotobox-Datenbank.
--
-- Grundsatz: Jeder Schritt einer Sitzung wird sofort geschrieben. Faellt der Strom
-- aus oder stuerzt der Server ab, ist hoechstens die laufende Sitzung verloren,
-- niemals das Event oder die Zaehler.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS geraet (
  schluessel TEXT PRIMARY KEY,
  wert       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vorlagen (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  canvas      TEXT NOT NULL,
  definition  TEXT NOT NULL,
  vorschau    TEXT,
  erstellt    TEXT NOT NULL,
  geaendert   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filter (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  operationen  TEXT NOT NULL,
  eingebaut    INTEGER NOT NULL DEFAULT 0,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  datum               TEXT NOT NULL,
  ordner              TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'entwurf',
  galerie_token       TEXT NOT NULL,
  status_token        TEXT NOT NULL,
  betreuer_pin_hash   TEXT,
  material_verbraucht INTEGER NOT NULL DEFAULT 0,
  probelauf           INTEGER NOT NULL DEFAULT 0,
  erstellt            TEXT NOT NULL,
  geschlossen_am      TEXT,
  einstellungen       TEXT NOT NULL
);

-- Es darf immer nur genau ein Event aktiv sein. Das verhindert den Klassiker,
-- dass Fotos im Ordner der letzten Hochzeit landen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_ein_aktives
  ON events (status) WHERE status = 'aktiv';

CREATE TABLE IF NOT EXISTS sitzungen (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vorlage_id TEXT NOT NULL,
  filter_id  TEXT,
  gestartet  TEXT NOT NULL,
  beendet    TEXT,
  ist_test   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sitzungen_event ON sitzungen(event_id);

CREATE TABLE IF NOT EXISTS fotos (
  id              TEXT PRIMARY KEY,
  sitzung_id      TEXT NOT NULL REFERENCES sitzungen(id) ON DELETE CASCADE,
  ebene_index     INTEGER NOT NULL,
  pfad_original   TEXT NOT NULL,
  pfad_bearbeitet TEXT
);
CREATE INDEX IF NOT EXISTS idx_fotos_sitzung ON fotos(sitzung_id);

CREATE TABLE IF NOT EXISTS ausgaben (
  id             TEXT PRIMARY KEY,
  sitzung_id     TEXT NOT NULL REFERENCES sitzungen(id) ON DELETE CASCADE,
  pfad_layout    TEXT NOT NULL,
  pfad_druck_pdf TEXT,
  erstellt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ausgaben_sitzung ON ausgaben(sitzung_id);

CREATE TABLE IF NOT EXISTS druckauftraege (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ausgabe_id  TEXT REFERENCES ausgaben(id) ON DELETE SET NULL,
  kopien      INTEGER NOT NULL,
  quelle      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'wartend',
  berechnen   INTEGER NOT NULL DEFAULT 1,
  angefordert TEXT NOT NULL,
  gedruckt    TEXT,
  fehlertext  TEXT,
  pfad_pdf    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_druck_event  ON druckauftraege(event_id);
CREATE INDEX IF NOT EXISTS idx_druck_status ON druckauftraege(status);

CREATE TABLE IF NOT EXISTS versand (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ausgabe_id       TEXT REFERENCES ausgaben(id) ON DELETE SET NULL,
  kanal            TEXT NOT NULL,
  ziel             TEXT NOT NULL,
  einwilligung_am  TEXT,
  status           TEXT NOT NULL DEFAULT 'wartend',
  gesendet_am      TEXT,
  geloescht_am     TEXT
);
CREATE INDEX IF NOT EXISTS idx_versand_event ON versand(event_id);

CREATE TABLE IF NOT EXISTS protokoll (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  zeit     TEXT NOT NULL,
  ebene    TEXT NOT NULL,
  bereich  TEXT NOT NULL,
  text     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_protokoll_zeit ON protokoll(zeit);
