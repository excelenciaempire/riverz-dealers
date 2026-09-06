import type {
  AutomationTriggerType,
  VoiceCallScenario,
  VoiceCallType,
} from '@/types';

export const VOICE_CALL_SCENARIOS: VoiceCallScenario[] = [
  'thank_order',
  'confirm_cod',
  'cart_recovery',
  'payment_recovery',
  'delivery_update',
  'customer_followup',
  'custom',
];

const CALL_TYPE_BY_SCENARIO: Record<VoiceCallScenario, VoiceCallType> = {
  thank_order: 'order_confirmation',
  confirm_cod: 'order_confirmation',
  cart_recovery: 'cart_recovery',
  payment_recovery: 'followup',
  delivery_update: 'followup',
  customer_followup: 'followup',
  custom: 'manual',
};

const OBJECTIVE_BY_SCENARIO: Record<
  Exclude<VoiceCallScenario, 'custom'>,
  { es: string; en: string }
> = {
  thank_order: {
    es: 'Agradece al cliente por su pedido reciente, confirma que fue recibido y ofrece ayuda con cualquier duda. No vuelvas a confirmar todos los datos salvo que el cliente lo pida.',
    en: 'Thank the customer for their recent order, confirm it was received, and offer help with any questions. Do not reconfirm every detail unless the customer asks.',
  },
  confirm_cod: {
    es: 'Confirma el pedido contra entrega: productos, dirección, disponibilidad y compromiso de recibirlo. Corrige los datos necesarios antes de cerrar la llamada.',
    en: 'Confirm the cash-on-delivery order: products, address, availability, and commitment to receive it. Correct any necessary details before ending the call.',
  },
  cart_recovery: {
    es: 'Ayuda al cliente a completar su compra abandonada. Resuelve dudas sobre productos, envío o pago sin presionarlo.',
    en: 'Help the customer complete their abandoned purchase. Resolve product, shipping, or payment questions without pressuring them.',
  },
  payment_recovery: {
    es: 'Explica que el pago no se completó, identifica el problema y ayuda al cliente a terminar la compra. Si necesita un enlace, envíalo por WhatsApp de forma segura.',
    en: 'Explain that the payment was not completed, identify the issue, and help the customer finish the purchase. If they need a link, send it securely through WhatsApp.',
  },
  delivery_update: {
    es: 'Informa el estado real del envío y resuelve dudas sobre la entrega. No prometas fechas que no estén disponibles en el contexto.',
    en: 'Share the actual shipment status and resolve delivery questions. Do not promise dates that are not available in the context.',
  },
  customer_followup: {
    es: 'Haz seguimiento al cliente, pregunta si necesita ayuda y resuelve su consulta usando el contexto disponible.',
    en: 'Follow up with the customer, ask whether they need help, and resolve their question using the available context.',
  },
};

export function isVoiceCallScenario(value: unknown): value is VoiceCallScenario {
  return typeof value === 'string' && VOICE_CALL_SCENARIOS.includes(value as VoiceCallScenario);
}

export function voiceCallTypeForScenario(scenario: VoiceCallScenario): VoiceCallType {
  return CALL_TYPE_BY_SCENARIO[scenario];
}

export function objectiveForVoiceScenario(
  scenario: VoiceCallScenario,
  language: 'es' | 'en'
): string | null {
  if (scenario === 'custom') return null;
  return OBJECTIVE_BY_SCENARIO[scenario][language];
}

function contextText(context: Record<string, unknown>): string {
  const keys = [
    'payment_method',
    'payment_method_title',
    'payment_gateway',
    'gateway',
    'gateway_names',
    'payment_methods',
  ];
  return keys
    .flatMap((key) => {
      const value = context[key];
      if (Array.isArray(value)) return value.map(String);
      return value == null ? [] : [String(value)];
    })
    .join(' ')
    .toLowerCase();
}

export function isCashOnDelivery(context: Record<string, unknown>): boolean {
  return /cash[ _-]?on[ _-]?delivery|\bcod\b|contra[ _-]?entrega|pago al recibir/.test(
    contextText(context)
  );
}

export function inferVoiceCallScenario(
  trigger: AutomationTriggerType,
  context: Record<string, unknown> = {}
): VoiceCallScenario | null {
  switch (trigger) {
    case 'shopify_order_created':
    case 'shopify_order_paid':
      return isCashOnDelivery(context) ? 'confirm_cod' : 'thank_order';
    case 'shopify_abandoned_checkout':
      return 'cart_recovery';
    case 'payment_rejected':
      return 'payment_recovery';
    case 'shopify_order_fulfilled':
    case 'shopify_order_delivered':
      return 'delivery_update';
    case 'post_delivery_feedback':
    case 'customer_inactive':
      return 'customer_followup';
    default:
      return null;
  }
}
