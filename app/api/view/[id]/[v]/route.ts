import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import config from '../../../../../spool.config.ts';
import { readWhole } from '@/lib/archive/fs.ts';
import { cachePath, viewDir } from '@/lib/db.ts';
import { notFound, photoForRequest } from '@/lib/photo-access.ts';

const VIEW_EDGE = 2560;
const inflight = new Map<string, Promise<Uint8Array>>();

/** Viewer-size image, generated on first request and cached in SPOOL_DATA. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const photo = await photoForRequest(req, ctx.params);
  if (!photo) return notFound();

  const out = cachePath(viewDir, photo.hash);
  let buf: Uint8Array | null = await readFile(out).catch(() => null);
  if (!buf) {
    let job = inflight.get(photo.hash);
    if (!job) {
      job = (async () => {
        const src = await readWhole(join(config.archiveRoot, photo.path));
        const b = await sharp(src, { failOn: 'none' })
          .rotate()
          .resize({ width: VIEW_EDGE, height: VIEW_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 84 })
          .toBuffer();
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, b);
        return new Uint8Array(b);
      })().finally(() => inflight.delete(photo.hash));
      inflight.set(photo.hash, job);
    }
    buf = await job;
  }
  return new Response(buf as Uint8Array<ArrayBuffer>, {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': photo.cacheControl },
  });
}
