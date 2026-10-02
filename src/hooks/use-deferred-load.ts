'use client';
import { useEffect } from 'react';
/** Start external acquisition after the commit; discard Strict Mode/unmounted starts. */
export function useDeferredLoad(load: () => unknown) {
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);
}
