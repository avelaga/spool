import { revoke, unlock, unlockPath } from '@/lib/auth.ts';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

/** Exchange the password for an in-memory key. 404 when unlock isn't configured. */
export async function POST(req: Request) {
  if (!unlockPath()) return new Response('Not found', { status: 404 });
  const body = await req.json().catch(() => ({}));
  const key = await unlock(typeof body.password === 'string' ? body.password : '');
  if (!key) return Response.json({ ok: false }, { status: 401, headers });
  return Response.json({ ok: true, key }, { headers });
}

export async function DELETE(req: Request) {
  revoke(req);
  return new Response(null, { status: 204, headers });
}
