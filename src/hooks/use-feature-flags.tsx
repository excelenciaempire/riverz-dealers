'use client';

import { createContext, useContext } from 'react';
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
  return (
    <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>
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
