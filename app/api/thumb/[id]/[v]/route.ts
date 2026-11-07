import { readFile } from 'node:fs/promises';
import { cachePath, thumbDir } from '@/lib/db.ts';
import { notFound, photoForRequest } from '@/lib/photo-access.ts';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const photo = await photoForRequest(req, ctx.params);
  if (!photo) return notFound();
  try {
    const buf = await readFile(cachePath(thumbDir, photo.hash));
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': photo.cacheControl },
    });
  } catch {
    return notFound();
  }
}
