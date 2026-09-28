import { expect, it } from 'vitest';
import type { Proveedor } from '@/lib/admin/proveedores';
import { providerAlert } from './provider-alerts';
const p = { id: 'groq', nombre: 'Groq', estado: 'bajo', recargable: true, saldo: null, url: 'https://console.groq.com', detalleKey: 'admin.svcRateLimited' } as Proveedor;
it('does not call a rate limit a low monetary balance', () => {
  const alert = providerAlert(p)!;
  expect(alert.key).toBe('limite:groq:bajo'); expect(alert.line).not.toContain('saldo');
});
it('announces depletion independently of the earlier low-credit warning', () => {
  const low = providerAlert({ ...p, detalleKey: null, saldo: 3, unidad: 'USD' })!;
  const empty = providerAlert({ ...p, estado: 'sin_saldo', detalleKey: 'admin.svcNoCredit' })!;
  expect(low.key).not.toBe(empty.key); expect(empty.line).toContain('SIN SALDO');
});
it('supports both owner notification languages', () => {
  expect(providerAlert({ ...p, estado: 'sin_saldo' }, 'en')?.line).toContain('OUT OF CREDIT');
});
it('does not invent a credit alarm when balance cannot be read or Stripe has transferred its funds', () => {
  expect(providerAlert({ ...p, estado: 'desconocido' })).toBeNull();
  expect(providerAlert({ ...p, recargable: false, saldo: 0 })).toBeNull();
});
