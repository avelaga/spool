export type Size = '35mm' | '645' | '6x6' | '6x7' | '6x9' | '4x5';

export interface KeywordRule<T extends string = string> {
  value: T;
  match: RegExp[];
}

export interface FilmRule extends KeywordRule {
  bw?: boolean;
}

export interface ClassRule extends KeywordRule {
  /** Sizes that imply this class (e.g. 645 → Medium format). */
  sizes?: Size[];
}

export type VariantRole = 'show' | 'hide' | 'select';

export interface VariantRule {
  /** Tested against the subfolder path inside the roll, lowercased. */
  match: RegExp;
  role: VariantRole;
  /** For role 'show': higher wins when the same frame exists in several folders. Top level is 1. */
  rank?: number;
  /** For role 'show': when this folder has JPEGs, it is the roll's photo set — other folders are ignored. */
  replaces?: boolean;
}

export interface RollOverride {
  ignore?: boolean;
  /** 'YYYY-MM-DD', 'YYYY-MM' or 'YYYY' */
  date?: string;
  title?: string;
  size?: Size | null;
  class?: string | null;
  film?: string | null;
}

export interface SpoolConfig {
  archiveRoot: string;
  dataDir: string;
  /** Top-level archive entries to skip entirely (matched on trimmed name). */
  ignore: string[];
  /** Top-level folders that group rolls (years, seasons, Photoshoots…). */
  collections: RegExp[];
  sizes: KeywordRule<Size>[];
  classes: ClassRule[];
  films: FilmRule[];
  bwKeywords: RegExp[];
  variants: VariantRule[];
  /** Keyed by roll path relative to archiveRoot, exactly as on disk. */
  overrides: Record<string, RollOverride>;
}

export interface RollDate {
  year: number;
  month?: number;
  day?: number;
  /** How the date was derived when not a clean YY.M.D prefix. */
  guessed?: 'mdy' | 'collection';
}

export interface Photo {
  /** Path relative to archiveRoot. */
  path: string;
  frameKey: string;
  /** Subfolder (inside the roll) this version came from; '' = top level. */
  source: string;
  select: boolean;
  width?: number;
  height?: number;
}

export interface Roll {
  /** Path relative to archiveRoot — the roll's stable identity. */
  path: string;
  collection: string | null;
  title: string;
  date: RollDate | null;
  size: Size | null;
  sizeFrom: 'name' | 'inferred' | 'override' | null;
  class: string | null;
  film: string | null;
  tone: 'B&W' | 'Color' | null;
  /** Frames on the roll as best we can tell (raw scan count, else photo count). */
  frameCount: number;
  photos: Photo[];
  flags: string[];
}
