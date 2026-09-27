import type { ModeloCobro, Plan } from './plan';

export function compatibleBillingPlan(model: ModeloCobro, plan: Plan | null | undefined): boolean {
  if (!plan?.activo) return false;
  if (model === 'byok') return plan.slug === 'byok';
  if (plan.slug === 'byok') return false;
  if (model === 'oficial') return plan.slug !== 'saldo-ilimitado' && plan.incluidas > 0;
  return model === 'saldo'; // Preserve explicitly selected legacy balance plans.
}

export function billingAmount(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}
