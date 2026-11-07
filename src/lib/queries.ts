import 'server-only';
import { db, getMeta } from './db.ts';
import { PRIVATE_SQL } from './privacy.ts';
import { privacyStatus } from './privacy-backup.ts';

export interface RollDTO {
  id: number;
  title: string;
  collection: string | null;
  date: string | null;
  year: number | null;
  size: string | null;
  sizeInferred: boolean;
  class: string | null;
  film: string | null;
  tone: string | null;
  count: number;
  /** Private view only: the whole roll is private. */
  private?: boolean;
}

/**
 * Compact photo tuple for the client: [id, rollId, width, height, color, isSelect, hash8, isPrivate?]
 * isPrivate is only present in the private view.
 */
export type PhotoTuple = [number, number, number, number, string, 0 | 1, string, (0 | 1)?];

export interface ArchiveData {
  rolls: RollDTO[];
  photos: PhotoTuple[];
  lastIndex: { at: number } | null;
  /** Private view only: why guests are locked out, if they are. */
  lockdown?: string | null;
}

export interface Viewer {
  owner: boolean;
}
const GUEST: Viewer = { owner: false };

/** Guests see nothing at all while the private list looks lost (see privacy-backup.ts). */
const guestVisible = () => (privacyStatus().lockdown ? '0' : `NOT ${PRIVATE_SQL}`);

/** Rolls with their photo counts. Guests: private photos uncounted, rolls with nothing visible left out. */
function rollsQuery(v: Viewer, rollId?: number): RollDTO[] {
  const visible = v.owner ? '1' : guestVisible();
  const rows = db()
    .prepare(
      `SELECT * FROM (
         SELECT r.id, r.title, r.collection, r.date, r.year, r.size, r.size_inferred AS sizeInferred,
                r.class, r.film, r.tone, r.path,
                (SELECT COUNT(*) FROM photos p WHERE p.roll_id = r.id AND ${visible}) AS count,
                EXISTS (SELECT 1 FROM private_rolls pr WHERE pr.path = r.path) AS isPrivate
         FROM rolls r ${rollId ? 'WHERE r.id = ?' : ''}
       ) WHERE count > 0
       ORDER BY date DESC, path DESC`,
    )
    .all(...(rollId ? [rollId] : [])) as Record<string, unknown>[];
  return rows.map((r) => {
    const { path: _path, isPrivate, sizeInferred, ...rest } = r;
    return {
      ...(rest as unknown as RollDTO),
      sizeInferred: !!sizeInferred,
      ...(v.owner ? { private: !!isPrivate } : {}),
    };
  });
}

/** Everything the archive view needs, newest roll first. ~6k photos ≈ 250 KB, filtered client-side. */
export function getArchive(rollId?: number, v: Viewer = GUEST): ArchiveData {
  const rolls = rollsQuery(v, rollId);
  const rows = db()
    .prepare(
      `SELECT p.id, p.roll_id, p.width, p.height, p.color, p.is_select, substr(p.hash, 1, 8) h,
              ${v.owner ? PRIVATE_SQL : '0'} AS priv
       FROM photos p JOIN rolls r ON r.id = p.roll_id
       WHERE ${rollId ? 'r.id = ? AND' : ''} ${v.owner ? '1' : guestVisible()}
       ORDER BY r.date DESC, r.path DESC, p.idx`,
    )
    .all(...(rollId ? [rollId] : [])) as {
    id: number;
    roll_id: number;
    width: number;
    height: number;
    color: string;
    is_select: number;
    h: string;
    priv: number;
  }[];
  const photos = rows.map((p): PhotoTuple => {
    const t: PhotoTuple = [p.id, p.roll_id, p.width, p.height, p.color ?? '#888', p.is_select ? 1 : 0, p.h];
    if (v.owner) t.push(p.priv ? 1 : 0);
    return t;
  });
  const last = getMeta('lastIndex');
  // Only the timestamp leaves the server — the stored stats count private photos too.
  return { rolls, photos, lastIndex: last ? { at: JSON.parse(last).at } : null };
}

export function getRollNeighbors(id: number, v: Viewer = GUEST): { prev: RollDTO | null; next: RollDTO | null } {
  const rolls = rollsQuery(v); // newest first
  const i = rolls.findIndex((r) => r.id === id);
  if (i < 0) return { prev: null, next: null };
  return { prev: rolls[i + 1] ?? null, next: rolls[i - 1] ?? null };
}

/** File info for the image routes, including whether it's private (callers must check). */
export function getPhotoFile(id: number) {
  return db()
    .prepare(
      `SELECT p.path, p.hash, p.bytes, p.mtime, ${PRIVATE_SQL} AS isPrivate
       FROM photos p JOIN rolls r ON r.id = p.roll_id WHERE p.id = ?`,
    )
    .get(id) as { path: string; hash: string; bytes: number; mtime: number; isPrivate: number } | undefined;
}
