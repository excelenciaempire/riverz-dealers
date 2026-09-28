import type { Proveedor } from '@/lib/admin/proveedores';
import { translate } from '@/lib/i18n/translate';
import type { Locale } from '@/lib/i18n/config';

/** A quota limit is not a monetary balance. Escalation to zero is a new alert. */
export function providerAlert(p: Proveedor, locale: Locale = 'es'): { key: string; line: string } | null {
  if (!p.recargable || !['sin_saldo', 'bajo'].includes(p.estado)) return null;
  const quota = p.estado === 'bajo' && p.detalleKey === 'admin.svcRateLimited';
  const key = `${quota ? 'limite' : 'saldo'}:${p.id}:${p.estado}`;
  const balance = p.saldo === null ? '' : translate(locale, 'admin.providerAlertRemaining', {
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(p.saldo), unit: p.unidad ?? '',
  });
  return { key, line: translate(locale, quota ? 'admin.providerAlertQuota' : p.estado === 'sin_saldo' ? 'admin.providerAlertEmpty' : 'admin.providerAlertLow', {
    name: p.nombre, balance, url: p.url ?? '',
  }) };
}
