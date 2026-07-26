'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { ServiceHealth, SvcStatus, SvcCategory } from '@/lib/admin/infrastructure';

/**
 * Platform-admin only: panel de infraestructura EN VIVO — saldo + estado de
 * todas las APIs y servicios conectados (no solo voz). Auto-refresca.
 * Acceso por URL: /admin/infra.
 */
const STATUS_KEY: Record<SvcStatus, string> = {
  ok: 'admin.infraStatusOk',
  low: 'admin.infraStatusLow',
  empty: 'admin.infraStatusEmpty',
  error: 'admin.infraStatusError',
  not_connected: 'admin.infraStatusNotConnected',
};

const DOT: Record<SvcStatus, string> = {
  ok: 'bg-emerald-500',
  low: 'bg-amber-500',
  empty: 'bg-red-500',
  error: 'bg-red-500',
  not_connected: 'bg-muted-foreground/40',
};

const CAT_ORDER: SvcCategory[] = ['llm', 'voice', 'infra', 'messaging'];
const CAT_KEY: Record<SvcCategory, string> = {
  llm: 'admin.infraCatLlm',
  voice: 'admin.infraCatVoice',
  infra: 'admin.infraCatInfra',
  messaging: 'admin.infraCatMessaging',
};

const REFRESH_MS = 60_000;

export default function AdminInfraPage() {
  const t = useT();
  const format = useFormat();
  const [services, setServices] = useState<ServiceHealth[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/infrastructure', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await res.json();
      if (res.ok) {
        setServices(json.services as ServiceHealth[]);
        setCheckedAt(json.checkedAt as string);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (forbidden) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <ShieldAlert className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">403</p>
      </div>
    );
  }

  const fmtBalance = (s: ServiceHealth): string | null => {
    if (s.balance == null) return null;
    if (s.unit === 'USD') return `$${s.balance.toFixed(2)}`;
    if (s.unit === 'chars') return `${format.number(s.balance)} chars`;
    return `${format.number(s.balance)}${s.unit ? ` ${s.unit}` : ''}`;
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('admin.infraTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.infraDesc')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('admin.infraRefresh')}
        </Button>
      </div>

      {loading && !services ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('admin.infraLoading')}
        </div>
      ) : (
        <div className="space-y-6">
          {CAT_ORDER.map((cat) => {
            const items = (services ?? []).filter((s) => s.category === cat);
            if (!items.length) return null;
            return (
              <section key={cat}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(CAT_KEY[cat])}
                </h2>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {items.map((s) => {
                    const bal = fmtBalance(s);
                    return (
                      <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status]}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                          {s.detail && (
                            <p className="truncate text-xs text-muted-foreground">{s.detail}</p>
                          )}
                        </div>
                        <div className="text-right">
                          {bal && <p className="text-sm font-semibold tabular-nums text-foreground">{bal}</p>}
                          <p className="text-xs text-muted-foreground">{t(STATUS_KEY[s.status])}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {checkedAt && (
        <p className="mt-6 text-right text-xs text-muted-foreground">
          {t('admin.infraLastCheck')}: {format.dateTime(new Date(checkedAt))}
        </p>
      )}
    </div>
  );
}
