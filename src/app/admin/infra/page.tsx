'use client';

import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { ServiceHealth, SvcStatus, SvcCategory } from '@/lib/admin/infrastructure';
import {
  useAdminData,
  PageHeader,
  Panel,
  Loading,
  LoadError,
  StatusPill,
  Muted,
  type Tone,
} from '../_components/admin-ui';
import { RefreshButton } from '../_components/filters';

/**
 * Estado y saldo en vivo de todo lo conectado (LLMs, voz/telefonía, infra).
 *
 * Usa las mismas piezas que las otras once pantallas. Antes traía su propio
 * contenedor, su propio botón, su propio `setInterval` y su propio 403: era la
 * única que se refrescaba sola y, a la vez, la única que ante un fallo de red se
 * quedaba girando sin decir nada.
 *
 * El refresco lo maneja `useAdminData`, que se pausa cuando la pestaña no está
 * a la vista. Importa más acá que en el resto: cada ronda de sondas dispara
 * completions FACTURABLES a Anthropic, OpenAI, Groq y Cerebras, y una pestaña
 * olvidada toda la tarde eran cientos de llamadas pagas para mirar el mismo
 * número. Del lado del servidor hay además una caché de 55 s.
 */
const TONE: Record<SvcStatus, Tone> = {
  ok: 'ok',
  low: 'warn',
  empty: 'error',
  error: 'error',
  not_connected: 'muted',
};

const STATUS_KEY: Record<SvcStatus, string> = {
  ok: 'admin.infraStatusOk',
  low: 'admin.infraStatusLow',
  empty: 'admin.infraStatusEmpty',
  error: 'admin.infraStatusError',
  not_connected: 'admin.infraStatusNotConnected',
};

const CAT_ORDER: SvcCategory[] = ['llm', 'voice', 'messaging', 'infra'];
const CAT_KEY: Record<SvcCategory, string> = {
  llm: 'admin.infraCatLlm',
  voice: 'admin.infraCatVoice',
  infra: 'admin.infraCatInfra',
  messaging: 'admin.infraCatMessaging',
};

export default function AdminInfraPage() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload, live } = useAdminData<{
    services: ServiceHealth[];
    checkedAt: string;
  }>('/api/admin/infrastructure');

  const fmtBalance = (s: ServiceHealth): string | null => {
    if (s.balance == null) return null;
    if (s.unit === 'USD') return `$${s.balance.toFixed(2)}`;
    if (s.unit === 'chars') return `${format.number(s.balance)} chars`;
    return `${format.number(s.balance)}${s.unit ? ` ${s.unit}` : ''}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        live={live}
        title={t('admin.infraTitle')}
        description={t('admin.infraDesc')}
        actions={<RefreshButton onClick={reload} />}
      />

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <LoadError onRetry={reload} />
      ) : (
        <div className="space-y-4">
          {CAT_ORDER.map((cat) => {
            const items = data.services.filter((s) => s.category === cat);
            if (!items.length) return null;
            return (
              <Panel key={cat} title={t(CAT_KEY[cat])}>
                <ul className="divide-y divide-border">
                  {items.map((s) => {
                    const bal = fmtBalance(s);
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {s.name}
                          </p>
                          {/* El detalle llega como clave i18n: antes venía en
                              español fijo desde el servidor y se pintaba crudo,
                              contra el propio contrato del módulo. */}
                          {s.detailKey && <Muted>{t(s.detailKey)}</Muted>}
                        </div>
                        <div className="shrink-0 text-right">
                          {bal && (
                            <p className="text-sm font-semibold tabular-nums text-foreground">
                              {bal}
                            </p>
                          )}
                          <StatusPill tone={TONE[s.status]} label={t(STATUS_KEY[s.status])} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            );
          })}

          <p className="text-right text-xs text-muted-foreground">
            {t('admin.infraLastCheck')}: {format.dateTime(data.checkedAt)}
          </p>
        </div>
      )}
    </div>
  );
}
