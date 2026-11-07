'use client';

/**
 * Grid density — a per-device viewing preference (localStorage; falls back to default if unavailable).
 * 0 = compact, 1 = default, 2 = large.
 */
import { useSyncExternalStore } from 'react';

export type Density = 0 | 1 | 2;
export const DENSITY_LABELS = ['Compact', 'Default', 'Large'] as const;
/** Row height multiplier per density (desktop ≈ 7 / 4 / 3 per row). */
export const DENSITY_SCALE = [0.58, 1, 1.55] as const;
/** Phones need bigger steps to change the photos per row (≈ 4 / 2 / 1). */
export const DENSITY_SCALE_SMALL = [0.48, 1, 1.85] as const;

const KEY = 'spool:density';
const EVENT = 'spool:density';

function read(): Density {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v === 0 || v === 2 ? v : 1;
  } catch {
    return 1;
  }
}

export function setDensity(d: Density) {
  try {
    localStorage.setItem(KEY, String(d));
  } catch {
    // private mode etc. — still apply for this page
  }
  current = d;
  window.dispatchEvent(new Event(EVENT));
}

let current: Density | null = null;

function subscribe(fn: () => void) {
  const onChange = () => {
    current = read();
    fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', onChange);
  };
}

export function useDensity(): Density {
  return useSyncExternalStore(
    subscribe,
    () => (current ??= read()),
    () => 1,
  );
}
