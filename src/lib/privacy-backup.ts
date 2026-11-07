/**
 * Privacy backups + the lockdown safeguard.
 *
 * The private list lives only in the (git-ignored) SQLite DB. To survive losing it:
 *  - every change writes backups/privacy-latest.json and backups/privacy-YYYY-MM-DD.json
 *  - those files double as the record of how much SHOULD be private
 *
 * Lockdown: if the DB holds fewer private markings than the latest backup (or none while
 * SPOOL_PRIVACY_REQUIRED=1), guests see nothing at all until it's restored. Fails toward hiding.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import config from '../../spool.config.ts';
import { db, tx } from './db.ts';

export const backupDir = resolve(/* turbopackIgnore: true */ process.env.SPOOL_BACKUP_DIR ?? './backups');
const LATEST = 'privacy-latest.json';

export interface PrivacyBackup {
  version: 1;
  exportedAt: string;
  photos: { hash: string; path: string; private: 0 | 1; via_roll: 0 | 1 }[];
  rolls: { path: string }[];
}

function assertOutsideArchive() {
  if (!relative(resolve(config.archiveRoot), backupDir).startsWith('..')) {
    throw new Error(`SPOOL_BACKUP_DIR (${backupDir}) must be outside the archive`);
  }
}

export function exportPrivacy(): PrivacyBackup {
  const d = db();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    photos: d.prepare('SELECT hash, path, private, via_roll FROM private_photos ORDER BY path').all() as PrivacyBackup['photos'],
    rolls: d.prepare('SELECT path FROM private_rolls ORDER BY path').all() as PrivacyBackup['rolls'],
  };
}

const expectedCount = (b: Pick<PrivacyBackup, 'photos' | 'rolls'>) =>
  b.photos.filter((p) => p.private === 1).length + b.rolls.length;

function actualCount(): number {
  const d = db();
  const p = (d.prepare('SELECT COUNT(*) n FROM private_photos WHERE private = 1').get() as { n: number }).n;
  const r = (d.prepare('SELECT COUNT(*) n FROM private_rolls').get() as { n: number }).n;
  return p + r;
}

/** Atomic write (tmp + rename) so a crash can't leave a half-written backup. */
function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ tmp, JSON.stringify(data, null, 2));
  renameSync(/* turbopackIgnore: true */ tmp, file);
}

/** Write latest + today's copy. Returns the latest file path. */
export function writeBackup(): string {
  assertOutsideArchive();
  mkdirSync(backupDir, { recursive: true });
  const data = exportPrivacy();
  const day = data.exportedAt.slice(0, 10);
  writeJson(join(backupDir, `privacy-${day}.json`), data);
  writeJson(join(backupDir, LATEST), data);
  cached = null;
  return join(backupDir, LATEST);
}

/** Called after every privacy change. Never overwrites the evidence while locked down. */
export function autoBackup() {
  try {
    if (privacyStatus().lockdown) {
      console.error('[spool] privacy lockdown active — not overwriting backups. Restore with: npm run privacy:restore');
      return;
    }
    writeBackup();
  } catch (e) {
    // A failed backup makes the next status check see a mismatch → lockdown (fails safe).
    console.error(`[spool] privacy backup failed: ${(e as Error).message}`);
  }
}

export function readBackup(file = join(backupDir, LATEST)): PrivacyBackup | null {
  if (!existsSync(/* turbopackIgnore: true */ file)) return null;
  const data = JSON.parse(readFileSync(/* turbopackIgnore: true */ file, 'utf8'));
  if (data?.version !== 1 || !Array.isArray(data.photos) || !Array.isArray(data.rolls)) {
    throw new Error(`Not a Spool privacy backup: ${file}`);
  }
  return data;
}

/** Merge a backup into the DB. Existing markings are kept; private:yes still wins on conflict. */
export function restoreBackup(file?: string): { photos: number; rolls: number } {
  const data = readBackup(file);
  if (!data) throw new Error(`No backup found at ${file ?? join(backupDir, LATEST)}`);
  const d = db();
  const has = d.prepare('SELECT 1 FROM private_photos WHERE hash = ? AND path = ? AND private = ?');
  const ins = d.prepare('INSERT INTO private_photos (hash, path, private, via_roll, updated_at) VALUES (?, ?, ?, ?, ?)');
  const roll = d.prepare('INSERT OR IGNORE INTO private_rolls (path, updated_at) VALUES (?, ?)');
  let photos = 0;
  let rolls = 0;
  tx(() => {
    for (const p of data.photos) {
      if (has.get(p.hash, p.path, p.private)) continue;
      ins.run(p.hash, p.path, p.private, p.via_roll, Date.now());
      photos++;
    }
    for (const r of data.rolls) rolls += Number(roll.run(r.path, Date.now()).changes);
  });
  cached = null;
  return { photos, rolls };
}

let cached: { at: number; value: PrivacyStatus } | null = null;
let warned = false;

export interface PrivacyStatus {
  lockdown: boolean;
  expected: number;
  actual: number;
  reason: string | null;
}

/** Cheap enough to call per request (cached for a few seconds). */
export function privacyStatus(): PrivacyStatus {
  if (cached && Date.now() - cached.at < 3000) return cached.value;

  const actual = actualCount();
  let expected = process.env.SPOOL_PRIVACY_REQUIRED === '1' ? 1 : 0;
  let reason: string | null = null;
  try {
    const backup = readBackup();
    if (backup) expected = Math.max(expected, expectedCount(backup));
  } catch (e) {
    expected = Math.max(expected, 1); // unreadable backup: assume something should be private
    reason = `backup unreadable: ${(e as Error).message}`;
  }
  const lockdown = actual < expected;
  if (lockdown) {
    reason ??= `${actual} private markings in the database, backup expects ${expected}`;
    if (!warned) {
      console.error(`[spool] PRIVACY LOCKDOWN — guests see nothing. ${reason}. Restore with: npm run privacy:restore`);
      warned = true;
    }
  } else warned = false;

  const value = { lockdown, expected, actual, reason: lockdown ? reason : null };
  cached = { at: Date.now(), value };
  return value;
}
