'use client';

import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { WalletMargin } from '@/lib/admin/wallet-margin';
import {
  DataTable,
  Loading,
  LoadError,
  Muted,
  Panel,
  Stat,
  StatusPill,
  useAdminData,
  type Column,
} from '../_components/admin-ui';
import { RefreshButton } from '../_components/filters';

type Response = { margin: WalletMargin };

export function Margen() {
  const t = useT();
  const format = useFormat();
  const { data, loading, error, reload } = useAdminData<Response>(
    '/api/admin/wallet/conciliacion',
    0
  );

  if (loading && !data) return <Loading forma="stats+table" cajas={4} />;
  if (error || !data) return <LoadError onRetry={reload} />;

  const margin = data.margin;
  const usd = (n: number, digits = 4) =>
    format.currency(n, 'USD', {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    });
  const balanced = Math.abs(margin.diferenciaUsd) < 0.0001;
  const oldPending = margin.pendientesVencidas > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {t('admin.cashMarginVariableOnly')}
        </p>
        <RefreshButton onClick={reload} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t('admin.cashMarginCost')}
          value={usd(margin.costoVariableUsd)}
        />
        <Stat
          label={t('admin.cashMarginCharged')}
          value={usd(margin.cobradoUsd)}
        />
        <Stat
          label={t('admin.cashMarginDifference')}
          value={usd(margin.diferenciaUsd)}
          tone={balanced ? 'ok' : margin.diferenciaUsd < 0 ? 'error' : 'warn'}
          hint={
            balanced
              ? t('admin.cashMarginBalanced')
              : t('admin.cashMarginDifferenceHint')
          }
        />
        <Stat
          label={t('admin.cashMarginReserved')}
          value={usd(margin.reservasUsd, 2)}
          tone={oldPending ? 'error' : margin.pendientes ? 'warn' : 'ok'}
          hint={t('admin.cashMarginPending', { n: margin.pendientes })}
        />
      </div>
      <Panel title={t('admin.cashMarginProviders')}>
        <DataTable
          columns={
            [
              {
                key: 'provider',
                header: t('admin.cashColProvider'),
                cell: (row) => row.proveedor,
              },
              {
                key: 'status',
                header: '',
                cell: (row) => (
                  <StatusPill
                    tone={
                      Math.abs(row.diferenciaUsd) < 0.01
                        ? 'ok'
                        : row.diferenciaUsd < 0
                          ? 'error'
                          : 'warn'
                    }
                    label={
                      Math.abs(row.diferenciaUsd) < 0.01
                        ? t('admin.cashMarginCovered')
                        : t('admin.cashMarginReview')
                    }
                  />
                ),
              },
              {
                key: 'uses',
                header: t('admin.cashMarginUses'),
                numeric: true,
                cell: (row) => format.number(row.movimientos),
              },
              {
                key: 'cost',
                header: t('admin.cashMarginCost'),
                numeric: true,
                cell: (row) => usd(row.costoUsd),
              },
              {
                key: 'charged',
                header: t('admin.cashMarginCharged'),
                numeric: true,
                cell: (row) => usd(row.cobradoUsd),
              },
              {
                key: 'difference',
                header: t('admin.cashMarginDifference'),
                numeric: true,
                cell: (row) =>
                  row.movimientos ? usd(row.diferenciaUsd) : <Muted>—</Muted>,
              },
            ] as Column<WalletMargin['proveedores'][number]>[]
          }
          rows={margin.proveedores}
          rowKey={(row) => row.proveedor}
        />
        <p className="border-border text-muted-foreground border-t px-4 py-3 text-xs">
          {t('admin.cashMarginRounding', {
            usd: usd(margin.fraccionPendienteUsd),
          })}
        </p>
      </Panel>
    </div>
  );
}
