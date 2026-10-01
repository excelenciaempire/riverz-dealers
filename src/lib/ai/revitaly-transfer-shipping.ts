import type { Channel } from '@/types';
import type { Regla } from './guidance';
import { REVITALY_EMAIL_WORKSPACE } from '../channels/email/whatsapp-referral';

export const REVITALY_SHIPPING_RULE = 'revitaly_transfer_shipping_fields';
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const writtenOnly = (s: string) => s.split(/\[(?:Audio transcrito|Imagen analizada|Adjunto pendiente|Archivo adjunto)/i)[0];
const isTransferChoice = (text: string) => /^(?:(?:quiero|prefiero|elijo|pago|pagar|pagar por|por|con|una|la)\s+)?transferencia(?:\s+bancaria)?(?:\s+10%\s*off)?[.!?\s]*$/.test(text)
  || /^(?:bank transfer|pay by bank transfer)[.!?\s]*$/.test(text);
const fields = [
  ['Nombre y apellido', 'Full name', /^(?:nombre(?: y apellido)?|full name)$/],
  ['DNI', 'ID number (DNI)', /^(?:dni|documento|id number(?: \(dni\))?)$/],
  ['Teléfono', 'Phone', /^(?:telefono|celular|phone)$/],
  ['Email', 'Email', /^(?:email|e-mail|correo(?: electronico)?)$/],
  ['Calle', 'Street', /^(?:calle|street)$/],
  ['Número', 'Street number', /^(?:numero|altura|street number)$/],
  ['Código postal', 'Postal code', /^(?:codigo postal|cp|postal code)$/],
  ['Ciudad / Localidad', 'City / Town', /^(?:ciudad(?:\s*\/\s*localidad)?|localidad|city(?:\s*\/\s*town)?|town)$/],
  ['Provincia', 'Province', /^(?:provincia|province)$/],
] as const;
function validField(index: number, value: string): boolean {
  if (index === 0) return value.trim().split(/\s+/).length >= 2 && /\p{L}/u.test(value);
  if (index === 1) return /^[\d.\s]+$/.test(value) && /^\d{6,9}$/.test(value.replace(/\D/g, ''));
  if (index === 2) return /^[+\d\s().-]+$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ''));
  if (index === 3) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (index === 5) return /^\d+[\p{L}\d\s/.-]*$/u.test(value);
  if (index === 6) return /^(?:[a-z]\s*)?\d{4}(?:\s*[a-z]{3})?$/i.test(value);
  return /\p{L}/u.test(value);
}

export function revitalyTransferShippingReply(input: {
  workspaceId: string; agentId: string; channel: Channel; language: string; inbound: string;
  rules: Regla[]; history?: { role: string; content: string }[];
}): string | null {
  // Shipping details are private. Mercado Libre has its own delivery process.
  if (input.workspaceId !== REVITALY_EMAIL_WORKSPACE || input.channel !== 'whatsapp') return null;
  const enabled = input.rules.some(r => r.activa && r.workspace_id === input.workspaceId
    && (!r.agent_id || r.agent_id === input.agentId) && r.clave === REVITALY_SHIPPING_RULE);
  if (!enabled) return null;
  const fullHistory = input.history ?? [];
  const inbound = normalize(input.inbound);
  if (/\b(reembolso|devolucion|cancelar|rechazad\w*|no (?:quiero|puedo)|no llego|no recibi|demora|refund|cancel|failed)\b/.test(inbound)) return null;
  if (/\b(tarjeta|debito|credito|credit card|debit card)\b/.test(inbound) && !/\b(transferencia|transferi|bank transfer)\b/.test(inbound)) return null;
  const transferChoice = isTransferChoice(inbound);
  const lastChoice = fullHistory.findLastIndex(m => m.role === 'user' && isTransferChoice(normalize(m.content)));
  // A new transfer purchase must not silently reuse a previous order's fields.
  const history = transferChoice ? [] : lastChoice >= 0 ? fullHistory.slice(lastChoice) : fullHistory;
  const context = normalize([...history.map(m => m.content), input.inbound].join('\n'));
  if (!/\b(transferencia|transferi|transferido|alias|cvu|bank transfer|transferred)\b/.test(context)) return null;
  const deliveryChoice = normalize([...fullHistory.filter(m => m.role === 'user').map(m => m.content), input.inbound].join('\n'));
  if (/\b(sucursal|retiro|pickup)\b/.test(deliveryChoice) && !/\b(domicilio|home delivery)\b/.test(deliveryChoice)) return null;
  const formSent = history.some(m => m.role === 'assistant' && /\bDNI\b/i.test(m.content)
    && /(?:C[oó]digo postal|Postal code)/i.test(m.content) && /(?:Provincia|Province)/i.test(m.content));
  const submittingFields = /(?:nombre|dni|telefono|email|calle|numero|codigo postal|provincia|full name|street|postal code)\s*:/i.test(inbound);
  const map = /https?:\/\/\S*(?:maps|goo\.gl)|ubicacion|location|google maps/i.test(input.inbound);
  const audioOrImage = /\[(?:Audio transcrito|Imagen analizada|Adjunto pendiente)/i.test(input.inbound);
  const paymentEvidence = /\b(ya (?:pague|transferi)|transferido|comprobante|receipt|already paid|transferred)\b/.test(inbound);
  if (!transferChoice && !paymentEvidence && !(formSent && (submittingFields || map || audioOrImage))) return null;
  const supplied = new Set<number>();
  for (const message of [...history.filter(m => m.role === 'user'), { role: 'user', content: input.inbound }]) {
    for (const line of writtenOnly(message.content).split(/\r?\n/)) {
      const match = /^\s*(?:[•*\-]\s*)?([^:]+):\s*(.+?)\s*$/.exec(line);
      if (!match) continue;
      const value = match[2].trim();
      if (!value || /https?:\/\/|google maps|^(?:pendiente|no se|n\/a|\.{2,}|\[.*\])$/i.test(value)) continue;
      const index = fields.findIndex(f => f[2].test(normalize(match[1]).trim()));
      if (index >= 0) {
        if (validField(index, value)) supplied.add(index);
        else supplied.delete(index);
      }
    }
  }
  const missing = fields.filter((_, i) => !supplied.has(i));
  if (!missing.length) return null;
  const en = input.language.toLowerCase().startsWith('en');
  const list = missing.map(f => `• ${f[en ? 1 : 0]}:`);
  if (!formSent && supplied.size === 0) list.splice(6, 0, en ? '• Floor / Apartment (if applicable):' : '• Piso / Dpto (si corresponde):');
  const intro = formSent || supplied.size > 0
    ? en ? 'Please send only the missing delivery details in writing:' : 'Envíanos por escrito solo los datos de envío que faltan:'
    : en ? 'For home delivery, please complete and send these details:' : 'Para realizar el envío a domicilio, completa y envíanos los siguientes datos:';
  const note = en
    ? '⚠️ Send each field in writing, in this order. Google Maps links, map pins and live locations are not accepted as the delivery address.'
    : '⚠️ Envía cada dato por escrito, en este orden. No aceptamos ubicaciones de Google Maps, enlaces ni ubicación en tiempo real como dirección de envío.';
  // One ordered form stays in a single bubble even with the agent's multi mode.
  return `${intro}\n${list.join('\n')}\n${note}`;
}
