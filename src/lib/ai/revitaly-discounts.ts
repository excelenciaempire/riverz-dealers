import type { Channel } from '@/types';
import type { Regla } from './guidance';

export const REVITALY_DISCOUNT_WORKSPACE = '234604a9-909b-4e50-952b-acde4a85593a';
export const REVITALY_DISCOUNT_KEY = 'revitaly_payment_discounts';
export const REVITALY_DISCOUNT_POLICY =
  'Política confirmada por el dueño el 02/10/2026: el 10% corresponde únicamente al pago manual por transferencia al alias de Mercado Pago. El 5% con REVITALY5 corresponde exclusivamente a la página web y conserva su condición de primera compra. Son alternativas: nunca sumes 5% y 10%, nunca ofrezcas 15% ni los apliques sucesivamente (14,5%). Para transferencia al alias calcula el precio vigente del pack ANTES del cupón web, aplica únicamente el 10% y agrega el envío correspondiente sin descontarlo. No vuelvas a descontar un precio que ya incluye el cupón web. Otros cupones Shopify requieren verificar sus condiciones y también son alternativas, nunca adicionales a la transferencia. No transfieras estas promociones a Mercado Libre ni invites a pagar fuera de esa plataforma. Si una respuesta anterior combinó descuentos, aclara la política y recalcula antes de solicitar el pago. Si el cliente ya pagó, verifica el pedido y el pago; no solicites una segunda transferencia ni prometas un reembolso automático.';

/** Answer only explicit discount-combination questions, using the current enabled policy. */
export function revitalyDiscountReply(input: {
  workspaceId: string;
  agentId: string;
  channel: Channel;
  language: string;
  inbound: string;
  rules: Regla[];
}): string | null {
  if (input.workspaceId !== REVITALY_DISCOUNT_WORKSPACE ||
      !(['whatsapp', 'instagram', 'messenger', 'webchat'] as Channel[]).includes(input.channel)) return null;
  const policies = input.rules.filter(r => r.activa && r.workspace_id === input.workspaceId &&
    (!r.agent_id || r.agent_id === input.agentId) && r.clave === REVITALY_DISCOUNT_KEY);
  // A changed or ambiguous merchant policy must return to the normal agent.
  if (policies.length !== 1 || policies[0].hacer !== REVITALY_DISCOUNT_POLICY) return null;
  const text = input.inbound.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/transfer|alias/.test(text) || !/5\s*%|15\s*%|14[.,]5\s*%|revitaly5/.test(text)) return null;
  if (!/suma|combin|acumul|junt|mas|ademas|\+|stack|combine|plus|both|total.*%/.test(text)) return null;
  // Amounts, paid orders, refunds and additional requests need the ordinary contextual flow.
  if (/\$|\b(total(?!.*%)|importe|precio|cuanto|comprobante|ya pague|transferi|reembolso|pedido|envio|price|amount|already paid|receipt|refund|order|shipping)\b/.test(text)) return null;
  return input.language.toLowerCase().startsWith('en')
    ? 'The discounts cannot be combined: bank transfer to the Mercado Pago alias gives you 10% off. The 5% REVITALY5 discount is only for your first purchase on the website. Choose one; they do not add up to 15% or apply successively.'
    : 'Los descuentos no se combinan: por transferencia al alias de Mercado Pago tienes 10%. El 5% con REVITALY5 es sólo para tu primera compra en la página web. Se aplica uno solo; no se suman para dar 15% ni se aplican sucesivamente.';
}
