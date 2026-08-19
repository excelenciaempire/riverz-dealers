'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import type { FeatureDef, FeatureFlags } from '@/lib/admin/feature-flags';
import { Switch } from '@/components/ui/switch';
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
} from '../_components/admin-ui';
import { RefreshButton } from '../_components/filters';

interface Payload {
  features: FeatureDef[];
  /** Experiencias nuevas: acá la ausencia de fila significa "apagada". */
  optInFeatures: FeatureDef[];
  flags: FeatureFlags;
}

/**
 * Prender y apagar funcionalidades para toda la plataforma.
 *
 * Sin refresco automático: los interruptores se mueven de forma optimista y una
 * recarga de fondo a mitad de camino los haría saltar solos. Además esto es
 * configuración — no cambia si no la cambia alguien del equipo.
 */
export default function AdminFeaturesPage() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const { data, loading, error, reload, setData } = useAdminData<Payload>(
    '/api/admin/feature-flags',
    0,
  );
  const [saving, setSaving] = useState<string | null>(null);

  const toggle = useCallback(
    async (key: string, enabled: boolean) => {
      setSaving(key);
      setData((d) => (d ? { ...d, flags: { ...d.flags, [key]: enabled } } : d));
      try {
        const res = await fetchWithCsrf('/api/admin/feature-flags', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, enabled }),
        });
        if (!res.ok) throw new Error('failed');
        toast.success(t('admin.featureSaved'));
      } catch {
        setData((d) => (d ? { ...d, flags: { ...d.flags, [key]: !enabled } } : d));
        toast.error(t('admin.featureSaveError'));
      } finally {
        setSaving(null);
      }
    },
    [fetchWithCsrf, setData, t],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('admin.featuresTitle')}
        description={t('admin.featuresDesc')}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <LoadError onRetry={reload} />
      ) : (
        <>
          <Panel>
            <ul className="divide-y divide-border">
              {data.features.map((f) => (
                <li
                  key={f.key}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{t(f.labelKey)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t(f.descKey)}</p>
                  </div>
                  <Switch
                    checked={data.flags[f.key] !== false}
                    disabled={saving === f.key}
                    onCheckedChange={(c) => toggle(f.key, c)}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          {/* Experiencias: mismo interruptor, regla inversa. Prender esto acá
              la enciende para TODA la base; lo normal es dejarlo apagado y
              prenderlo comercio por comercio desde su ficha. */}
          {data.optInFeatures.length > 0 && (
            <Panel title={t('admin.experiencesTitle')}>
              <p className="px-4 pt-3 text-xs text-muted-foreground">
                {t('admin.experiencesDesc')}
              </p>
              <ul className="mt-1 divide-y divide-border">
                {data.optInFeatures.map((f) => (
                  <li
                    key={f.key}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t(f.labelKey)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(f.descKey)}
                      </p>
                    </div>
                    <Switch
                      checked={data.flags[f.key] === true}
                      disabled={saving === f.key}
                      onCheckedChange={(c) => toggle(f.key, c)}
                    />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
