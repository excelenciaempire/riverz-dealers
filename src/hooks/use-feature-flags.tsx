'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isRiverz2, type FeatureFlags } from '@/lib/admin/feature-flags';

interface FeatureFlagsValue {
  flags: FeatureFlags;
  /** El usuario actual es platform admin (ve/accede todo, aunque esté apagado). */
  isPlatformAdmin: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsValue>({
  flags: {},
  isPlatformAdmin: false,
});

export function FeatureFlagsProvider({
  value,
  children,
}: {
  value: FeatureFlagsValue;
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<{ source: FeatureFlags; value: FeatureFlagsValue } | null>(null);
  const current = snapshot?.source === value.flags ? snapshot.value : value;
  const pathname = usePathname();

  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const response = await fetch('/api/workspace/feature-flags', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const next = await response.json() as FeatureFlagsValue;
        if (active) setSnapshot({ source: value.flags, value: next });
      } catch {
        // Preserve known settings when offline or while the server is unavailable.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [pathname, value.flags]);

  return (
    <FeatureFlagsContext.Provider value={current}>{children}</FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags(): FeatureFlagsValue {
  return useContext(FeatureFlagsContext);
}

/**
 * ¿Este comercio usa la experiencia Riverz 2.0 (Operación IA)?
 *
 * A diferencia del resto de los flags, este NO se hereda al equipo de
 * plataforma: un admin no debería ver la experiencia nueva en un comercio que
 * no la tiene prendida, porque lo que se está probando es justamente qué ve el
 * comercio. Se prende por cuenta desde /admin/comercios/[id].
 */
export function useRiverz2(): boolean {
  return isRiverz2(useContext(FeatureFlagsContext).flags);
}
