/**
 * Dry run: parse the archive and write a human-readable review of every roll.
 * Reads the archive only; writes to SPOOL_DATA (./data) only.
 *
 *   npm run review
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import config from '../spool.config.ts';
import { scanArchive } from '../src/lib/archive/scan.ts';
import { formatDate } from '../src/lib/archive/parse.ts';
import type { Roll } from '../src/lib/archive/types.ts';

const dataDir = resolve(config.dataDir);
const archive = resolve(config.archiveRoot);
if (!relative(archive, dataDir).startsWith('..')) {
  throw new Error(`dataDir (${dataDir}) must be outside the archive (${archive})`);
}

const t0 = Date.now();
const { rolls, ignored, unhandled } = await scanArchive(config);
const photos = rolls.reduce((n, r) => n + r.photos.length, 0);

const cell = (s: string | number | null | undefined) => String(s ?? '').replace(/\|/g, '\\|') || '·';
const sizeCell = (r: Roll) => (r.size ? (r.sizeFrom === 'inferred' ? `~${r.size}` : r.size) : '**?**');
const sources = (r: Roll) => {
  const s = [...new Set(r.photos.map((p) => p.source))].filter(Boolean);
  return s.length ? `from: ${s.join(', ')}` : '';
};

const count = <K extends string>(key: (r: Roll) => K | null) => {
  const m = new Map<string, number>();
  for (const r of rolls) {
    const k = key(r) ?? '(none)';
    m.set(k, (m.get(k) ?? 0) + r.photos.length);
  }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
};

const flagged = rolls.filter((r) => r.flags.length);
const lines: string[] = [
  '# Spool — parse review',
  '',
  `${rolls.length} rolls · ${photos} photos · ${rolls.filter((r) => r.photos.some((p) => p.select)).length} rolls with selects · scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  '',
  `- **Size:** ${count((r) => r.size)}`,
  `- **Type:** ${count((r) => r.class)}`,
  `- **Film:** ${count((r) => r.film)}`,
  `- **Tone:** ${count((r) => r.tone)}`,
  '',
  `Photo counts per value. \`~\` = size inferred from image shape + frame count. Fix anything wrong in \`overrides\` in spool.config.ts.`,
  '',
  `## Needs a look (${flagged.length})`,
  '',
  '| Roll | Date | Size | Type | Film | Photos | Notes |',
  '|---|---|---|---|---|---|---|',
  ...flagged.map(
    (r) =>
      `| \`${cell(r.path)}\` | ${formatDate(r.date)} | ${sizeCell(r)} | ${cell(r.class)} | ${cell(r.film)} | ${r.photos.length} | ${cell(r.flags.join('; '))} |`,
  ),
  '',
  '## All rolls',
];

const byCollection = new Map<string, Roll[]>();
for (const r of rolls) {
  const k = r.collection ?? '(top level)';
  byCollection.set(k, [...(byCollection.get(k) ?? []), r]);
}
for (const [collection, rs] of byCollection) {
  lines.push(
    '',
    `### ${collection}`,
    '',
    '| Date | Roll | Size | Type | Film | Photos | ★ | Version |',
    '|---|---|---|---|---|---|---|---|',
    ...rs.map(
      (r) =>
        `| ${formatDate(r.date)} | ${cell(r.title)} | ${sizeCell(r)} | ${cell(r.class)} | ${cell(r.film)} | ${r.photos.length} | ${r.photos.filter((p) => p.select).length || ''} | ${cell(sources(r))} |`,
    ),
  );
}
lines.push(
  '',
  '## Skipped top-level entries',
  '',
  `Ignored by config: ${ignored.map((s) => `\`${s}\``).join(', ')}`,
  '',
  `Not a roll or collection: ${unhandled.map((s) => `\`${s}\``).join(', ') || 'none'}`,
  '',
);

await mkdir(dataDir, { recursive: true });
await writeFile(join(dataDir, 'review.md'), lines.join('\n'));
await writeFile(join(dataDir, 'rolls.json'), JSON.stringify(rolls, null, 2));

console.log(`${rolls.length} rolls, ${photos} photos, ${flagged.length} flagged`);
console.log(`→ ${join(dataDir, 'review.md')}`);
