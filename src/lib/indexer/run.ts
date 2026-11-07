/**
 * Incremental indexer. Safe to run any time, as often as you like:
 *  - walks the archive (read-only), parses rolls via spool.config.ts
 *  - only new/changed files (size or mtime differ) are read + thumbnailed
 *  - files modified in the last minute are left for the next run (still copying)
 *  - removed files/rolls are dropped from the DB; tags stay (keyed by hash)
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import config from '../../../spool.config.ts';
import { listDir, readWhole, statPath } from '../archive/fs.ts';
import { formatDate } from '../archive/parse.ts';
import { scanArchive } from '../archive/scan.ts';
import type { Photo, Roll } from '../archive/types.ts';
import { cachePath, db, setMeta, thumbDir, tx } from '../db.ts';

export const THUMB = { height: 480, maxWidth: 1200, quality: 72 };
const SETTLE_MS = 60_000;

export interface IndexStats {
  rolls: number;
  photos: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  failed: number;
  ms: number;
}

type Log = (msg: string) => void;

const g = globalThis as unknown as { __spoolIndexing?: Promise<IndexStats> };

export function isIndexing() {
  return !!g.__spoolIndexing;
}

/** Runs the indexer, or joins the run already in progress. */
export function runIndex(log: Log = () => {}): Promise<IndexStats> {
  g.__spoolIndexing ??= doRun(log).finally(() => (g.__spoolIndexing = undefined));
  return g.__spoolIndexing;
}

async function doRun(log: Log): Promise<IndexStats> {
  const t0 = Date.now();
  const run = t0;
  const d = db();

  // Safety: if the drive isn't mounted, don't treat that as "everything was deleted".
  const top = await listDir(config.archiveRoot).catch(() => null);
  if (!top?.length) throw new Error(`Archive not reachable or empty: ${config.archiveRoot}`);

  const { rolls } = await scanArchive(config);
  if (!rolls.length) throw new Error('Scan found no rolls — refusing to clear the index');

  const existing = new Map(
    (d.prepare('SELECT path, bytes, mtime, hash FROM photos').all() as { path: string; bytes: number; mtime: number; hash: string }[]).map(
      (r) => [r.path, r],
    ),
  );

  const upsertRoll = d.prepare(`
    INSERT INTO rolls (path, collection, title, date, year, size, size_inferred, class, film, tone, frame_count, flags, seen_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET collection=excluded.collection, title=excluded.title, date=excluded.date,
      year=excluded.year, size=excluded.size, size_inferred=excluded.size_inferred, class=excluded.class,
      film=excluded.film, tone=excluded.tone, frame_count=excluded.frame_count, flags=excluded.flags, seen_run=excluded.seen_run
    RETURNING id`);
  const touchPhoto = d.prepare(
    'UPDATE photos SET roll_id = ?, idx = ?, frame_key = ?, is_select = ?, seen_run = ? WHERE path = ?',
  );
  const upsertPhoto = d.prepare(`
    INSERT INTO photos (path, roll_id, idx, frame_key, is_select, hash, bytes, mtime, width, height, color, exif, seen_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET roll_id=excluded.roll_id, idx=excluded.idx, frame_key=excluded.frame_key,
      is_select=excluded.is_select, hash=excluded.hash, bytes=excluded.bytes, mtime=excluded.mtime,
      width=excluded.width, height=excluded.height, color=excluded.color, exif=excluded.exif, seen_run=excluded.seen_run`);

  // 1. Rolls + unchanged photos (cheap: stat only)
  const work: { photo: Photo; rollId: number; idx: number; bytes: number; mtime: number; isNew: boolean }[] = [];
  let skipped = 0;
  for (const roll of rolls) {
    const { id: rollId } = upsertRoll.get(...rollRow(roll, run)) as { id: number };
    for (const [idx, photo] of roll.photos.entries()) {
      const st = await statPath(join(config.archiveRoot, photo.path));
      const mtime = Math.floor(st.mtimeMs);
      const prev = existing.get(photo.path);
      if (prev && prev.bytes === st.size && prev.mtime === mtime && existsSync(cachePath(thumbDir, prev.hash))) {
        touchPhoto.run(rollId, idx, photo.frameKey, photo.select ? 1 : 0, run, photo.path);
      } else if (Date.now() - st.mtimeMs < SETTLE_MS) {
        skipped++;
        if (prev) touchPhoto.run(rollId, idx, photo.frameKey, photo.select ? 1 : 0, run, photo.path);
      } else {
        work.push({ photo, rollId, idx, bytes: st.size, mtime, isNew: !prev });
      }
    }
  }
  if (work.length) log(`${work.length} photos to process`);

  // 2. New/changed photos: hash, thumbnail, metadata
  let done = 0;
  let failed = 0;
  const concurrency = Math.max(1, Math.min(4, availableParallelism() - 1));
  await pool(work, concurrency, async (w) => {
    try {
      const buf = await readWhole(join(config.archiveRoot, w.photo.path));
      const hash = createHash('sha1').update(buf).digest('hex');
      const { width, height, color } = await makeThumb(buf, hash);
      const exif = await readExif(buf);
      upsertPhoto.run(
        w.photo.path, w.rollId, w.idx, w.photo.frameKey, w.photo.select ? 1 : 0,
        hash, w.bytes, w.mtime, width, height, color, exif, run,
      );
    } catch (e) {
      failed++;
      log(`failed: ${w.photo.path} — ${(e as Error).message}`);
    }
    if (++done % 100 === 0) log(`${done}/${work.length}`);
  });

  // 3. Drop what's gone (thumbnails are left; they're content-addressed and cheap to keep)
  const { removed } = tx(() => {
    const p = d.prepare('DELETE FROM photos WHERE seen_run != ?').run(run);
    d.prepare('DELETE FROM rolls WHERE seen_run != ?').run(run);
    d.prepare('DELETE FROM rolls WHERE id NOT IN (SELECT DISTINCT roll_id FROM photos)').run();
    return { removed: Number(p.changes) };
  });

  const stats: IndexStats = {
    rolls: (d.prepare('SELECT COUNT(*) n FROM rolls').get() as { n: number }).n,
    photos: (d.prepare('SELECT COUNT(*) n FROM photos').get() as { n: number }).n,
    added: work.filter((w) => w.isNew).length - failed,
    updated: work.filter((w) => !w.isNew).length,
    removed,
    skipped,
    failed,
    ms: Date.now() - t0,
  };
  setMeta('lastIndex', JSON.stringify({ at: Date.now(), ...stats }));
  return stats;
}

function rollRow(r: Roll, run: number) {
  return [
    r.path, r.collection, r.title, r.date ? formatDate(r.date) : null, r.date?.year ?? null,
    r.size, r.sizeFrom === 'inferred' ? 1 : 0, r.class, r.film, r.tone, r.frameCount,
    JSON.stringify(r.flags), run,
  ] as const;
}

async function makeThumb(buf: Buffer, hash: string) {
  const out = cachePath(thumbDir, hash);
  const img = sharp(buf, { failOn: 'none' }).rotate(); // honour EXIF orientation
  const meta = await img.metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const width = (swap ? meta.height : meta.width) ?? 0;
  const height = (swap ? meta.width : meta.height) ?? 0;

  const thumb = await img
    .resize({ height: THUMB.height, width: THUMB.maxWidth, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB.quality })
    .toBuffer();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, thumb);

  return { width, height, color: await averageColor(thumb) };
}

/** Mean colour of the thumbnail — a calmer placeholder than sharp's 'dominant'. */
export async function averageColor(img: Buffer | string): Promise<string> {
  const { channels } = await sharp(img).stats();
  const [r, g, b] = channels.length >= 3 ? channels : [channels[0], channels[0], channels[0]];
  return `#${[r, g, b].map((c) => Math.round(c.mean).toString(16).padStart(2, '0')).join('')}`;
}

const EXIF_FIELDS = ['Make', 'Model', 'Software', 'DateTimeOriginal', 'CreateDate', 'ImageDescription', 'Artist', 'subject', 'Keywords'];

async function readExif(buf: Buffer): Promise<string | null> {
  try {
    const all = await exifr.parse(buf, { tiff: true, exif: true, xmp: true, iptc: true, icc: false, mergeOutput: true });
    if (!all) return null;
    const picked = Object.fromEntries(EXIF_FIELDS.filter((k) => all[k] != null).map((k) => [k, all[k]]));
    return Object.keys(picked).length ? JSON.stringify(picked) : null;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}
