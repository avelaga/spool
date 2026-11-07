import 'server-only';
import { isOwner } from './auth.ts';
import { privacyStatus } from './privacy-backup.ts';
import { getPhotoFile } from './queries.ts';

/**
 * Shared gate for every image route. Private photos look exactly like missing ones
 * to anyone without a live key, and are never cacheable.
 */
export async function photoForRequest(req: Request, params: Promise<{ id: string }>) {
  const photo = getPhotoFile(Number((await params).id));
  if (!photo) return null;
  // Lockdown (private list looks lost): treat every photo as private.
  const isPrivate = !!photo.isPrivate || privacyStatus().lockdown;
  if (isPrivate && !isOwner(req)) return null;
  return {
    ...photo,
    isPrivate: isPrivate ? 1 : 0,
    cacheControl: isPrivate ? 'no-store' : 'public, max-age=31536000, immutable',
  };
}

export const notFound = () => new Response('Not found', { status: 404 });
