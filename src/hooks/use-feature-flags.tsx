'use client';

import { createContext, useContext } from 'react';
import type { FeatureFlags } from '@/lib/admin/feature-flags';

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
