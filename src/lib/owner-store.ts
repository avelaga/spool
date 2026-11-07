/**
 * The private-view key, held ONLY in this module's memory.
 * No cookie, no storage, no URL bar: a refresh or new tab is always the guest view.
 * Plain module (no React) so server-safe modules like view.ts can read it.
 */
const IDLE_MS = 30 * 60_000;

let key: string | null = null;
let lastActivity = 0;
let idleTimer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();

export const getOwnerKey = () => key;

export function subscribeOwner(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

const touch = () => (lastActivity = Date.now());
const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

export function setOwnerKey(k: string) {
  key = k;
  touch();
  for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });
  idleTimer ??= setInterval(() => Date.now() - lastActivity > IDLE_MS && lock(), 30_000);
  subs.forEach((f) => f());
}

/** Back to the guest view. A full navigation also drops every private image from memory. */
export function lock() {
  const k = key;
  key = null;
  if (k) fetch('/api/session', { method: 'DELETE', headers: { 'x-spool-key': k }, keepalive: true }).catch(() => {});
  window.location.assign('/');
}

/** Fetch with the key; anything other than success means the key is gone → lock. */
export async function ownerFetch(url: string, init: RequestInit = {}) {
  if (!key) throw new Error('locked');
  const res = await fetch(url, { ...init, cache: 'no-store', headers: { ...init.headers, 'x-spool-key': key } });
  if (res.status === 404 || res.status === 401) {
    lock();
    throw new Error('locked');
  }
  return res;
}
