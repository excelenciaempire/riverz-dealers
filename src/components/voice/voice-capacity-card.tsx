'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Activity,
  Gauge,
  Loader2,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';

type CapacityConfig = {
  max_concurrent_calls: number;
  reserved_inbound_slots: number;
  max_campaign_concurrent: number;
  dedupe_minutes: number;
};

type CapacityState = {
  config: CapacityConfig;
  active: number;
  inbound_active: number;
  outbound_active: number;
  campaign_active: number;
  queued: number;
};

const EMPTY: CapacityState = {
  config: {
    max_concurrent_calls: 3,
    reserved_inbound_slots: 0,
    max_campaign_concurrent: 1,
    dedupe_minutes: 15,
  },
  active: 0,
  inbound_active: 0,
  outbound_active: 0,
  campaign_active: 0,
  queued: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value) || min));
}

export function VoiceCapacityCard({ workspaceId }: { workspaceId?: string }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [state, setState] = useState<CapacityState>(EMPTY);
  const [draft, setDraft] = useState<CapacityConfig>(EMPTY.config);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!workspaceId) {
        setLoading(false);
        return;
      }
      if (!quiet) setLoading(true);
      try {
        const response = await fetch(
          `/api/voice/capacity?workspace_id=${workspaceId}`,
          { cache: 'no-store' }
        );
        if (!response.ok) return;
        const next = (await response.json()) as CapacityState;
        setState(next);
        if (!open) setDraft(next.config);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [open, workspaceId]
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const normalizedDraft = useMemo(() => {
    const max = clamp(draft.max_concurrent_calls, 1, 50);
    return {
      max_concurrent_calls: max,
      reserved_inbound_slots: clamp(
        draft.reserved_inbound_slots,
        0,
        Math.max(0, max - 1)
      ),
      max_campaign_concurrent: clamp(draft.max_campaign_concurrent, 1, max),
      dedupe_minutes: clamp(draft.dedupe_minutes, 0, 1440),
    };
  }, [draft]);

  async function save() {
    if (!workspaceId || saving) return;
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/voice/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          config: normalizedDraft,
        }),
      });
      if (!response.ok) {
        toast.error(t('voice.capacitySaveFailed'));
        return;
      }
      setOpen(false);
      await load();
      toast.success(t('voice.capacitySaved'));
    } finally {
      setSaving(false);
    }
  }

  const max = state.config.max_concurrent_calls;
  const usedPercent = Math.min(100, Math.round((state.active / max) * 100));

  return (
    <>
      <section className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
        <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Gauge className="size-4" />
            </span>
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                {t('voice.capacityTitle')}
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('voice.capacityHint')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(state.config);
              setOpen(true);
            }}
            disabled={loading}
          >
            {t('voice.configure')}
          </Button>
        </div>

        <div className="border-border/70 grid border-t sm:grid-cols-[1.35fr_1fr_1fr]">
          <Metric
            icon={Activity}
            label={t('voice.capacityInProgress')}
            value={loading ? '—' : `${state.active} / ${max}`}
            detail={
              <>
                <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-[width]"
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>
                {!loading && state.active > 0 && (
                  <p className="text-muted-foreground mt-1.5 text-[10px]">
                    {t('voice.capacityActiveMix', {
                      inbound: String(state.inbound_active),
                      outbound: String(state.outbound_active),
                    })}
                  </p>
                )}
              </>
            }
          />
          <Metric
            icon={UsersRound}
            label={t('voice.capacityQueued')}
            value={loading ? '—' : String(state.queued)}
          />
          <Metric
            icon={ShieldCheck}
            label={t('voice.capacityInboundReserve')}
            value={
              loading
                ? '—'
                : state.config.reserved_inbound_slots > 0
                  ? String(state.config.reserved_inbound_slots)
                  : t('voice.capacityReserveOff')
            }
          />
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('voice.capacityDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('voice.capacityDialogHint')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <CapacityField
              title={t('voice.capacityMaxTitle')}
              description={t('voice.capacityMaxHint')}
            >
              <Input
                type="number"
                min={1}
                max={50}
                value={draft.max_concurrent_calls}
                onChange={(event) => {
                  const max = Number(event.target.value);
                  setDraft((current) => ({
                    ...current,
                    max_concurrent_calls: max,
                    reserved_inbound_slots: Math.min(
                      current.reserved_inbound_slots,
                      Math.max(0, max - 1)
                    ),
                    max_campaign_concurrent: Math.min(
                      current.max_campaign_concurrent,
                      Math.max(1, max)
                    ),
                  }));
                }}
                className="w-20 text-center"
              />
            </CapacityField>

            <CapacityField
              title={t('voice.capacityReserveTitle')}
              description={t('voice.capacityReserveHint')}
            >
              <div className="flex items-center gap-2">
                {draft.reserved_inbound_slots > 0 && (
                  <Input
                    type="number"
                    min={1}
                    max={Math.max(1, normalizedDraft.max_concurrent_calls - 1)}
                    value={draft.reserved_inbound_slots}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        reserved_inbound_slots: Number(event.target.value),
                      }))
                    }
                    className="w-20 text-center"
                  />
                )}
                <Switch
                  checked={draft.reserved_inbound_slots > 0}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      max_concurrent_calls: checked
                        ? Math.max(2, current.max_concurrent_calls)
                        : current.max_concurrent_calls,
                      reserved_inbound_slots: checked ? 1 : 0,
                    }))
                  }
                />
              </div>
            </CapacityField>

            <CapacityField
              title={t('voice.capacityCampaignTitle')}
              description={t('voice.capacityCampaignHint')}
            >
              <Input
                type="number"
                min={1}
                max={normalizedDraft.max_concurrent_calls}
                value={draft.max_campaign_concurrent}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    max_campaign_concurrent: Number(event.target.value),
                  }))
                }
                className="w-20 text-center"
              />
            </CapacityField>

            <CapacityField
              title={t('voice.capacityDedupeTitle')}
              description={t('voice.capacityDedupeHint')}
            >
              <div className="flex items-center gap-2">
                {draft.dedupe_minutes > 0 && (
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={draft.dedupe_minutes}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          dedupe_minutes: Number(event.target.value),
                        }))
                      }
                      className="w-24 pr-10 text-center"
                    />
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px]">
                      {t('voice.capacityMinutes')}
                    </span>
                  </div>
                )}
                <Switch
                  checked={draft.dedupe_minutes > 0}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      dedupe_minutes: checked ? 15 : 0,
                    }))
                  }
                />
              </div>
            </CapacityField>

            <div className="border-border bg-muted/25 rounded-xl border px-3.5 py-3">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {t('voice.capacityPriority')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {[
                  t('voice.capacityPriorityInbound'),
                  t('voice.capacityPriorityManual'),
                  t('voice.capacityPriorityAutomation'),
                  t('voice.capacityPriorityCampaign'),
                ].map((label, index) => (
                  <span key={label} className="contents">
                    {index > 0 && (
                      <span className="text-muted-foreground">→</span>
                    )}
                    <span className="border-border bg-background rounded-md border px-2 py-1">
                      {label}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              {t('voice.voiceAgentCancel')}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('voice.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail?: ReactNode;
}) {
  return (
    <div className="border-border/70 px-4 py-3.5 sm:border-r sm:last:border-r-0">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
        {value}
      </p>
      {detail}
    </div>
  );
}

function CapacityField({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border flex items-center justify-between gap-4 rounded-xl border p-3.5">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
