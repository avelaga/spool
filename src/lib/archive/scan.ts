/** Walk the archive (read-only) and turn it into rolls + photos. */
import { join } from 'node:path';
import { listDir, readHead, isHidden } from './fs.ts';
import { jpegSize } from './jpeg-size.ts';
import {
  classify,
  classForSize,
  displayName,
  hasDatePrefix,
  inferSize,
  matchFrame,
  parseDateString,
  parseRollName,
  pickFrames,
  sizesLookAlike,
  variantFor,
  yearsIn,
  type Candidate,
} from './parse.ts';
import type { Photo, Roll, SpoolConfig } from './types.ts';

const JPEG = /\.jpe?g$/i;
const RAW_SCAN = /\.(tiff?|fff)$/i;

export interface ScanResult {
  rolls: Roll[];
  ignored: string[];
  unhandled: string[];
}

export async function scanArchive(config: SpoolConfig): Promise<ScanResult> {
  const root = config.archiveRoot;
  const ignore = new Set(config.ignore.map((s) => s.trim()));
  const rolls: Roll[] = [];
  const ignored: string[] = [];
  const unhandled: string[] = [];

  for (const entry of await listDir(root)) {
    if (isHidden(entry.name)) continue;
    const name = entry.name;
    if (ignore.has(name.trim())) {
      ignored.push(name);
      continue;
    }
    if (!entry.isDirectory()) {
      unhandled.push(name);
      continue;
    }
    if (hasDatePrefix(name)) {
      rolls.push(await scanRoll(config, name, null));
    } else if (config.collections.some((re) => re.test(name))) {
      for (const child of await listDir(join(root, name))) {
        if (isHidden(child.name) || !child.isDirectory()) continue;
        rolls.push(await scanRoll(config, join(name, child.name), name));
      }
    } else {
      unhandled.push(name);
    }
  }

  const kept = rolls.filter((r) => !config.overrides[r.path]?.ignore);
  kept.sort((a, b) => dateKey(a) - dateKey(b) || a.path.localeCompare(b.path));
  return { rolls: kept, ignored, unhandled };
}

function dateKey(r: Roll): number {
  const d = r.date;
  return d ? d.year * 10000 + (d.month ?? 0) * 100 + (d.day ?? 0) : 0;
}

interface FileEntry {
  dir: string; // relative to roll
  name: string;
}

async function walkRoll(abs: string, rel = '', depth = 0, nested: string[] = []): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  for (const e of await listDir(abs)) {
    if (isHidden(e.name)) continue;
    if (e.isDirectory()) {
      if (depth >= 4) continue;
      if (hasDatePrefix(e.name)) {
        nested.push(e.name); // another roll copied inside this one — skip, it's a dupe
        continue;
      }
      out.push(...(await walkRoll(join(abs, e.name), rel ? join(rel, e.name) : e.name, depth + 1, nested)));
    } else if (e.isFile()) {
      out.push({ dir: rel, name: e.name });
    }
  }
  return out;
}

async function scanRoll(config: SpoolConfig, path: string, collection: string | null): Promise<Roll> {
  const abs = join(config.archiveRoot, path);
  const folderName = path.split('/').pop()!;
  const override = config.overrides[path] ?? {};
  const flags: string[] = [];
  const nested: string[] = [];
  const files = await walkRoll(abs, '', 0, nested);
  for (const n of nested) flags.push(`skipped nested roll "${displayName(n)}"`);

  // --- date + title
  const collYears = collection ? yearsIn(collection) : [];
  let { date, title } = parseRollName(folderName, collYears);
  if (!date && collYears.length) date = { year: collYears.at(-1)!, guessed: 'collection' };
  if (override.date) date = parseDateString(override.date);
  if (override.title) title = override.title;
  if (!date) flags.push('no date');
  else if (date.guessed === 'mdy') flags.push('date read as M.D.YY');
  else if (date.guessed === 'collection') flags.push('undated — year from collection');

  // --- pick one shareable JPEG per frame
  const candidates: Candidate[] = [];
  const selects: FileEntry[] = [];
  const unknownDirs = new Set<string>();
  const rawCounts = new Map<string, number>();
  for (const f of files) {
    const v = variantFor(f.dir, config);
    if (RAW_SCAN.test(f.name) && v.role === 'hide') rawCounts.set(f.dir, (rawCounts.get(f.dir) ?? 0) + 1);
    if (!JPEG.test(f.name)) continue;
    if (v.role === 'select') selects.push(f);
    else if (v.role === 'show') {
      candidates.push({ file: f.name, dir: f.dir, rank: v.rank });
      if (!v.known) unknownDirs.add(f.dir);
    }
  }
  for (const d of unknownDirs) flags.push(`unrecognised subfolder "${displayName(d)}" — shown`);

  const replacing = candidates.find((c) => variantFor(c.dir, config).replaces)?.dir;
  const frames = pickFrames(replacing === undefined ? candidates : candidates.filter((c) => c.dir === replacing));
  const selectKeys = new Set<string>();
  let unmatchedSelects = 0;
  for (const s of selects) {
    const key = matchFrame(s.name, frames);
    if (key) selectKeys.add(key);
    else unmatchedSelects++;
  }
  if (unmatchedSelects) flags.push(`${unmatchedSelects} select(s) didn't match a frame`);

  const photos: Photo[] = [...frames.entries()]
    .map(([frameKey, c]) => ({
      path: join(path, c.dir, c.file),
      frameKey,
      source: c.dir,
      select: selectKeys.has(frameKey),
    }))
    .sort((a, b) => a.frameKey.localeCompare(b.frameKey, undefined, { numeric: true }));
  if (!photos.length) flags.push(rawCounts.size ? 'no JPEGs — only raw scans' : 'no JPEGs');

  const frameCount = Math.max(photos.length, ...rawCounts.values());

  // --- filters
  const subfolderText = [...new Set(files.map((f) => f.dir))].join(' ');
  const cls = classify(`${title} ${subfolderText}`, config, override.size);
  let size = cls.size;
  let sizeFrom: Roll['sizeFrom'] = override.size !== undefined ? 'override' : size ? 'name' : null;
  let klass = override.class !== undefined ? override.class : cls.class;

  const ratio = await medianRatio(config, photos);
  const inferred = inferSize(ratio, frameCount);
  if (!size && inferred) {
    size = inferred;
    sizeFrom = 'inferred';
    if (override.class === undefined) klass ??= classForSize(inferred, config);
    flags.push(`size inferred: ${inferred} (shape ${ratio!.toFixed(2)}, ${frameCount} frames)`);
  } else if (!size) {
    flags.push(`no size${ratio ? ` (shape ${ratio.toFixed(2)}, ${frameCount} frames)` : ''}`);
  } else if (sizeFrom === 'name' && inferred && !sizesLookAlike(inferred, size)) {
    flags.push(`check size: name says ${size}, images look like ${inferred}`);
  }

  return {
    path,
    collection: collection ? displayName(collection) : null,
    title,
    date,
    size,
    sizeFrom,
    class: klass,
    film: override.film !== undefined ? override.film : cls.film,
    tone: cls.tone,
    frameCount,
    photos,
    flags,
  };
}

/** Median long/short edge ratio of a few photos — enough to tell 6x6 from 35mm. */
async function medianRatio(config: SpoolConfig, photos: Photo[]): Promise<number | null> {
  const sample = photos.filter((_, i) => i % Math.max(1, Math.floor(photos.length / 5)) === 0).slice(0, 5);
  const ratios: number[] = [];
  for (const p of sample) {
    const abs = join(config.archiveRoot, p.path);
    let dims = jpegSize(await readHead(abs, 256 * 1024));
    dims ??= jpegSize(await readHead(abs, 8 * 1024 * 1024));
    if (!dims) continue;
    p.width = dims.width;
    p.height = dims.height;
    ratios.push(Math.max(dims.width, dims.height) / Math.min(dims.width, dims.height));
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}
