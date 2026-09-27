import type { Channel } from '@/types';

const REVITALY = '234604a9-909b-4e50-952b-acde4a85593a';

/** Narrow reminders for the merchant's reviewed feedback; prices stay in live rules. */
export function revitalyFeedbackBrief(workspaceId: string, inbound: string): string {
  if (workspaceId !== REVITALY) return '';
  const notes: string[] = [];
  if (/contra\s*entrega|pagar\s+(?:al|cuando)\s+(?:recibir|llegue)/i.test(inbound))
    notes.push('Esta consulta es sobre contra entrega: según la regla del comercio no está disponible. Ofrece únicamente Mercado Libre con compra protegida como alternativa, no el menú completo de pagos.');
  if (/env[ií]o|shipping/i.test(inbound) && !/producto|tratamiento|pack|shampoo/i.test(inbound))
    notes.push('Pregunta únicamente por envío: contesta localidad/plazo/costo según la regla de envíos, no presentes precios de tratamientos ni preguntes por el pelo o el pack.');
  return notes.length ? '\n\nEnfoque para este turno, según feedback del comercio:\n' + notes.join('\n') : '';
}

export function ensureRevitalyIntroduction(opts: {
  workspaceId: string; channel: Channel; language: string; text: string; hasPriorReply: boolean;
}): string {
  if (opts.workspaceId !== REVITALY || opts.hasPriorReply || !opts.text.trim() ||
      !['whatsapp', 'instagram', 'messenger', 'webchat'].includes(opts.channel) || /\bNatalia\b/i.test(opts.text)) return opts.text;
  const greeting = opts.language.startsWith('en')
    ? 'Hi! This is Natalia from Revitaly Customer Support 😊'
    : 'Hola, ¿cómo estás? Te habla Natalia de Atención al cliente 😊';
  return `${greeting}\n\n${opts.text}`;
}

/** Same Natalia, but email only redirects; sales prompts must never override this rule. */
export function revitalyEmailRedirect(
  workspaceId: string,
  channel: Channel,
  language = 'es'
): string | null {
  if (
    workspaceId !== '234604a9-909b-4e50-952b-acde4a85593a' ||
    !['gmail', 'outlook'].includes(channel)
  )
    return null;
  return language.startsWith('en')
    ? 'Thank you for contacting Revitaly. We handle inquiries on WhatsApp. Please continue here: https://wa.me/5492255629123 — Natalia, Revitaly Customer Support.'
    : 'Gracias por contactar a Revitaly. Atendemos las consultas por WhatsApp. Por favor, continúa aquí: https://wa.me/5492255629123 — Natalia, Atención al cliente de Revitaly.';
}
