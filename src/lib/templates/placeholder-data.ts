import type { MessageTemplate } from '@/types';

/**
 * Demo templates para /plantillas y /plantillas/[id] cuando todavía no
 * existe ninguna real. IDs prefijados con "demo-" para que el resto del
 * código pueda short-circuitar fetch / delete.
 */
export const PLACEHOLDER_TEMPLATES: MessageTemplate[] = [
  {
    id: 'demo-1',
    user_id: 'demo',
    name: 'bienvenida_nuevo_cliente',
    category: 'Utility',
    language: 'es',
    header_type: 'text',
    header_content: '¡Bienvenido a Vitalú!',
    body_text:
      'Hola {{1}}, gracias por unirte a Vitalú. Soy María, tu asesora. ¿En qué te puedo ayudar hoy?',
    footer_text: 'Equipo Vitalú',
    buttons: undefined,
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-2',
    user_id: 'demo',
    name: 'confirmacion_pedido',
    category: 'Utility',
    language: 'es',
    body_text:
      '¡Listo {{1}}! Tu pedido {{2}} fue confirmado por {{3}}. Te avisamos cuando salga del centro de despacho.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-3',
    user_id: 'demo',
    name: 'despacho_con_tracking',
    category: 'Utility',
    language: 'es',
    body_text:
      '¡Tu pedido {{1}} ya está en camino! Lo lleva {{2}} con la guía {{3}}. Seguilo con el botón de abajo.',
    footer_text: 'Llega entre 2 y 5 días hábiles.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-4',
    user_id: 'demo',
    name: 'carrito_abandonado_24h',
    category: 'Marketing',
    language: 'es',
    header_type: 'text',
    header_content: '¿Lo dejaste pendiente?',
    body_text:
      'Hola {{1}}, ayer dejaste {{2}} en el carrito. Te dejamos un 10% con el código VUELVE10 — vale por 24 horas.',
    footer_text: 'Sin presión, tú sabes cuándo es el momento.',
    status: 'Approved',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-5',
    user_id: 'demo',
    name: 'recompra_30dias',
    category: 'Marketing',
    language: 'es',
    body_text:
      'Hola {{1}}, hace un mes pediste {{2}}. ¿Cómo te fue? Si necesitas reponer, te dejamos envío gratis con FIDELIDAD.',
    status: 'Pending',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-6',
    user_id: 'demo',
    name: 'codigo_verificacion_otp',
    category: 'Authentication',
    language: 'es',
    body_text:
      'Tu código de verificación de Vitalú es {{1}}. Vence en 10 minutos. No lo compartas con nadie.',
    footer_text: 'Si no fuiste tú, ignora este mensaje.',
    status: 'Draft',
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  } as unknown as MessageTemplate,
  {
    id: 'demo-7',
    user_id: 'demo',
    name: 'aviso_stock_agotado',
    category: 'Utility',
    language: 'es',
    body_text:
      'Hola {{1}}, lamentablemente {{2}} se agotó antes de despacharlo. Te devolvemos el dinero a {{3}} en 24-48 hs. Disculpá la molestia.',
    status: 'Rejected',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
  } as unknown as MessageTemplate,
];

export function isPlaceholderTemplateId(id: string): boolean {
  return id.startsWith('demo-');
}

export function findPlaceholderTemplate(id: string): MessageTemplate | null {
  return PLACEHOLDER_TEMPLATES.find((t) => t.id === id) ?? null;
}
