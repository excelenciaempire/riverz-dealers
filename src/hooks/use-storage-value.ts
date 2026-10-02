'use client';
import { useCallback, useSyncExternalStore } from 'react';
/** A browser preference with a stable server snapshot avoids hydration drift. */
export function useStorageValue(key: string, fallback: string) {
  const subscribe = useCallback(
    (changed: () => void) => {
      const handler = (event: StorageEvent) => {
        if (event.key === key || event.key === null) changed();
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
    [key]
  );
  const read = useCallback(() => {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }, [key, fallback]);
  return useSyncExternalStore(subscribe, read, () => fallback);
}
