/**
 * Private view unlock. Deliberately forgetful:
 *  - keys live only in this process's memory (a restart locks everything)
 *  - a key expires after IDLE_MS without use
 *  - the browser keeps the key only in JS memory, so any refresh locks too
 * Unlock is disabled entirely unless SPOOL_PASSWORD and SPOOL_UNLOCK_PATH are both set.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const IDLE_MS = 30 * 60_000;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60_000;

const g = globalThis as unknown as {
  __spoolKeys?: Map<string, number>;
  __spoolFails?: number[];
};
const keys = (g.__spoolKeys ??= new Map());
const fails = (g.__spoolFails ??= []);

export function unlockPath(): string | null {
  const path = process.env.SPOOL_UNLOCK_PATH?.trim();
  return path && process.env.SPOOL_PASSWORD ? path : null;
}

const sha = (s: string) => createHash('sha256').update(s).digest();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns a new key, or null. Wrong guesses are slow, and lock out for a while after a few. */
export async function unlock(password: string): Promise<string | null> {
  const expected = process.env.SPOOL_PASSWORD;
  if (!unlockPath() || !expected) return null;

  const now = Date.now();
  while (fails.length && now - fails[0] > FAIL_WINDOW_MS) fails.shift();
  const lockedOut = fails.length >= MAX_FAILS;
  const ok = !lockedOut && timingSafeEqual(sha(password), sha(expected));

  if (!ok) {
    if (!lockedOut) fails.push(now);
    await sleep(1500);
    return null;
  }
  fails.length = 0;
  const key = randomBytes(32).toString('base64url');
  keys.set(key, now);
  return key;
}

/** True if the request carries a live key (header, or ?k= for <img> URLs). Refreshes its idle timer. */
export function isOwner(req: Request): boolean {
  const key = req.headers.get('x-spool-key') ?? new URL(req.url).searchParams.get('k');
  if (!key) return false;
  const last = keys.get(key);
  if (last === undefined) return false;
  if (Date.now() - last > IDLE_MS) {
    keys.delete(key);
    return false;
  }
  keys.set(key, Date.now());
  return true;
}

export function revoke(req: Request) {
  const key = req.headers.get('x-spool-key');
  if (key) keys.delete(key);
}
