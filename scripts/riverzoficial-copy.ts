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
{ key: 'recordatorio', aliases: ['deuna_recordatorio_producto_v1','deuna_recordatorio_confirmacion','deuna_recordatorio_datos_v2','deuna_recordatorio_datos_v3'], fields: ['order_items'],
es: `Quiero asegurarme de que recibas justo lo que elegiste 😊
{{1}}

¿La dirección y el teléfono del resumen están bien?

Toca CONFIRMAR si están correctos. Si algo cambió, toca CORREGIR y dime qué necesitas ajustar.`,
en: `I want to make sure you receive exactly what you chose 😊
{{1}}

Are the address and phone number in the summary correct?

Tap CONFIRM if they're right. If something has changed, tap CORRECT and tell me what needs updating.` },
{ key: 'revision', aliases: ['deuna_revision_producto_v1','deuna_revision_datos_v2','deuna_revision_datos_v3','deuna_ultimo_recordatorio'], fields: ['order_items'],
es: `¿Hay algo que quieras revisar antes de confirmar esto?
{{1}}

Si tienes una duda o necesitas cambiar un dato, cuéntame y lo revisamos juntos.

Si todo está bien, toca CONFIRMAR 😊 Para ajustar los datos, toca CORREGIR.`,
en: `Is there anything you'd like to check before confirming these details?
{{1}}

If you have a question or need to change a detail, tell me and we'll go through it together.

If everything is right, tap CONFIRM 😊 To update the details, tap CORRECT.` },
{ key: 'carrito', aliases: ['deuna_carrito_producto_v1','deuna_carrito_pendiente_1','riverz_carrito_abandonado'], fields: ['order_items'],
es: `Puedes llevar lo que elegiste y pagarlo cuando lo recibas 😊
{{1}}

No necesitas pagar por adelantado.

Toca Retomar compra para revisar el total y terminar. Si tienes una duda antes de decidirte, escríbeme.`,
en: `You can order what you chose and pay when it arrives 😊
{{1}}

There's no upfront payment.

Tap Continue shopping to review the total and finish. If you have a question before deciding, message me.` },
{ key: 'carrito_recordatorio', aliases: ['deuna_carrito_recordatorio_producto_v1','deuna_carrito_pendiente_2'], fields: ['order_items'],
es: `Te dejo el carrito una última vez para que puedas retomarlo sin empezar de nuevo 😊
{{1}}

¿Te frenó una duda sobre el producto o la entrega? Cuéntame cuál y te ayudo a aclararla.

Si ya te decidiste, toca Ver mi carrito. Pagas al recibir.`,
en: `Here's one last reminder so you can pick up where you left off 😊
{{1}}

Did a question about the product or delivery hold you back? Tell me what it is and I'll help clarify it.

If you've decided, tap View my cart. You pay on delivery.` },
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
const contextualKeys = new Set(['recordatorio', 'revision', 'carrito', 'carrito_recordatorio']);
export const productTemplateName = (key: string) => `deuna_${key}_producto_v${contextualKeys.has(key) ? 2 : 1}`;
