/**
 * Spool config — how folder names become filters.
 *
 * Edit freely, then run `npm run review` to see how every roll parses.
 * Patterns are tested against the lowercased roll title (the part after the date),
 * e.g. "22.9.6 august f3" → "august f3".
 */
import type { SpoolConfig } from './src/lib/archive/types.ts';

const config: SpoolConfig = {
  archiveRoot: process.env.SPOOL_ARCHIVE ?? '/path/to/your/scans',
  dataDir: process.env.SPOOL_DATA ?? './data',

  // Loose top-level folders — skipped for now (see TODO.md).
  ignore: [
    'Instagram',
    'New Hi-Res Scans Feb 2018',
    'Polaroids',
    "Raju tata's wedding",
    'Sidda',
    'all sorts of photo scans',
    'chans pictures',
    'film dev',
    'framed film pics',
    'gabby may 2018',
    'miami vice book',
    "mom's film",
    'moms film 18.11.6',
    'moms film 5.13.18',
    'moms new film',
    'street downtown',
    'thrift store slides',
    'to print',
    'ut provia 3 lightroom export',
  ],

  // Folders whose children are rolls. Dated folders at the top level are rolls too.
  collections: [
    /^\d{4}$/, // 2020, 2021…
    /^(spring|summer|fall|winter)\b/i, // "summer 2018", "fall:winter 2017"
    /^photoshoots$/i,
    /^senior year$/i,
  ],

  // Layer 1 — the actual negative size. First match wins.
  // Brand / casual-camera names imply 35mm.
  sizes: [
    { value: '4x5', match: [/large format/, /\b4x5\b/] },
    { value: '6x9', match: [/\b69\b/, /\b6x9\b/] },
    { value: '6x7', match: [/\b67\b/, /\b6x7\b/] },
    { value: '6x6', match: [/hasselblad/, /\b6x6\b/] },
    { value: '645', match: [/\b645\b/, /bronica/] },
    {
      value: '35mm',
      match: [
        /\b35mm\b/,
        /\bps\b/,
        /point and shoot/,
        /disposable/,
        /\bxa2?\b/,
        /fisheye/,
        /\bf3\b/,
        /\bn90s\b/,
        /canon/,
        /nikon/,
      ],
    },
  ],

  // Layer 2 — what kind of photos these are.
  classes: [
    {
      value: 'Point & shoot',
      match: [/\bps\b/, /point and shoot/, /disposable/, /\bxa2?\b/, /fisheye/],
    },
    {
      value: 'Medium format',
      sizes: ['645', '6x6', '6x7', '6x9'],
      match: [/\b120\b/, /medium format/],
    },
    { value: 'Large format', sizes: ['4x5'], match: [/large format/] },
  ],

  // Film stock. First match wins, so specific entries come before generic ones.
  films: [
    { value: 'Tri-X', bw: true, match: [/tri-?x/] },
    { value: 'Neopan', bw: true, match: [/neopan/] },
    { value: 'Pan F', bw: true, match: [/\bpan ?f\b/] },
    { value: 'Portra 160VC', match: [/160 ?vc/] },
    { value: 'Portra', match: [/portra/] },
    { value: 'Ektar', match: [/ektar/] },
    { value: 'Provia', match: [/provia/] },
    { value: 'Superia', match: [/superia/] },
    { value: 'Ultramax', match: [/ultramax/] },
    { value: 'Agfa', match: [/agfa/] },
    { value: 'CineStill', match: [/cinestill/] },
    { value: 'LomoChrome Purple', match: [/lomo ?purple/] },
    { value: 'Lomo 1600', match: [/lomo[ -]?1600/] },
    { value: 'Lomo 800', match: [/lomo[ -]?800/] },
    { value: 'Lomography', match: [/\blomo\b/] },
  ],
  bwKeywords: [/\bbw\b/, /\bb[:/]w\b/, /self develop bw/],

  // Subfolders inside a roll. Tested in order against the subfolder path (lowercased).
  // show   → candidate version of a frame (highest rank wins; top level = 1)
  // hide   → never shown (TIFs / scans / masters / originals)
  // select → not shown, but marks matching frames as ★ select
  variants: [
    { match: /select|fav|print/, role: 'select' },
    { match: /raw|orig|scan|master|flextight|uncleaned|tiff|first pass|clean|resize/, role: 'hide' },
    { match: /compress|low.?res|for online|digital final/, role: 'show', rank: 3 },
    // replaces: an edited export is the roll's whole set, even if file names differ from the scans
    { match: /edited|color corrected/, role: 'show', rank: 2, replaces: true },
    { match: /less sharpen/, role: 'show', rank: 0.5 },
  ],

  // Per-roll fixes, keyed by path relative to the archive root, e.g.
  // 'fall 2019/19.12.6. | panf': { size: '35mm' },
  overrides: {},
};

export default config;
