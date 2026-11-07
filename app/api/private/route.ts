import { isOwner } from '@/lib/auth.ts';
import { setPhotosPrivate, setRollPrivate } from '@/lib/privacy.ts';

export const dynamic = 'force-dynamic';

/** { photoIds: number[], private: boolean } or { rollId: number, private: boolean } */
export async function POST(req: Request) {
  if (!isOwner(req)) return new Response('Not found', { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.private !== 'boolean') return new Response('Bad request', { status: 400 });

  if (Array.isArray(body.photoIds)) {
    setPhotosPrivate(body.photoIds.map(Number).filter(Number.isInteger), body.private);
  } else if (Number.isInteger(body.rollId)) {
    setRollPrivate(body.rollId, body.private);
  } else {
    return new Response('Bad request', { status: 400 });
  }
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
