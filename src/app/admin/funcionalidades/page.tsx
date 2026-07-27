'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import type { FeatureDef, FeatureFlags } from '@/lib/admin/feature-flags';

export default function AdminFeaturesPage() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/feature-flags', { cache: 'no-store' });
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (res.ok) {
          const j = await res.json();
          setFeatures((j.features ?? []) as FeatureDef[]);
          setFlags((j.flags ?? {}) as FeatureFlags);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = useCallback(
    async (key: string, enabled: boolean) => {
      setSaving(key);
      setFlags((f) => ({ ...f, [key]: enabled })); // optimista
      try {
        const res = await fetchWithCsrf('/api/admin/feature-flags', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, enabled }),
        });
        if (!res.ok) throw new Error('failed');
        toast.success(t('admin.featureSaved'));
      } catch {
        setFlags((f) => ({ ...f, [key]: !enabled })); // revertir
        toast.error(t('admin.featureSaveError'));
      } finally {
        setSaving(null);
      }
    },
    [fetchWithCsrf, t],
  );

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <ShieldAlert className="mt-0.5 size-4 text-amber-600 dark:text-amber-400" />
        <p className="text-amber-700 dark:text-amber-300">{t('admin.forbidden')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('admin.featuresTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.featuresDesc')}</p>
      </div>
      <div className="space-y-2">
        {features.map((f) => (
          <div
            key={f.key}
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{t(f.labelKey)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(f.descKey)}</p>
            </div>
            <Switch
              checked={flags[f.key] !== false}
              disabled={saving === f.key}
              onCheckedChange={(c) => toggle(f.key, c)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
