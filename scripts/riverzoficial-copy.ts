/** Reviewed messages for riverzoficial. Product lists are always transaction data. */
export { RIVERZOFICIAL_WORKSPACE } from '../src/lib/automations/riverzoficial-template-context';
type Copy = { key: string; aliases: string[]; fields: string[]; es: string; en: string };
export const productTemplates: Copy[] = [
{ key: 'confirmacion', aliases: ['deuna_confirmacion_contraentrega','deuna_confirmacion_datos_v2','deuna_confirmacion_datos_v3'], fields: ['contact_first_name','order_items','total_price_display','delivery_address','delivery_phone'],
es: `Hola, {{1}} 😊 ¡Gracias por tu compra!

Ya recibimos lo que elegiste:
{{2}}

Pagas al recibir: {{3}}
Lo enviamos a: {{4}}
Tu teléfono: {{5}}

¿Está todo bien? Toca CONFIRMAR.
Si necesitas cambiar algún dato, toca CORREGIR y dime cuál.`,
en: `Hi, {{1}} 😊 Thanks for your purchase!

We received your selection:
{{2}}

Pay on delivery: {{3}}
Delivery address: {{4}}
Your phone: {{5}}

Does everything look right? Tap CONFIRM.
If a detail needs changing, tap CORRECT and tell me which one.` },
{ key: 'recordatorio', aliases: ['deuna_recordatorio_confirmacion','deuna_recordatorio_datos_v2','deuna_recordatorio_datos_v3'], fields: ['order_items'],
es: `Te escribo por lo que elegiste 😊
{{1}}

¿Pudiste revisar la dirección y los demás datos que te envié?

Toca CONFIRMAR si están bien o CORREGIR si necesitas ajustar algo.`,
en: `I'm following up on your selection 😊
{{1}}

Have you checked the address and other details I sent you?

Tap CONFIRM if they're right, or CORRECT if something needs changing.` },
{ key: 'revision', aliases: ['deuna_revision_datos_v2','deuna_revision_datos_v3','deuna_ultimo_recordatorio'], fields: ['order_items'],
es: `Me falta tu respuesta sobre:
{{1}}

¿Los datos que te envié están bien? Toca CONFIRMAR para decírmelo 😊

Si necesitas cambiar algo, toca CORREGIR. Si tienes una duda, escríbeme y la revisamos.`,
en: `I'm still waiting to hear from you about:
{{1}}

Are the details I sent you right? Tap CONFIRM to let me know 😊

If something needs changing, tap CORRECT. If you have a question, send it here and we'll go through it.` },
{ key: 'carrito', aliases: ['deuna_carrito_pendiente_1','riverz_carrito_abandonado'], fields: ['order_items'],
es: `Vi que dejaste esto en tu carrito 😊
{{1}}

¿Te quedó alguna duda antes de comprar? Dime qué te gustaría saber y te ayudo.

Puedes retomar la compra desde el botón. Pagas cuando la recibas.`,
en: `I saw you left this in your cart 😊
{{1}}

Did you have a question before buying? Tell me what you'd like to know and I'll help.

You can continue from the button below. You pay when your purchase arrives.` },
{ key: 'carrito_recordatorio', aliases: ['deuna_carrito_pendiente_2'], fields: ['order_items'],
es: `¿Todavía te interesa llevar esto?
{{1}}

Si hay algo que te hace dudar, cuéntame y lo revisamos 😊

Si ya te decidiste, puedes terminar la compra desde el botón y pagar al recibir.`,
en: `Are you still interested in these items?
{{1}}

If something is making you hesitate, tell me and we'll go through it 😊

If you've decided, you can finish from the button below and pay on delivery.` },
{ key: 'despachado', aliases: ['deuna_pedido_despachado','deuna_pedido_despachado_v2','riverz_pedido_en_camino'], fields: ['order_items','tracking_number'],
es: `¡Ya enviamos tu compra! 🚚
{{1}}

Te dejo la guía para seguir el envío: {{2}}

Si necesitas revisar algo de la entrega, escríbeme por aquí.`,
en: `We've shipped your purchase! 🚚
{{1}}

Here's your tracking number: {{2}}

If you need to check anything about the delivery, message me here.` },
{ key: 'entregado', aliases: ['deuna_pedido_entregado'], fields: ['order_items'],
es: `Me aparece como entregada tu compra de:
{{1}}

¿Te llegó todo bien? 📦

Si te falta algo o tienes alguna duda para usarlo, cuéntame.`,
en: `Your purchase is showing as delivered:
{{1}}

Did everything arrive in good condition? 📦

If anything is missing or you have a question about using it, let me know.` },
{ key: 'cancelado', aliases: ['deuna_pedido_cancelado'], fields: ['order_items'],
es: `Te aviso que quedó cancelada tu compra de:
{{1}}

Si no pediste cancelarla, escríbeme y revisamos qué pasó.`,
en: `I'm letting you know that this purchase was cancelled:
{{1}}

If you didn't ask to cancel it, message me and we'll check what happened.` },
{ key: 'experiencia', aliases: ['riverz_como_te_fue'], fields: ['order_items'],
es: `¿Cómo te ha ido con esto? 😊
{{1}}

Cuéntame si ya lo usaste o si necesitas que te ayude con algo.`,
en: `How are you getting on with these items? 😊
{{1}}

Tell me if you've had a chance to use them or need help with anything.` },
{ key: 'revision_pago', aliases: ['riverz_esperando_transferencia','riverz_pago_rechazado'], fields: ['order_items'],
es: `Te escribo por tu compra de:
{{1}}

Recuerda que pagas al recibir, no necesitas transferir antes.

Si te llegó un aviso de pago que no entiendes, envíamelo y lo reviso contigo.`,
en: `I'm writing about your purchase of:
{{1}}

Remember, you pay on delivery. You don't need to transfer money beforehand.

If you received a payment notice you don't understand, send it to me and we'll check it together.` },
];
export const productTemplateName = (key: string) => `deuna_${key}_producto_v1`;
