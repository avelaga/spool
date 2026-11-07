import { getMeta } from '@/lib/db.ts';
import { isIndexing, runIndex } from '@/lib/indexer/run.ts';

export const dynamic = 'force-dynamic';

// Only timestamps and "changed?" leave the server: the index stats count private photos too.
const lastAt = () => {
  const last = getMeta('lastIndex');
  return last ? (JSON.parse(last).at as number) : null;
};

export function GET() {
  return Response.json({ running: isIndexing(), lastAt: lastAt() });
}

export async function POST() {
  try {
    const s = await runIndex((m) => console.log(`[spool] ${m}`));
    return Response.json({ ok: true, changed: s.added + s.updated + s.removed > 0, lastAt: lastAt() });
  } catch (e) {
    console.error(`[spool] rescan failed: ${(e as Error).message}`);
    return Response.json({ ok: false }, { status: 500 });
  }
}
