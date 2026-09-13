import type { Locale } from '@/lib/i18n/config';
import { formatNumber } from '@/lib/i18n/format';

/** Presentation variables only. Never rewrite the order's authoritative values. */
export function confirmationDisplayVars(vars: Record<string, unknown>, language: string) {
  const locale: Locale = language.startsWith('en') ? 'en' : 'es';
  const name = String(vars.recipient_name ?? vars.customer_name ?? '').trim();
  const raw = String(vars.total_price ?? '').trim();
  const currency = String(vars.currency ?? '').trim().toUpperCase();
  const amount = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  return {
    recipient_first_name: name.split(/\s+/)[0] ?? '',
    total_price_display: Number.isFinite(amount) && /^[A-Z]{3}$/.test(currency)
      ? `${formatNumber(amount, locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currency}`
      : [raw, currency].filter(Boolean).join(' '),
  };
}

export function confirmationCopy(language: Locale) {
  const en = language === 'en';
  return [
    {
      name: 'deuna_confirmacion_datos_v3', previous: 'deuna_confirmacion_datos_v2',
      body: en
        ? 'Hi, {{1}}! 😊\n\nYour order #{{2}} is in! Let’s get the details right 📦✨\n\n🛍️ You chose: {{3}}\n💵 Pay on delivery: {{4}}\n📍 Delivery address: {{5}}\n📱 Phone: {{6}}\n\nAll looking good? Tap CONFIRM ✅\nNeed a change? Tap CORRECT and we’ll help.'
        : '¡Hola, {{1}}! 😊\n\n¡Ya recibimos tu pedido #{{2}}! Vamos a revisar los detalles 📦✨\n\n🛍️ Elegiste: {{3}}\n💵 Pagas al recibir: {{4}}\n📍 Entrega en: {{5}}\n📱 Teléfono: {{6}}\n\n¿Todo como lo quieres? Toca CONFIRMAR ✅\n¿Algo cambió? Toca CORREGIR y te ayudamos.',
      fields: ['recipient_first_name', 'order_number', 'order_items', 'total_price_display', 'delivery_address', 'delivery_phone'],
      samples: ['Ana', '1001', en ? '1 × LED bouncing ball (Pink Pig)' : '1 × Pelota saltarina LED (Cerdita Rosa)',
        en ? '110,000 COP' : '110.000 COP', 'Calle 10 # 20-30, Cali', '+573000000000'],
    },
    {
      name: 'deuna_recordatorio_datos_v3', previous: 'deuna_recordatorio_datos_v2',
      body: en
        ? 'Hi, {{1}}! A quick check for order #{{2}} 😊\n\nYou chose {{3}}. Does everything in the summary look right?\n\nOne tap on CONFIRM lets us know ✅\nIf the address or another detail needs changing, tap CORRECT. We’re here to help!'
        : 'Hola, {{1}}. Una revisión rápida de tu pedido #{{2}} 😊\n\nElegiste {{3}}. ¿El resumen quedó tal como lo quieres?\n\nCon un toque en CONFIRMAR nos lo haces saber ✅\nSi cambió la dirección u otro dato, toca CORREGIR. ¡Lo revisamos contigo!',
      fields: ['recipient_first_name', 'order_number', 'order_items'],
      samples: ['Ana', '1001', en ? '1 × LED bouncing ball (Pink Pig)' : '1 × Pelota saltarina LED (Cerdita Rosa)'],
    },
    {
      name: 'deuna_revision_datos_v3', previous: 'deuna_revision_datos_v2',
      body: en
        ? 'Hi, {{1}} 😊 Is order #{{2}} still what you want?\n\nA quick check now helps avoid mix-ups later 📦\n\nTap CONFIRM if the details are right, or CORRECT if something needs changing.\n\nChanged your mind? Tell us here and we’ll check the cancellation options 💛'
        : 'Hola, {{1}} 😊 ¿Seguimos con tu pedido #{{2}}?\n\nRevisarlo ahora nos ayuda a evitar confusiones después 📦\n\nToca CONFIRMAR si los datos están bien o CORREGIR si necesitas un cambio.\n\n¿Cambiaste de idea? Cuéntanos por aquí y revisamos la opción de cancelarlo 💛',
      fields: ['recipient_first_name', 'order_number'], samples: ['Ana', '1001'],
    },
  ].map(item => ({ ...item, language,
    buttons: [{ type: 'QUICK_REPLY' as const, text: en ? 'CONFIRM' : 'CONFIRMAR' },
      { type: 'QUICK_REPLY' as const, text: en ? 'CORRECT' : 'CORREGIR' }],
  }));
}
