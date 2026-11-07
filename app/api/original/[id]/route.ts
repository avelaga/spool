import { join, basename } from 'node:path';
import { Readable } from 'node:stream';
import config from '../../../../spool.config.ts';
import { streamFile } from '@/lib/archive/fs.ts';
import { notFound, photoForRequest } from '@/lib/photo-access.ts';

/** Streams the original file straight from the archive (read-only). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const photo = await photoForRequest(req, ctx.params);
  if (!photo) return notFound();

  const download = new URL(req.url).searchParams.has('download');
  const stream = streamFile(join(config.archiveRoot, photo.path));
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(photo.bytes),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(basename(photo.path))}`,
      'Cache-Control': photo.isPrivate ? 'no-store' : 'private, max-age=3600',
    },
  });
}
