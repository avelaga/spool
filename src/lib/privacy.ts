/**
 * The one place that decides whether a photo is private.
 *
 * Rule (fails toward hiding):
 *   1. Any private:yes row matching the photo's hash OR path  → private
 *   2. Else, roll is private and no private:no exception      → private
 *   3. Else                                                    → visible
 *
 * PRIVATE_SQL expects the photo aliased `p` and its roll aliased `r`.
 */
import { db, tx } from './db.ts';
import { autoBackup } from './privacy-backup.ts';

const MATCH = '(x.hash = p.hash OR x.path = p.path)';

export const PRIVATE_SQL = `(
  EXISTS (SELECT 1 FROM private_photos x WHERE ${MATCH} AND x.private = 1)
  OR (
    EXISTS (SELECT 1 FROM private_rolls pr WHERE pr.path = r.path)
    AND NOT EXISTS (SELECT 1 FROM private_photos x WHERE ${MATCH} AND x.private = 0)
  )
)`;

interface PhotoRef {
  id: number;
  hash: string;
  path: string;
  rollPath: string;
}

function photoRefs(ids: number[]): PhotoRef[] {
  if (!ids.length) return [];
  return db()
    .prepare(
      `SELECT p.id, p.hash, p.path, r.path AS rollPath FROM photos p JOIN rolls r ON r.id = p.roll_id
       WHERE p.id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as unknown as PhotoRef[];
}

function isRollPrivate(rollPath: string): boolean {
  return !!db().prepare('SELECT 1 FROM private_rolls WHERE path = ?').get(rollPath);
}

/** private:yes / private:no for individual photos. */
export function setPhotosPrivate(ids: number[], value: boolean) {
  const d = db();
  const del = d.prepare('DELETE FROM private_photos WHERE hash = ? OR path = ?');
  const ins = d.prepare('INSERT INTO private_photos (hash, path, private, via_roll, updated_at) VALUES (?, ?, ?, 0, ?)');
  tx(() => {
    for (const p of photoRefs(ids)) {
      del.run(p.hash, p.path);
      // Explicit "no" only matters as an exception inside a private roll; otherwise "no" is the default.
      if (value) ins.run(p.hash, p.path, 1, Date.now());
      else if (isRollPrivate(p.rollPath)) ins.run(p.hash, p.path, 0, Date.now());
    }
  });
  autoBackup();
}

/**
 * Whole roll. Besides the roll rule (which also covers frames added later), every current
 * frame gets a private:yes row so renaming the roll folder can't un-hide it.
 */
export function setRollPrivate(rollId: number, value: boolean) {
  const d = db();
  const roll = d.prepare('SELECT path FROM rolls WHERE id = ?').get(rollId) as { path: string } | undefined;
  if (!roll) return;
  const photos = d.prepare('SELECT hash, path FROM photos WHERE roll_id = ?').all(rollId) as { hash: string; path: string }[];
  tx(() => {
    if (value) {
      d.prepare('INSERT OR REPLACE INTO private_rolls (path, updated_at) VALUES (?, ?)').run(roll.path, Date.now());
      const has = d.prepare('SELECT 1 FROM private_photos WHERE (hash = ? OR path = ?) AND private = 1');
      const ins = d.prepare('INSERT INTO private_photos (hash, path, private, via_roll, updated_at) VALUES (?, ?, 1, 1, ?)');
      const dropNo = d.prepare('DELETE FROM private_photos WHERE (hash = ? OR path = ?) AND private = 0');
      for (const p of photos) {
        dropNo.run(p.hash, p.path);
        if (!has.get(p.hash, p.path)) ins.run(p.hash, p.path, Date.now());
      }
    } else {
      d.prepare('DELETE FROM private_rolls WHERE path = ?').run(roll.path);
      // Remove what the roll rule wrote and any exceptions; photos you hid one by one stay hidden.
      const del = d.prepare('DELETE FROM private_photos WHERE (hash = ? OR path = ?) AND (via_roll = 1 OR private = 0)');
      for (const p of photos) del.run(p.hash, p.path);
    }
  });
  autoBackup();
}
