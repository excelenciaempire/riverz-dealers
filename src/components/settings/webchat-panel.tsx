'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { WebchatConfig } from '@/types';

/**
 * Instalar y configurar el chat de la tienda.
 *
 * El orden de la pantalla es el orden en que le importa al comercio: primero
 * si está encendido y cómo instalarlo —que es lo único obligatorio—, después
 * cómo se ve, y al final qué está produciendo. La apariencia no sirve de nada
 * antes de que el chat cargue.
 */

interface Stats {
  period_days: number;
  conversations: number;
  resolved: number;
  escalated: number;
  orders: number;
  revenue: number;
  currency: string | null;
}

export function WebchatPanel() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cfg, setCfg] = useState<WebchatConfig>({});
  const [snippet, setSnippet] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [domainDraft, setDomainDraft] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [cfgRes, statsRes] = await Promise.all([
          fetch('/api/webchat/config', { cache: 'no-store' }),
          fetch('/api/webchat/stats', { cache: 'no-store' }),
        ]);
        if (cfgRes.ok) {
          const json = await cfgRes.json();
          setCfg(json.config ?? {});
          setSnippet(json.snippet ?? '');
        }
        if (statsRes.ok) setStats(await statsRes.json());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = useCallback(
    async (patch: WebchatConfig) => {
      setSaving(true);
      try {
        const res = await fetchWithCsrf('/api/webchat/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        setCfg(json.config ?? {});
        setSnippet(json.snippet ?? '');
        toast.success(t('webchat.saved'));
      } catch {
        toast.error(t('webchat.saveFailed'));
      } finally {
        setSaving(false);
      }
    },
    [fetchWithCsrf, t],
  );

  const domains = cfg.allowed_domains ?? [];
  const enabled = Boolean(cfg.enabled);

  const addDomain = () => {
    const value = domainDraft.trim();
    if (!value) return;
    setDomainDraft('');
    save({ allowed_domains: [...domains, value] });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Estado + instalación ── */}
      <Card>
        <Row>
          <div>
            <p className="text-sm font-medium text-foreground">{t('webchat.enable')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('webchat.enableHint')}</p>
          </div>
          <Switch checked={enabled} onCheckedChange={(c) => save({ enabled: c })} />
        </Row>

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">{t('webchat.install')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('webchat.installHint')}</p>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed text-foreground">
              {snippet}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="ml-1.5">{copied ? t('webchat.copied') : t('webchat.copy')}</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">{t('webchat.domains')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('webchat.domainsHint')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {domains.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs text-foreground"
              >
                {d}
                <button
                  type="button"
                  aria-label={d}
                  onClick={() =>
                    save({ allowed_domains: domains.filter((x) => x !== d) })
                  }
                  className="text-muted-foreground transition hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          {/* El aviso sólo aparece cuando de verdad rompe algo: encendido y sin
              un solo dominio, el chat no abre en ninguna parte. */}
          {enabled && domains.length === 0 ? (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              {t('webchat.domainsEmpty')}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Input
              value={domainDraft}
              placeholder={t('webchat.domainPlaceholder')}
              onChange={(e) => setDomainDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addDomain();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addDomain} disabled={saving}>
              {t('webchat.domainAdd')}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── Apariencia ── */}
      <Card title={t('webchat.appearance')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('webchat.color')}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={cfg.primary_color ?? '#A3E635'}
                onChange={(e) => setCfg({ ...cfg, primary_color: e.target.value })}
                onBlur={(e) => save({ primary_color: e.target.value })}
                className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-transparent"
              />
              <span className="text-xs text-muted-foreground">{cfg.primary_color}</span>
            </div>
          </Field>

          <Field label={t('webchat.position')}>
            <div className="flex gap-2">
              {(['right', 'left'] as const).map((side) => (
                <Button
                  key={side}
                  type="button"
                  size="sm"
                  variant={(cfg.position ?? 'right') === side ? 'default' : 'outline'}
                  onClick={() => save({ position: side })}
                >
                  {side === 'right' ? t('webchat.positionRight') : t('webchat.positionLeft')}
                </Button>
              ))}
            </div>
          </Field>

          <Field label={t('webchat.brandName')}>
            <Input
              value={cfg.brand_name ?? ''}
              onChange={(e) => setCfg({ ...cfg, brand_name: e.target.value })}
              onBlur={(e) => save({ brand_name: e.target.value })}
            />
          </Field>

          <Field label={t('webchat.avatar')}>
            <Input
              value={cfg.avatar_url ?? ''}
              placeholder={t('webchat.avatarPlaceholder')}
              onChange={(e) => setCfg({ ...cfg, avatar_url: e.target.value })}
              onBlur={(e) => save({ avatar_url: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label={t('webchat.greeting')}>
            <Input
              value={cfg.greeting ?? ''}
              placeholder={t('webchat.greetingPlaceholder')}
              onChange={(e) => setCfg({ ...cfg, greeting: e.target.value })}
              onBlur={(e) => save({ greeting: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      {/* ── Comportamiento ── */}
      <Card title={t('webchat.behavior')}>
        <Row>
          <div>
            <p className="text-sm font-medium text-foreground">{t('webchat.requireEmail')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('webchat.requireEmailHint')}</p>
          </div>
          <Switch
            checked={Boolean(cfg.require_email)}
            onCheckedChange={(c) => save({ require_email: c })}
          />
        </Row>
      </Card>

      {/* ── Resultados ── */}
      <Card title={t('webchat.results')} subtitle={t('webchat.period')}>
        {stats && stats.conversations > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t('webchat.conversations')} value={String(stats.conversations)} />
            <Stat label={t('webchat.resolvedByAi')} value={String(stats.resolved)} />
            <Stat label={t('webchat.ordersAttributed')} value={String(stats.orders)} />
            <Stat
              label={t('webchat.revenue')}
              value={
                stats.currency
                  ? format.currency(stats.revenue, stats.currency)
                  : String(Math.round(stats.revenue))
              }
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('webchat.resultsEmpty')}</p>
        )}
      </Card>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      {title ? (
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-start justify-between gap-4">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
