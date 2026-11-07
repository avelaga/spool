/**
 * The ONLY module that touches the photo archive.
 *
 * Read-only by construction: it exposes directory listing, stat, and reads
 * opened with O_RDONLY. Nothing here can create, write, rename or delete.
 * Do not add write helpers to this file — caches/DB live in SPOOL_DATA.
 */
import { opendir, stat, open } from 'node:fs/promises';
import { constants, createReadStream, type Dirent, type ReadStream, type Stats } from 'node:fs';

/** Whole file into memory (for hashing + thumbnailing). */
export async function readWhole(path: string): Promise<Buffer> {
  const fh = await open(path, constants.O_RDONLY);
  try {
    return await fh.readFile();
  } finally {
    await fh.close();
  }
}

/** Stream a file out (serving originals). */
export function streamFile(path: string, range?: { start: number; end: number }): ReadStream {
  return createReadStream(path, { flags: 'r', ...range });
}

export async function listDir(dir: string): Promise<Dirent[]> {
  const out: Dirent[] = [];
  for await (const entry of await opendir(dir)) out.push(entry);
  return out;
}

export function statPath(path: string): Promise<Stats> {
  return stat(path);
}

/** Read up to `bytes` from the start of a file. */
export async function readHead(path: string, bytes: number): Promise<Buffer> {
  const fh = await open(path, constants.O_RDONLY);
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Junk the OS leaves around: AppleDouble `._x`, .DS_Store, Spotlight, etc. */
export function isHidden(name: string): boolean {
  return name.startsWith('.');
}
