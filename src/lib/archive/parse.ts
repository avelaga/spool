/** Pure parsing: folder names → dates, titles and filters. No I/O. */
import type { RollDate, Size, SpoolConfig, VariantRole } from './types.ts';

/** "22.9.6 august f3", "18.2.21 | 1st Bronica", "19.12.6. | panf", "8.18.17 Scans" */
const DATE_PREFIX = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})\.?(?:\s*\|)?\s*(.*)$/;

export function hasDatePrefix(name: string): boolean {
  return DATE_PREFIX.test(name.trim());
}

/** macOS shows ':' in on-disk names as '/' in Finder — display it the way you typed it. */
export function displayName(name: string): string {
  return name.replace(/:/g, '/').replace(/\s+/g, ' ').trim();
}

export function yearsIn(name: string): number[] {
  return [...name.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
}

function makeDate(year: number, month: number, day: number): RollDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Parse a roll folder name. Dates are YY.M.D; when that doesn't fit the
 * collection's year (e.g. "11.9.19" inside "fall 2019"), M.D.YY is tried.
 */
export function parseRollName(
  name: string,
  collectionYears: number[] = [],
): { date: RollDate | null; title: string } {
  const m = DATE_PREFIX.exec(name.trim());
  if (!m) return { date: null, title: displayName(name) };

  const [a, b, c] = [m[1], m[2], m[3]].map(Number);
  const ymd = makeDate(2000 + a, b, c);
  const mdy = makeDate(2000 + c, a, b);
  const fits = (d: RollDate | null) =>
    d !== null && (collectionYears.length === 0 || collectionYears.some((y) => Math.abs(y - d.year) <= 1));

  let date: RollDate | null;
  if (fits(ymd)) date = ymd;
  else if (fits(mdy)) date = { ...mdy!, guessed: 'mdy' };
  else date = ymd ?? (mdy && { ...mdy, guessed: 'mdy' });

  return { date, title: displayName(m[4]) || displayName(name) };
}

export function formatDate(d: RollDate | null): string {
  if (!d) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return [d.year, d.month && p(d.month), d.day && p(d.day)].filter(Boolean).join('-');
}

export function parseDateString(s: string): RollDate {
  const [year, month, day] = s.split('-').map(Number);
  return { year, ...(month ? { month } : {}), ...(day ? { day } : {}) };
}

export interface Classification {
  size: Size | null;
  class: string | null;
  film: string | null;
  tone: 'B&W' | 'Color' | null;
}

function firstMatch<T extends { match: RegExp[] }>(rules: T[], text: string): T | undefined {
  return rules.find((r) => r.match.some((re) => re.test(text)));
}

/** Classify from free text (roll title + subfolder names). */
export function classify(text: string, config: SpoolConfig, sizeOverride?: Size | null): Classification {
  const t = text.toLowerCase();
  const size = sizeOverride !== undefined ? sizeOverride : (firstMatch(config.sizes, t)?.value ?? null);
  const film = firstMatch(config.films, t);
  const cls =
    firstMatch(config.classes, t) ?? config.classes.find((c) => size && c.sizes?.includes(size));
  const bw = film?.bw || config.bwKeywords.some((re) => re.test(t));
  return {
    size,
    class: cls?.value ?? null,
    film: film?.value ?? null,
    tone: bw ? 'B&W' : film ? 'Color' : null,
  };
}

/** Class implied by size alone (used after size is inferred from the images). */
export function classForSize(size: Size, config: SpoolConfig): string | null {
  return config.classes.find((c) => c.sizes?.includes(size))?.value ?? null;
}

/**
 * Guess negative size from image shape and frame count, for rolls whose
 * name doesn't say. Scans include borders, so this is deliberately coarse.
 */
export function inferSize(ratio: number | null, frames: number): Size | null {
  if (ratio === null) return null;
  const r = ratio < 1 ? 1 / ratio : ratio;
  // 35mm never scans this boxy, so these hold even for folders with several 120 rolls in them
  if (r < 1.06) return '6x6';
  if (r < 1.29) return '6x7';
  if (r < 1.42) return '645';
  // 35mm scans that include the film rebate measure up to ~1.7
  if (r < 1.72) return frames >= 20 ? '35mm' : frames <= 10 && r < 1.6 ? '6x9' : null;
  return null;
}

/** Sizes whose scans are too close in shape to tell apart (35mm ≈ 6x9; 645 ≈ 6x7 ≈ 4x5). */
const LOOKALIKES: Size[][] = [
  ['35mm', '6x9'],
  ['645', '6x7', '4x5'],
];
export function sizesLookAlike(a: Size, b: Size): boolean {
  return a === b || LOOKALIKES.some((g) => g.includes(a) && g.includes(b));
}

export function variantFor(
  subPath: string,
  config: SpoolConfig,
): { role: VariantRole; rank: number; known: boolean; replaces: boolean } {
  if (subPath === '') return { role: 'show', rank: 1, known: true, replaces: false };
  const p = subPath.toLowerCase();
  const rule = config.variants.find((v) => v.match.test(p));
  if (!rule) return { role: 'show', rank: 0.5, known: false, replaces: false };
  return { role: rule.role, rank: rule.rank ?? 0, known: true, replaces: rule.replaces ?? false };
}

/** Frame identity: the file stem; trailing number is the fallback when a folder renames files. */
export function stemOf(file: string): string {
  return file.replace(/\.[^.]+$/, '').toLowerCase().trim();
}
export function frameNumberOf(file: string): number | null {
  const m = /(\d+)\D*$/.exec(stemOf(file));
  return m ? Number(m[1]) : null;
}

export interface Candidate {
  file: string; // name
  dir: string; // subfolder inside roll, '' = top
  rank: number;
}

/**
 * One photo per frame: match versions across folders by stem (falling back to
 * trailing frame number), keep the highest-ranked version.
 */
export function pickFrames(candidates: Candidate[]): Map<string, Candidate> {
  const byDir = new Map<string, Candidate[]>();
  for (const c of candidates) byDir.set(c.dir, [...(byDir.get(c.dir) ?? []), c]);

  // The biggest folder defines frame identity; others are matched onto it.
  const dirs = [...byDir.keys()].sort(
    (a, b) => byDir.get(b)!.length - byDir.get(a)!.length || rankOf(byDir, b) - rankOf(byDir, a),
  );
  const frames = new Map<string, Candidate>();
  const byNumber = new Map<number, string>();

  for (const [i, dir] of dirs.entries()) {
    for (const c of byDir.get(dir)!) {
      let key = stemOf(c.file);
      if (i > 0 && !frames.has(key)) {
        const n = frameNumberOf(c.file);
        const viaNumber = n !== null ? byNumber.get(n) : undefined;
        if (viaNumber) key = viaNumber;
      }
      const existing = frames.get(key);
      if (!existing || c.rank > existing.rank) frames.set(key, c);
      if (i === 0) {
        const n = frameNumberOf(c.file);
        if (n !== null && !byNumber.has(n)) byNumber.set(n, key);
      }
    }
  }
  return frames;
}

function rankOf(byDir: Map<string, Candidate[]>, dir: string): number {
  return byDir.get(dir)![0].rank;
}

/** Match a file name (e.g. from a selects folder) to an existing frame key. */
export function matchFrame(file: string, frames: Map<string, Candidate>): string | null {
  const stem = stemOf(file);
  if (frames.has(stem)) return stem;
  const n = frameNumberOf(file);
  if (n === null) return null;
  for (const [key, c] of frames) if (frameNumberOf(c.file) === n) return key;
  return null;
}
