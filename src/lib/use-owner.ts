'use client';

import { useSyncExternalStore } from 'react';
import { getOwnerKey, subscribeOwner } from './owner-store.ts';

/** The private-view key, or null for the guest view (always null on the server). */
export function useOwnerKey(): string | null {
  return useSyncExternalStore(subscribeOwner, getOwnerKey, () => null);
}
