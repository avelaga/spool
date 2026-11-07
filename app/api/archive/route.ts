import { isOwner } from '@/lib/auth.ts';
import { privacyStatus } from '@/lib/privacy-backup.ts';
import { getArchive, getRollNeighbors } from '@/lib/queries.ts';

export const dynamic = 'force-dynamic';

/** Private view data. Indistinguishable from a missing route without a live key. */
export function GET(req: Request) {
  if (!isOwner(req)) return new Response('Not found', { status: 404 });
  const roll = Number(new URL(req.url).searchParams.get('roll')) || undefined;
  const owner = { owner: true };
  const data = getArchive(roll, owner);
  const neighbors = roll ? getRollNeighbors(roll, owner) : null;
  const { lockdown, reason } = privacyStatus();
  return Response.json({ ...data, neighbors, lockdown: lockdown ? reason : null }, { headers: { 'Cache-Control': 'no-store' } });
}
