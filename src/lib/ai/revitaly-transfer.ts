import type { Channel } from '@/types';
import type { Regla } from './guidance';

const REVITALY = '234604a9-909b-4e50-952b-acde4a85593a';
const PRIVATE_CHANNELS: Channel[] = ['whatsapp', 'instagram', 'messenger', 'webchat'];

/** Share configured payment details; quoting totals and verifying payments remain separate turns. */
export function revitalyTransferReply(input: {
  workspaceId: string;
  agentId: string;
  channel: Channel;
  language: string;
  inbound: string;
  rules: Regla[];
}): string | null {
  if (input.workspaceId !== REVITALY || !PRIVATE_CHANNELS.includes(input.channel)) return null;
  const text = input.inbound.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const asksForDetails = /\b(alias|cvu|cbu|bank details|account details)\b/.test(text);
  const choosesTransfer = /^(?:(?:quiero|prefiero|elijo|pago|pagar|pagar por|por|con|una|la)\s+)?transferencia(?:\s+bancaria)?(?:\s+10%\s*off)?[.!?\s]*$/.test(text)
    || /^(?:bank transfer|pay by bank transfer)[.!?\s]*$/.test(text);
  if (!asksForDetails && !choosesTransfer) return null;
  // A receipt, failed transfer, refund or explicit refusal needs the normal agent.
  if (/\b(comprobante|ya\s+(?:pague|transferi)|reembolso|devolucion|no\s+(?:quiero|voy a|puedo|funciona)|error|rechazad\w*|problema|receipt|already paid|refund|failed|do not|don't)\b/.test(text)) return null;
  if (/\b(total|importe|precio|costo|cuanto|amount|price|cost)\b/.test(text)) return null;

  const rules = input.rules.filter(rule => rule.activa && rule.workspace_id === input.workspaceId
    && (!rule.agent_id || rule.agent_id === input.agentId) && rule.clave === 'ofertas_pago_manual');
  // Ambiguous or incomplete configuration must never choose an account by accident.
  if (rules.length !== 1) return null;
  const policy = rules[0].hacer;
  const holder = /\bTitular:\s*([^\r\n.]+)/i.exec(policy)?.[1]?.trim();
  const cvu = /\bCVU:\s*(\d{22})(?!\d)/i.exec(policy)?.[1];
  const alias = /\bAlias:\s*([a-z0-9_-]+(?:\.[a-z0-9_-]+)*)/i.exec(policy)?.[1];
  if (!holder || !cvu || !alias) return null;
  return input.language.toLowerCase().startsWith('en')
    ? `Bank transfer details:\nAccount holder: ${holder}\nCVU: ${cvu}\nAlias: ${alias}`
    : `Datos para transferir:\nTitular: ${holder}\nCVU: ${cvu}\nAlias: ${alias}`;
}
