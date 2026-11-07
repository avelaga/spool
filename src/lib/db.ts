/**
 * SQLite (node:sqlite) — lives in SPOOL_DATA, never in the archive.
 * Rolls/photos are rebuilt from the archive by the indexer; `tags` is the only
 * user-authored table and is keyed by content hash so it survives moves/renames.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import config from '../../spool.config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rolls (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  collection   TEXT,
  title        TEXT NOT NULL,
  date         TEXT,              -- 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' (sortable)
  year         INTEGER,
  size         TEXT,
  size_inferred INTEGER NOT NULL DEFAULT 0,
  class        TEXT,
  film         TEXT,
  tone         TEXT,
  frame_count  INTEGER NOT NULL DEFAULT 0,
  flags        TEXT NOT NULL DEFAULT '[]',
  seen_run     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY,
  path       TEXT NOT NULL UNIQUE,
  roll_id    INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,     -- order within roll
  frame_key  TEXT NOT NULL,
  is_select  INTEGER NOT NULL DEFAULT 0,
  hash       TEXT NOT NULL,        -- sha1 of file contents
  bytes      INTEGER NOT NULL,
  mtime      INTEGER NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  color      TEXT,                 -- dominant colour, for placeholders
  exif       TEXT,                 -- JSON subset
  seen_run   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_roll ON photos(roll_id, idx);
CREATE INDEX IF NOT EXISTS photos_hash ON photos(hash);
CREATE TABLE IF NOT EXISTS tags (
  hash TEXT NOT NULL,
  tag  TEXT NOT NULL,
  PRIMARY KEY (hash, tag)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Privacy (see src/lib/privacy.ts). Never rebuilt by the indexer.
-- private:yes / private:no per photo, matched on content hash OR path so a rename
-- or a re-export alone can't un-hide anything.
CREATE TABLE IF NOT EXISTS private_photos (
  id         INTEGER PRIMARY KEY,
  hash       TEXT NOT NULL,
  path       TEXT NOT NULL,
  private    INTEGER NOT NULL CHECK (private IN (0, 1)),
  via_roll   INTEGER NOT NULL DEFAULT 0,  -- written by "make roll private"
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS private_photos_hash ON private_photos(hash);
CREATE INDEX IF NOT EXISTS private_photos_path ON private_photos(path);
CREATE TABLE IF NOT EXISTS private_rolls (
  path       TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL
);
`;

export const dataDir = resolve(/* turbopackIgnore: true */ config.dataDir);
export const thumbDir = join(dataDir, 'thumbs');
export const viewDir = join(dataDir, 'views');

const g = globalThis as unknown as { __spoolDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__spoolDb) {
    mkdirSync(dataDir, { recursive: true });
    const d = new DatabaseSync(join(dataDir, 'spool.db'));
    d.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    d.exec(SCHEMA);
    g.__spoolDb = d;
  }
  return g.__spoolDb;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function getMeta(key: string): string | null {
  const row = db().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
export function setMeta(key: string, value: string) {
  db().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Cache file for a derivative, sharded by hash prefix. */
export function cachePath(dir: string, hash: string): string {
  return join(/* turbopackIgnore: true */ dir, hash.slice(0, 2), `${hash}.webp`);
}
