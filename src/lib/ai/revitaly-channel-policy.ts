import type { Channel } from '@/types';

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
