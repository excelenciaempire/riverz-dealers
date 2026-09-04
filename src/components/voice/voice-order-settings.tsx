'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2, Save, ShoppingBag, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DropiCard } from '@/components/settings/dropi-card';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import type { VoiceConnectionConfig } from '@/types';

type OrderConfig = Pick<VoiceConnectionConfig, 'order_writeback'>;

const EMPTY: OrderConfig = {
  order_writeback: { enabled: false },
};

/** Workspace integration only; agent behavior stays inside each voice profile. */
export function VoiceOrderSettings({ workspaceId }: { workspaceId?: string }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<OrderConfig>(EMPTY);
  const [saved, setSaved] = useState<OrderConfig>(EMPTY);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/voice/connection?workspace_id=${workspaceId}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return;
      const json = (await response.json()) as {
        config?: VoiceConnectionConfig;
      };
      const next: OrderConfig = {
        order_writeback: json.config?.order_writeback ?? { enabled: false },
      };
      setConfig(next);
      setSaved(next);
      if (next.order_writeback?.enabled) setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!workspaceId || saving) return;
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/voice/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, config }),
      });
      if (!response.ok) {
        toast.error(t('voice.callFailed'));
        return;
      }
      setSaved(config);
      toast.success(t('voice.saved'));
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setSaving(false);
    }
  }

  const writeback = config.order_writeback ?? { enabled: false };
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const patchWriteback = (patch: Record<string, unknown>) =>
    setConfig((current) => ({
      ...current,
      order_writeback: { ...current.order_writeback, ...patch },
    }));

  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="hover:bg-muted/20 flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ShoppingBag className="size-4" />
          </span>
          <span>
            <span className="text-foreground block text-sm font-semibold">
              {t('voice.orderIntegrationTitle')}
            </span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {t('voice.orderIntegrationHint')}
            </span>
          </span>
        </span>
        {loading ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : (
          <ChevronDown
            className={`text-muted-foreground size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && !loading && (
        <div className="border-border space-y-3 border-t p-4 sm:p-5">
          <div className="border-border overflow-hidden rounded-xl border">
            <label className="flex cursor-pointer items-start justify-between gap-4 p-3.5">
              <span className="flex min-w-0 gap-2.5">
                <Tags className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="text-foreground block text-sm font-medium">
                    {t('voice.orderWriteback')}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">
                    {t('voice.orderWritebackHint')}
                  </span>
                </span>
              </span>
              <Switch
                checked={writeback.enabled === true}
                onCheckedChange={(checked) =>
                  patchWriteback({
                    enabled: checked,
                    ...(checked && !writeback.confirmed_tag
                      ? { confirmed_tag: t('voice.outcomeConfirmed') }
                      : {}),
                    ...(checked && !writeback.cancelled_tag
                      ? { cancelled_tag: t('voice.outcomeCancelled') }
                      : {}),
                  })
                }
              />
            </label>

            {writeback.enabled && (
              <div className="border-border bg-muted/15 grid gap-3 border-t p-3.5 sm:grid-cols-2">
                <label>
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    {t('voice.confirmedTag')}
                  </span>
                  <Input
                    name="voice_shopify_confirmed_tag"
                    autoComplete="off"
                    value={writeback.confirmed_tag ?? ''}
                    onChange={(event) =>
                      patchWriteback({ confirmed_tag: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span className="text-muted-foreground mb-1 block text-xs font-medium">
                    {t('voice.cancelledTag')}
                  </span>
                  <Input
                    name="voice_shopify_cancelled_tag"
                    autoComplete="off"
                    value={writeback.cancelled_tag ?? ''}
                    onChange={(event) =>
                      patchWriteback({ cancelled_tag: event.target.value })
                    }
                  />
                </label>
              </div>
            )}
          </div>

          <DropiCard />

          {dirty && (
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="mr-1 size-3.5" />
                )}
                {t('voice.save')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
