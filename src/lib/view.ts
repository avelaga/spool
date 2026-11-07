/** Client-side filtering + justified layout. Pure functions, no React. */
import { getOwnerKey } from './owner-store.ts';
import type { PhotoTuple, RollDTO } from './queries.ts';

export const P = { id: 0, roll: 1, w: 2, h: 3, color: 4, sel: 5, v: 6, priv: 7 } as const;

/** Private photos need the key on the URL (img tags can't send headers); everything else stays cacheable. */
const keyed = (p: PhotoTuple, url: string) =>
  p[P.priv] ? `${url}?k=${encodeURIComponent(getOwnerKey() ?? '')}` : url;

export const thumbUrl = (p: PhotoTuple) => keyed(p, `/api/thumb/${p[P.id]}/${p[P.v]}`);
export const viewUrl = (p: PhotoTuple) => keyed(p, `/api/view/${p[P.id]}/${p[P.v]}`);
export const originalUrl = (p: PhotoTuple) => keyed(p, `/api/original/${p[P.id]}`);

// ---------- filters

export interface Facet {
  key: string;
  label: string;
  get: (r: RollDTO) => string | null;
  order?: string[];
}

export const FACETS: Facet[] = [
  { key: 'type', label: 'Type', get: (r) => r.class, order: ['Point & shoot', 'Medium format', 'Large format'] },
  { key: 'format', label: 'Format', get: (r) => r.size, order: ['35mm', '645', '6x6', '6x7', '6x9', '4x5'] },
  { key: 'film', label: 'Film', get: (r) => r.film },
  { key: 'tone', label: 'Tone', get: (r) => r.tone, order: ['Color', 'B&W'] },
  { key: 'year', label: 'Year', get: (r) => (r.year ? String(r.year) : null) },
];

export const slug = (v: string) => v.toLowerCase().replace(/&/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface FilterState {
  facets: Record<string, Set<string>>; // facet key → selected slugs
  selects: boolean;
  newestFirst: boolean;
  grouped: boolean;
}

export function readFilters(params: URLSearchParams): FilterState {
  const facets: Record<string, Set<string>> = {};
  for (const f of FACETS) {
    const v = params.get(f.key);
    facets[f.key] = new Set(v ? v.split(',').filter(Boolean) : []);
  }
  return {
    facets,
    selects: params.get('selects') === '1',
    newestFirst: params.get('sort') !== 'oldest',
    grouped: params.get('view') !== 'stream',
  };
}

export function writeFilters(params: URLSearchParams, s: FilterState): URLSearchParams {
  const out = new URLSearchParams(params);
  for (const f of FACETS) {
    const vals = [...s.facets[f.key]];
    if (vals.length) out.set(f.key, vals.join(','));
    else out.delete(f.key);
  }
  s.selects ? out.set('selects', '1') : out.delete('selects');
  s.newestFirst ? out.delete('sort') : out.set('sort', 'oldest');
  s.grouped ? out.delete('view') : out.set('view', 'stream');
  out.delete('photo');
  return out;
}

export const hasActiveFilters = (s: FilterState) => s.selects || FACETS.some((f) => s.facets[f.key].size > 0);

function rollMatches(r: RollDTO, s: FilterState, except?: string) {
  return FACETS.every((f) => {
    if (f.key === except) return true;
    const want = s.facets[f.key];
    if (!want.size) return true;
    const v = f.get(r);
    return v !== null && want.has(slug(v));
  });
}

export interface FacetOption {
  value: string;
  slug: string;
  count: number;
  active: boolean;
}

/** Options per facet with counts that reflect every *other* active filter. */
export function facetOptions(rolls: RollDTO[], selectCounts: Map<number, number>, s: FilterState) {
  const photoCount = (r: RollDTO) => (s.selects ? (selectCounts.get(r.id) ?? 0) : r.count);
  const result: Record<string, FacetOption[]> = {};
  for (const f of FACETS) {
    const counts = new Map<string, number>();
    for (const r of rolls) {
      const v = f.get(r);
      if (v === null) continue;
      if (!counts.has(v)) counts.set(v, 0);
      if (rollMatches(r, s, f.key)) counts.set(v, counts.get(v)! + photoCount(r));
    }
    const values = [...counts.keys()];
    const order = f.order ?? [];
    values.sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      if (f.key === 'year') return Number(b) - Number(a);
      return counts.get(b)! - counts.get(a)!;
    });
    result[f.key] = values.map((value) => ({
      value,
      slug: slug(value),
      count: counts.get(value)!,
      active: s.facets[f.key].has(slug(value)),
    }));
  }
  return result;
}

export interface Section {
  roll: RollDTO;
  photos: PhotoTuple[];
}

export function applyFilters(rolls: RollDTO[], photos: PhotoTuple[], s: FilterState): Section[] {
  const keep = new Map<number, Section>();
  for (const r of rolls) if (rollMatches(r, s)) keep.set(r.id, { roll: r, photos: [] });
  for (const p of photos) {
    if (s.selects && !p[P.sel]) continue;
    keep.get(p[P.roll])?.photos.push(p);
  }
  const sections = [...keep.values()].filter((x) => x.photos.length);
  return s.newestFirst ? sections : sections.reverse();
}

// ---------- justified layout

export type Block =
  | { kind: 'header'; y: number; h: number; roll: RollDTO; count: number }
  | { kind: 'row'; y: number; h: number; items: { photo: PhotoTuple; index: number; x: number; w: number }[] };

export interface Layout {
  blocks: Block[];
  height: number;
}

export function rowHeightFor(width: number) {
  return width < 600 ? 140 : width < 1100 ? 200 : 250;
}

export function justify(
  sections: { roll: RollDTO | null; photos: PhotoTuple[] }[],
  width: number,
  opts: { gap: number; target: number; header: number; sectionGap: number },
): Layout {
  const blocks: Block[] = [];
  let y = 0;
  let index = 0;
  for (const [si, sec] of sections.entries()) {
    if (sec.roll) {
      if (si > 0) y += opts.sectionGap;
      blocks.push({ kind: 'header', y, h: opts.header, roll: sec.roll, count: sec.photos.length });
      y += opts.header;
    }
    let row: { photo: PhotoTuple; index: number; ar: number }[] = [];
    let arSum = 0;
    const flush = (last: boolean) => {
      if (!row.length) return;
      const free = width - opts.gap * (row.length - 1);
      const h = last ? Math.min(opts.target, free / arSum) : free / arSum;
      let x = 0;
      const items = row.map((r) => {
        const w = r.ar * h;
        const item = { photo: r.photo, index: r.index, x, w };
        x += w + opts.gap;
        return item;
      });
      blocks.push({ kind: 'row', y, h, items });
      y += h + opts.gap;
      row = [];
      arSum = 0;
    };
    for (const p of sec.photos) {
      const ar = Math.min(3, Math.max(0.33, p[P.w] / p[P.h] || 1.5));
      row.push({ photo: p, index: index++, ar });
      arSum += ar;
      if (arSum * opts.target + opts.gap * (row.length - 1) >= width) flush(false);
    }
    flush(true);
  }
  return { blocks, height: y };
}

// ---------- display

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function prettyDate(d: string | null): string {
  if (!d) return 'Undated';
  const [y, m, day] = d.split('-').map(Number);
  if (!m) return String(y);
  return day ? `${day} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}

export function rollMeta(r: RollDTO): string[] {
  return [r.size && (r.sizeInferred ? `${r.size}` : r.size), r.film, r.class].filter(Boolean) as string[];
}
