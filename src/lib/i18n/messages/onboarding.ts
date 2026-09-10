import type { Namespace } from './types';

export const onboarding = {
  audit0Title: {
    es: '01 · Pregunta por un producto o precio',
    en: '01 · Product or price question',
  },
  audit0Difference: {
    es: 'Pilar orienta sobre el sérum; Rasmiaw ayuda a elegir entre rascadores.',
    en: 'Pilar explains the serum; Rasmiaw helps choose a scratcher.',
  },
  audit0P0: {
    es: 'Asesora de Pilar recibe la consulta.',
    en: 'Pilar advisor receives the question.',
  },
  audit0P1: {
    es: 'Consulta ficha, precio y ofertas vigentes; en Mercado Libre usa el precio de ese canal.',
    en: 'Checks current product details, price and offers; uses channel-specific Mercado Libre pricing.',
  },
  audit0P2: {
    es: 'Responde brevemente y acompaña el precio con el enlace.',
    en: 'Replies briefly and includes the link with the price.',
  },
  audit0R0: {
    es: 'Guía Global recibe la consulta en WhatsApp, Instagram o Messenger.',
    en: 'Global Guide receives the question on WhatsApp, Instagram or Messenger.',
  },
  audit0R1: {
    es: 'Recomienda según espacio, tamaño y cantidad de gatos; consulta catálogo vigente.',
    en: 'Recommends based on space, cat size and number of cats; checks the current catalog.',
  },
  audit0R2: {
    es: 'Si falta un precio, stock o ficha verificada → equipo humano.',
    en: 'Missing verified price, stock or product details → human team.',
  },
  audit0PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit0RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit1Title: {
    es: '02 · Quiere comprar por chat',
    en: '02 · Wants to buy in chat',
  },
  audit1Difference: {
    es: 'Pilar tiene más permisos de operación; Rasmiaw vende por enlace y reserva cambios de pedido al equipo.',
    en: 'Pilar has broader operational permissions; Rasmiaw sells through links and leaves order changes to the team.',
  },
  audit1P0: {
    es: 'Consulta producto y condiciones reales.',
    en: 'Checks real product and sales conditions.',
  },
  audit1P1: {
    es: 'Tiene habilitado crear checkout y crear pedido; su uso depende de los datos e integración.',
    en: 'Checkout and order creation are enabled; execution depends on data and integration.',
  },
  audit1P2: {
    es: 'La compra y el pago se verifican en la tienda. Tope de descuento: 0%.',
    en: 'Purchase and payment are verified in the store. Discount cap: 0%.',
  },
  audit1R0: {
    es: 'La Guía Global puede crear un checkout.',
    en: 'Global Guide can create a checkout.',
  },
  audit1R1: {
    es: 'No tiene habilitado crear pedidos directamente ni registrar pagos.',
    en: 'Direct order creation and payment registration are disabled.',
  },
  audit1R2: {
    es: 'El cliente completa la compra en la tienda. Tope configurado: 10%; no es una oferta universal.',
    en: 'Customer completes the purchase in the store. Configured cap: 10%; this is not a universal offer.',
  },
  audit1PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit1RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit2Title: {
    es: '03 · Comentario con intención de compra',
    en: '03 · Comment showing purchase intent',
  },
  audit2Difference: {
    es: 'Ambas cuentas están hoy en público + privado, sujeto a permisos del canal; Rasmiaw no está en el modo privado selectivo del script inicial.',
    en: 'Both accounts currently use public + private, subject to channel permissions; Rasmiaw is not using the selective-DM mode in the original script.',
  },
  audit2P0: {
    es: 'Comentarios activados en Instagram, Facebook y TikTok.',
    en: 'Comments enabled on Instagram, Facebook and TikTok.',
  },
  audit2P1: {
    es: 'Audiencia: intención de compra. Instagram/Facebook: respuesta pública + intento de DM.',
    en: 'Audience: purchase intent. Instagram/Facebook: public reply + DM attempt.',
  },
  audit2P2: {
    es: 'Hasta 4 respuestas por hilo. TikTok: solo respuesta pública.',
    en: 'Up to 4 replies per thread. TikTok: public reply only.',
  },
  audit2R0: {
    es: 'Comentarios activados en Instagram y Facebook; TikTok apagado.',
    en: 'Comments enabled on Instagram and Facebook; TikTok disabled.',
  },
  audit2R1: {
    es: 'Audiencia: todas las preguntas pertinentes. Respuesta pública + intento de DM.',
    en: 'Audience: all relevant questions. Public reply + DM attempt.',
  },
  audit2R2: {
    es: 'Hasta 3 respuestas por hilo; se filtra spam.',
    en: 'Up to 3 replies per thread; spam is filtered.',
  },
  audit2PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit2RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit3Title: {
    es: '04 · Comentario sin intención de compra o spam',
    en: '04 · No purchase intent or spam',
  },
  audit3Difference: {
    es: 'Rasmiaw cubre preguntas más amplias; Pilar prioriza intención comercial.',
    en: 'Rasmiaw covers broader questions; Pilar prioritizes commercial intent.',
  },
  audit3P0: {
    es: 'El filtro de intención puede omitir el comentario.',
    en: 'The intent filter may skip the comment.',
  },
  audit3P1: {
    es: 'El spam se descarta; una crítica no se convierte en una discusión.',
    en: 'Spam is ignored; criticism is not turned into an argument.',
  },
  audit3R0: {
    es: 'Puede responder una pregunta pertinente aunque no tenga intención de compra.',
    en: 'May answer a relevant question even without purchase intent.',
  },
  audit3R1: {
    es: 'No obliga a responder emojis, reacciones o agradecimientos sin una pregunta. Spam se filtra.',
    en: 'Does not force replies to emojis, reactions or thanks without a question. Spam is filtered.',
  },
  audit3PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit3RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit4Title: {
    es: '05 · Pedido o datos privados en un comentario',
    en: '05 · Order or private information in a comment',
  },
  audit4Difference: {
    es: 'La información privada debe resolverse en privado; enviar un DM depende de que la plataforma lo permita.',
    en: 'Private information is handled privately; DM delivery depends on platform permissions.',
  },
  audit4P0: {
    es: 'Evita publicar datos del pedido, pago o contacto.',
    en: 'Avoids publishing order, payment or contact information.',
  },
  audit4P1: {
    es: 'Pasa a conversación privada cuando el canal permite el DM.',
    en: 'Moves to a private conversation when the channel permits DMs.',
  },
  audit4P2: {
    es: 'Si hay un problema real → intervención humana.',
    en: 'If there is an actual issue → human intervention.',
  },
  audit4R0: {
    es: 'No publica guía, dirección, teléfono, correo, importe ni comprobante.',
    en: 'Does not publish tracking, address, phone, email, amount or receipt.',
  },
  audit4R1: {
    es: 'Invita a seguir por privado; pedidos, pagos o reclamos sensibles → equipo.',
    en: 'Invites a private conversation; sensitive order, payment or complaint issues → team.',
  },
  audit4PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit4RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit5Title: {
    es: '06 · Salud, certificados o críticas a la publicidad',
    en: '06 · Health, certificates or advertising criticism',
  },
  audit5Difference: {
    es: 'Son reglas específicas de Pilar; no se deben copiar automáticamente a otro negocio.',
    en: 'These are Pilar-specific rules; they should not be copied automatically to another business.',
  },
  audit5P0: {
    es: 'Consulta de salud → no afirma seguridad para una condición; sugiere consultar al dermatólogo.',
    en: 'Health question → does not assert safety for a condition; suggests consulting a dermatologist.',
  },
  audit5P1: {
    es: 'Certificado/registro → solo afirma datos cargados y verificables.',
    en: 'Certificate/registration → states only recorded, verifiable information.',
  },
  audit5P2: {
    es: 'Crítica al contenido → no inventa cómo fue producido. Reacción adversa real → escala.',
    en: 'Content criticism → does not invent how it was produced. Actual adverse reaction → escalates.',
  },
  audit5R0: {
    es: 'No tiene la guía especializada de cosmética.',
    en: 'Does not have cosmetics-specific guidance.',
  },
  audit5R1: {
    es: 'Responde con catálogo verificado; reclamos o datos que no puede verificar → equipo.',
    en: 'Uses verified catalog information; complaints or unverifiable details → team.',
  },
  audit5PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit5RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit6Title: {
    es: '07 · Abandona el carrito y no vuelve',
    en: '07 · Abandons checkout and does not return',
  },
  audit6Difference: {
    es: 'Pilar: 1 intento. Rasmiaw: 2 programados; el segundo puede bloquearse por enfriamiento de 24 h y el descuento no está demostrado por estos pasos. Tiempos nominales, sujetos al planificador.',
    en: 'Pilar: 1 attempt. Rasmiaw: 2 scheduled; the second may be blocked by the 24 h cooldown and these steps do not establish discount application. Nominal timing is subject to scheduling.',
  },
  audit6P0: {
    es: 'Marca el contacto y espera 15 minutos desde el disparo del flujo.',
    en: 'Tags the contact and waits 15 minutes from the flow trigger.',
  },
  audit6P1: {
    es: 'Si no compró, no tiene rechazo abierto en 48 h y no recibió plantilla en 48 h → envía un recordatorio.',
    en: 'If no purchase, no open rejection in 48 h and no template in 48 h → sends one reminder.',
  },
  audit6P2: {
    es: 'Botón actual: página del sérum, no el checkout individual.',
    en: 'Current button: serum product page, not the individual checkout.',
  },
  audit6P3: {
    es: 'Espera 48 h; si detecta compra desde el disparo → añade etiqueta de recuperación.',
    en: 'Waits 48 h; if a purchase is found since the trigger → adds a recovery tag.',
  },
  audit6R0: {
    es: 'Espera 1 hora desde el disparo.',
    en: 'Waits 1 hour from the trigger.',
  },
  audit6R1: {
    es: 'Si no hay rechazo abierto ni compra desde el disparo → primer mensaje.',
    en: 'If no open rejection or purchase since the trigger → first message.',
  },
  audit6R2: {
    es: 'Primer botón: producto asociado al carrito.',
    en: 'First button: product associated with the cart.',
  },
  audit6R3: {
    es: 'Espera 23 h; si no compró → intenta segundo mensaje con enlace al checkout y texto de 10%.',
    en: 'Waits 23 h; if no purchase → attempts a second message with checkout link and 10% wording.',
  },
  audit6PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit6RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit7Title: {
    es: '08 · Compra durante la espera del carrito',
    en: '08 · Purchases while cart recovery is waiting',
  },
  audit7Difference: {
    es: 'La compra prevalece sobre el rescate, siempre que el evento y el contacto se identifiquen correctamente.',
    en: 'Purchase takes precedence over recovery when event and contact matching succeed.',
  },
  audit7P0: {
    es: 'Pedido nuevo identificado para el contacto → cancela esperas de carrito.',
    en: 'New order identified for the contact → cancels pending cart recovery.',
  },
  audit7P1: {
    es: 'La condición de compra también puede impedir el recordatorio.',
    en: 'The purchase condition can also prevent the reminder.',
  },
  audit7R0: {
    es: 'Pedido nuevo identificado para el contacto → cancela esperas de carrito.',
    en: 'New order identified for the contact → cancels pending cart recovery.',
  },
  audit7R1: {
    es: 'Antes de cada intento se consulta si compró.',
    en: 'Checks for a purchase before each attempt.',
  },
  audit7PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit7RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit8Title: {
    es: '09 · Hay pago rechazado y carrito abierto',
    en: '09 · Rejected payment and open checkout',
  },
  audit8Difference: {
    es: 'En Rasmiaw no se debe prometer detección completa de rechazos hasta conectar la fuente.',
    en: 'Do not promise complete rejection detection in Rasmiaw until the source is connected.',
  },
  audit8P0: {
    es: 'El carrito busca un rechazo sin resolver de las últimas 48 h.',
    en: 'Cart flow checks for an unresolved rejection in the last 48 h.',
  },
  audit8P1: {
    es: 'Si existe → no envía carrito; corresponde el flujo de pago rechazado.',
    en: 'If found → no cart reminder; rejected-payment flow takes precedence.',
  },
  audit8R0: {
    es: 'El carrito busca rechazo sin resolver desde el disparo.',
    en: 'Cart flow checks for an unresolved rejection since the trigger.',
  },
  audit8R1: {
    es: 'Si lo detecta → no envía carrito.',
    en: 'If found → does not send cart recovery.',
  },
  audit8R2: {
    es: 'La recuperación de rechazo está bloqueada por Mercado Pago pendiente.',
    en: 'Rejected-payment recovery is blocked by the missing Mercado Pago connection.',
  },
  audit8PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit8RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit9Title: {
    es: '10 · Responde al recordatorio de carrito',
    en: '10 · Replies to cart reminder',
  },
  audit9Difference: {
    es: 'Responder no cancela universalmente las automatizaciones. La parada por respuesta está configurada solo en ciertos flujos.',
    en: 'Replying does not cancel every automation. Reply-based stopping is configured only in some flows.',
  },
  audit9P0: {
    es: 'Responde la Asesora según contexto y reglas.',
    en: 'Advisor responds using context and rules.',
  },
  audit9P1: {
    es: 'El flujo activo no tiene parada por respuesta; queda una revisión de compra a las 48 h, sin otro mensaje de carrito.',
    en: 'Active flow has no reply-based stop; a purchase check remains at 48 h, with no further cart message.',
  },
  audit9R0: {
    es: 'La plantilla asigna el chat a Rasmiaw Recuperación y conserva el contexto.',
    en: 'Template assigns the chat to Rasmiaw Recovery and preserves context.',
  },
  audit9R1: {
    es: 'El flujo de carrito no tiene parada por respuesta.',
    en: 'Cart flow has no reply-based stop.',
  },
  audit9R2: {
    es: 'Puede seguir pendiente el segundo intento; compra, baja o barreras de envío pueden impedirlo.',
    en: 'The second attempt may remain pending; purchase, opt-out or send gates may prevent it.',
  },
  audit9PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit9RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit10Title: {
    es: '11 · Rechazan el pago y aún no compra',
    en: '11 · Payment rejected and no purchase yet',
  },
  audit10Difference: {
    es: 'La descripción de Pilar dice 3 horas, pero el paso guardado dice 10 minutos. Se representa el paso real.',
    en: 'Pilar description says 3 hours, but the saved step says 10 minutes. The map follows the actual step.',
  },
  audit10P0: {
    es: 'Espera 10 minutos desde el disparo.',
    en: 'Waits 10 minutes from the trigger.',
  },
  audit10P1: {
    es: 'Si no compró y no recibió plantilla en 48 h → envía aviso de rechazo con nombre e importe.',
    en: 'If no purchase and no template in 48 h → sends rejection notice with name and amount.',
  },
  audit10P2: {
    es: 'Añade etiqueta; si responde, la IA atiende.',
    en: 'Adds a tag; AI handles a reply.',
  },
  audit10R0: {
    es: 'Hoy no se ejecuta: pendiente conectar Mercado Pago.',
    en: 'Does not run today: Mercado Pago connection pending.',
  },
  audit10R1: {
    es: 'Preparado: aviso de rechazo → contexto de beneficio 5% → espera 24 h.',
    en: 'Prepared: rejection notice → 5% benefit context → 24 h wait.',
  },
  audit10R2: {
    es: 'Si responde durante la espera, el flujo preparado cede a Recuperación.',
    en: 'If a reply arrives during the wait, the prepared flow hands off to Recovery.',
  },
  audit10PS: {
    es: 'Activo',
    en: 'Active',
  },
  audit10RS: {
    es: 'Bloqueado',
    en: 'Blocked',
  },
  audit11Title: {
    es: '12 · Paga antes del aviso de rechazo',
    en: '12 · Pays before rejection notice',
  },
  audit11Difference: {
    es: 'No asumir que ambos flujos tienen las mismas condiciones de cancelación.',
    en: 'Do not assume both flows have the same cancellation conditions.',
  },
  audit11P0: {
    es: 'La consulta de compra detecta que ya compró → no envía el aviso.',
    en: 'Purchase check finds a purchase → does not send the notice.',
  },
  audit11R0: {
    es: 'Flujo de rechazo inactivo.',
    en: 'Rejection flow inactive.',
  },
  audit11R1: {
    es: 'Su definición preparada no incluye una condición de compra antes del primer aviso; debe validarse al conectarlo.',
    en: 'Prepared definition has no purchase condition before the initial notice; validate this when connecting it.',
  },
  audit11PS: {
    es: 'Activo',
    en: 'Active',
  },
  audit11RS: {
    es: 'Bloqueado',
    en: 'Blocked',
  },
  audit12Title: {
    es: '13 · Entra un pedido ya pagado',
    en: '13 · A paid order is created',
  },
  audit12Difference: {
    es: 'Pilar usa un mensaje común; Rasmiaw bifurca por estado financiero.',
    en: 'Pilar uses one common message; Rasmiaw branches by financial status.',
  },
  audit12P0: {
    es: 'Envía la plantilla genérica de nuevo pedido.',
    en: 'Sends the generic new-order template.',
  },
  audit12P1: {
    es: 'El mismo texto incluye instrucciones para transferencia y para otros medios; no hay bifurcación por estado.',
    en: 'The same text includes transfer and other-payment instructions; no status branch exists.',
  },
  audit12R0: {
    es: 'Comprueba estado pagado.',
    en: 'Checks for paid status.',
  },
  audit12R1: {
    es: 'Envía aviso de preparación y personalización.',
    en: 'Sends preparation and customization notice.',
  },
  audit12R2: {
    es: 'Termina; no entra a la secuencia de beneficio.',
    en: 'Ends; does not enter the benefit sequence.',
  },
  audit12PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit12RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit13Title: {
    es: '14 · Entra un pedido pendiente de pago',
    en: '14 · A pending-payment order is created',
  },
  audit13Difference: {
    es: 'La rama de Rasmiaw verifica pending, no el método contra entrega. También podría incluir otros pedidos pendientes. Último aviso nominal: 27 h; final: 51 h.',
    en: 'Rasmiaw checks pending status, not the cash-on-delivery gateway. Other pending orders may enter. Nominal final notice: 27 h; end: 51 h.',
  },
  audit13P0: {
    es: 'Envía el mensaje genérico; solicita comprobante si eligió transferencia.',
    en: 'Sends the generic message; requests a receipt if transfer was selected.',
  },
  audit13P1: {
    es: 'Los recordatorios a 1, 6 y 24 h están en un flujo apagado.',
    en: 'Reminders at 1, 6 and 24 h are in a disabled flow.',
  },
  audit13R0: {
    es: 'Estado pending → aviso de preparación.',
    en: 'Pending status → preparation notice.',
  },
  audit13R1: {
    es: 'Espera 3 segundos → ofrece 5% por cambiar forma de pago; guarda etapa 5%.',
    en: 'Waits 3 seconds → offers 5% for changing payment method; saves 5% stage.',
  },
  audit13R2: {
    es: 'Espera 3 h → recordatorio 5%.',
    en: 'Waits 3 h → 5% reminder.',
  },
  audit13R3: {
    es: 'Espera otras 24 h → ofrece 10%; espera final 24 h.',
    en: 'Waits another 24 h → offers 10%; final 24 h wait.',
  },
  audit13PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit13RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit14Title: {
    es: '15 · Pedido autorizado, parcial u otro estado',
    en: '15 · Authorized, partial or other order status',
  },
  audit14Difference: {
    es: 'No todos los estados financieros reciben la misma comunicación.',
    en: 'Financial statuses do not all receive the same communication.',
  },
  audit14P0: {
    es: 'No hay condición de estado en Nuevo pedido.',
    en: 'New order has no status condition.',
  },
  audit14P1: {
    es: 'Puede enviar el mismo mensaje genérico, sujeto a barreras del motor.',
    en: 'May send the same generic message, subject to engine gates.',
  },
  audit14R0: {
    es: 'No coincide con paid ni pending.',
    en: 'Matches neither paid nor pending.',
  },
  audit14R1: {
    es: 'La definición termina sin mensaje en esa rama.',
    en: 'Definition ends without a message in that branch.',
  },
  audit14PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit14RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit15Title: {
    es: '16 · Pulsa CONFIRMAR',
    en: '16 · Presses CONFIRMAR',
  },
  audit15Difference: {
    es: 'CONFIRMAR mantiene el método original; no cobra ni aplica un descuento.',
    en: 'CONFIRMAR keeps the original method; it does not charge or apply a discount.',
  },
  audit15P0: {
    es: 'No hay un botón ni una secuencia equivalente en el flujo activo.',
    en: 'No equivalent button or sequence exists in the active flow.',
  },
  audit15P1: {
    es: 'La Asesora interpreta el mensaje dentro de la conversación.',
    en: 'Advisor interprets the message within the conversation.',
  },
  audit15R0: {
    es: 'En la secuencia de nuevo pedido: cancela esperas pendientes y conserva contexto.',
    en: 'In the new-order sequence: cancels pending waits and retains context.',
  },
  audit15R1: {
    es: 'Recuperación interpreta mantener contra entrega; no habilita checkout ni cupón.',
    en: 'Recovery interprets this as keeping cash on delivery; no checkout or coupon is enabled.',
  },
  audit15R2: {
    es: 'No equivale a pago acreditado ni demuestra una actualización logística automática.',
    en: 'This is not credited payment and does not establish an automatic logistics update.',
  },
  audit15PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit15RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit16Title: {
    es: '17 · Pulsa BENEFICIO o SI y ya existe pedido',
    en: '17 · Presses BENEFICIO or SI with an existing order',
  },
  audit16Difference: {
    es: 'El descuento ofrecido sobre un pedido existente requiere gestión humana. No es una conversión de pago automática.',
    en: 'The offered discount on an existing order requires human handling. It is not an automatic payment conversion.',
  },
  audit16P0: {
    es: 'No tiene ese recorrido específico configurado.',
    en: 'No equivalent configured path.',
  },
  audit16P1: {
    es: 'Una excepción comercial debe revisarse con las condiciones del negocio.',
    en: 'A commercial exception must be reviewed against business conditions.',
  },
  audit16R0: {
    es: 'BENEFICIO con etapa 5%/10%, o SI con etapa 10% → petición de cambio de pago.',
    en: 'BENEFICIO at 5%/10%, or SI at 10% → payment-change request.',
  },
  audit16R1: {
    es: 'Marca que necesita una persona y avisa al comercio.',
    en: 'Flags human assistance and alerts the business.',
  },
  audit16R2: {
    es: 'No crea cupón, nuevo checkout ni pedido duplicado; el equipo gestiona el pedido actual.',
    en: 'Creates no coupon, checkout or duplicate order; the team handles the existing order.',
  },
  audit16PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit16RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit17Title: {
    es: '18 · Pulsa ambos botones o SI antes de tiempo',
    en: '18 · Presses both buttons or SI too early',
  },
  audit17Difference: {
    es: 'La decisión depende del contexto guardado, no solo de la palabra escrita.',
    en: 'Decision depends on saved context, not just the word typed.',
  },
  audit17P0: {
    es: 'Sin recorrido de botones equivalente.',
    en: 'No equivalent button path.',
  },
  audit17R0: {
    es: 'Con pedido existente y botones en conflicto → CONFIRMAR tiene prioridad.',
    en: 'With an existing order and conflicting buttons → CONFIRMAR takes priority.',
  },
  audit17R1: {
    es: 'SI con etapa 5% no activa el beneficio.',
    en: 'SI at the 5% stage does not activate the benefit.',
  },
  audit17R2: {
    es: 'BENEFICIO sin etapa válida tampoco habilita un descuento.',
    en: 'BENEFICIO without a valid stage does not enable a discount.',
  },
  audit17PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit17RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit18Title: {
    es: '19 · Pide beneficio y todavía no existe pedido',
    en: '19 · Requests a benefit without an existing order',
  },
  audit18Difference: {
    es: 'La capacidad condicional existe en el código; no significa que cada flujo actual la active.',
    en: 'The conditional capability exists in code; this does not mean every current flow activates it.',
  },
  audit18P0: {
    es: 'Tope de descuento configurado: 0%.',
    en: 'Configured discount cap: 0%.',
  },
  audit18P1: {
    es: 'No hay beneficio de recuperación equivalente.',
    en: 'No equivalent recovery benefit.',
  },
  audit18R0: {
    es: 'Solo Recuperación + etapa válida de 5% o 10% + botón válido habilitan checkout de beneficio.',
    en: 'Only Recovery + a valid 5% or 10% stage + valid button enable a benefit checkout.',
  },
  audit18R1: {
    es: 'El carrito activo no guarda ninguna etapa de beneficio.',
    en: 'The active cart flow does not save a benefit stage.',
  },
  audit18R2: {
    es: 'Ofrecer descuento está apagado en Recuperación; no se puede prometer cupón automático en todos los rescates.',
    en: 'Offer-discount tool is disabled for Recovery; automatic coupons cannot be promised for every recovery.',
  },
  audit18PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit18RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit19Title: {
    es: '20 · No responde a la oferta de contra entrega',
    en: '20 · Does not reply to the cash-on-delivery offer',
  },
  audit19Difference: {
    es: 'Fin de secuencia no equivale a cancelar pedido ni a hacer caducar un cupón en Shopify.',
    en: 'Sequence end is not order cancellation or Shopify coupon expiry.',
  },
  audit19P0: {
    es: 'No existe una secuencia activa equivalente.',
    en: 'No equivalent active sequence.',
  },
  audit19R0: {
    es: 'Continúan los recordatorios programados: 5% y después 10%.',
    en: 'Scheduled reminders continue: 5%, then 10%.',
  },
  audit19R1: {
    es: 'El último texto indica vigencia de 24 h.',
    en: 'Final text states a 24 h validity period.',
  },
  audit19R2: {
    es: 'La espera final termina sin acción explícita de cancelar pedido ni limpiar el beneficio.',
    en: 'Final wait ends with no explicit order cancellation or benefit-clearing step.',
  },
  audit19PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit19RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit20Title: {
    es: '21 · Paga durante la secuencia de contra entrega',
    en: '21 · Pays during the cash-on-delivery sequence',
  },
  audit20Difference: {
    es: 'Pendiente validar/corregir antes de prometer que el pago siempre detiene los recordatorios de Rasmiaw.',
    en: 'Validate/fix before promising that payment always stops Rasmiaw reminders.',
  },
  audit20P0: {
    es: 'No hay recordatorios de pago pendiente activos.',
    en: 'No active pending-payment reminders.',
  },
  audit20R0: {
    es: 'El flujo guardado no vuelve a consultar order_paid entre recordatorios.',
    en: 'Saved flow does not recheck order_paid between reminders.',
  },
  audit20R1: {
    es: 'La compra cancela recuperación de carrito, pero no se ve una cancelación equivalente de esta secuencia por pago.',
    en: 'Purchase cancels cart recovery, but no equivalent payment-based cancellation is visible for this sequence.',
  },
  audit20R2: {
    es: 'Si responde por chat, sí puede detener las esperas configuradas.',
    en: 'A chat reply can stop the configured waits.',
  },
  audit20PS: {
    es: 'Sin secuencia activa',
    en: 'No active sequence',
  },
  audit20RS: {
    es: 'Revisión necesaria',
    en: 'Review needed',
  },
  audit21Title: {
    es: '22 · Se despacha el pedido',
    en: '22 · Order is fulfilled',
  },
  audit21Difference: {
    es: 'Pilar envía URL; Rasmiaw, número de guía. El envío de Rasmiaw también asigna Recuperación, aunque el caso sea posventa.',
    en: 'Pilar sends a URL; Rasmiaw a tracking number. Rasmiaw shipping also assigns Recovery, even for support cases.',
  },
  audit21P0: {
    es: 'Evento de fulfillment → envía plantilla con enlace de seguimiento.',
    en: 'Fulfillment event → sends tracking-link template.',
  },
  audit21P1: {
    es: 'El mensaje menciona el pedido despachado; dudas posteriores pasan a la Asesora.',
    en: 'Message reports shipment; later questions go to the Advisor.',
  },
  audit21R0: {
    es: 'Evento de fulfillment → envía plantilla con número de guía.',
    en: 'Fulfillment event → sends tracking-number template.',
  },
  audit21R1: {
    es: 'La automatización asigna Recuperación como IA del chat.',
    en: 'Automation assigns Recovery as the chat AI.',
  },
  audit21PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit21RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit22Title: {
    es: '23 · Pregunta dónde está su pedido',
    en: '23 · Asks where the order is',
  },
  audit22Difference: {
    es: 'La IA informa lo verificado; no inventa fechas ni confirma entregas sin evidencia.',
    en: 'AI reports verified information; it does not invent dates or confirm delivery without evidence.',
  },
  audit22P0: {
    es: 'Consulta el pedido antes de afirmar el estado.',
    en: 'Looks up the order before stating its status.',
  },
  audit22P1: {
    es: 'Con datos verificados → responde estado y seguimiento.',
    en: 'With verified data → replies with status and tracking.',
  },
  audit22R0: {
    es: 'Consulta pedido; si faltan datos, pide número de pedido o teléfono/correo de compra.',
    en: 'Looks up order; if needed, asks for order number or purchase phone/email.',
  },
  audit22R1: {
    es: 'Con datos verificados → responde; sin guía o con excepción → equipo.',
    en: 'With verified data → replies; missing tracking or an exception → team.',
  },
  audit22PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit22RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit23Title: {
    es: '24 · No llegó, llegó mal o va a otra dirección',
    en: '24 · Missing, wrong or misrouted delivery',
  },
  audit23Difference: {
    es: 'Las excepciones logísticas necesitan una persona en ambos negocios.',
    en: 'Logistics exceptions require a person in both businesses.',
  },
  audit23P0: {
    es: 'El detector reconoce un problema operativo real.',
    en: 'Detector recognizes an actual operational issue.',
  },
  audit23P1: {
    es: 'Marca intervención humana y avisa al comercio.',
    en: 'Flags human intervention and alerts the business.',
  },
  audit23R0: {
    es: 'Demora, guía inválida, envío incorrecto o entregado no recibido → escala.',
    en: 'Delay, invalid tracking, wrong shipment or delivered-but-not-received → escalates.',
  },
  audit23R1: {
    es: 'El equipo revisa y resuelve; la IA no promete fecha ni compensación.',
    en: 'Team reviews and resolves; AI does not promise dates or compensation.',
  },
  audit23PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit23RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit24Title: {
    es: '25 · Transferencia, comprobante o cambio de pago',
    en: '25 · Transfer, receipt or payment change',
  },
  audit24Difference: {
    es: 'El equipo verifica el cobro real antes de confirmar el pago y continuar la operación.',
    en: 'Team verifies actual payment before confirming and continuing operations.',
  },
  audit24P0: {
    es: 'Nuevo pedido solicita comprobante cuando corresponde.',
    en: 'New-order message requests a receipt where applicable.',
  },
  audit24P1: {
    es: 'El detector de comprobante/pago informado puede derivar a revisión; decir que pagó no acredita fondos.',
    en: 'Receipt/reported-payment detection may escalate for review; saying payment was made does not credit funds.',
  },
  audit24R0: {
    es: 'Transferencia, Llave, Bold, Addi, Bancolombia o comprobante → equipo.',
    en: 'Transfer, Llave, Bold, Addi, Bancolombia or receipt → team.',
  },
  audit24R1: {
    es: 'La IA no valida pago, libera pedido ni inventa datos bancarios.',
    en: 'AI does not validate payment, release the order or invent banking details.',
  },
  audit24PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit24RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit25Title: {
    es: '26 · Cambio, cancelación, devolución o reembolso',
    en: '26 · Change, cancellation, return or refund',
  },
  audit25Difference: {
    es: 'No presentar devoluciones o reembolsos como decisiones autónomas de la IA.',
    en: 'Do not present returns or refunds as autonomous AI decisions.',
  },
  audit25P0: {
    es: 'Detecta la solicitud y deriva el problema.',
    en: 'Detects the request and escalates the issue.',
  },
  audit25P1: {
    es: 'Hay permisos heredados más amplios; cancelación y reembolso exigen aprobación en el motor.',
    en: 'Broader legacy permissions exist; cancellation and refund require engine approval.',
  },
  audit25R0: {
    es: 'Escala al equipo con contexto.',
    en: 'Escalates to the team with context.',
  },
  audit25R1: {
    es: 'Editar, cancelar, reembolsar y abrir devolución están apagados en Guía Global.',
    en: 'Edit, cancel, refund and open-return tools are disabled for Global Guide.',
  },
  audit25PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit25RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit26Title: {
    es: '27 · Quiere retirar en una sucursal',
    en: '27 · Wants branch pickup',
  },
  audit26Difference: {
    es: 'La regla de Andreani es propia de Pilar, no una condición compartida.',
    en: 'The Andreani rule belongs to Pilar, not both businesses.',
  },
  audit26P0: {
    es: 'Antes de comprar: guía para indicar un Punto Hop de Andreani como dirección.',
    en: 'Before purchase: guides the customer to enter an Andreani Punto Hop address.',
  },
  audit26P1: {
    es: 'Con pedido existente: pasa al equipo para gestionar el cambio de envío.',
    en: 'With an existing order: sends to the team to handle the shipping change.',
  },
  audit26R0: {
    es: 'No hay una regla de retiro equivalente en la guía consultada.',
    en: 'No equivalent pickup rule in the reviewed guidance.',
  },
  audit26R1: {
    es: 'Verifica condiciones de la tienda; si falta el dato → equipo.',
    en: 'Checks store conditions; missing information → team.',
  },
  audit26PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit26RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit27Title: {
    es: '28 · Se queda en silencio tras hablar con la IA',
    en: '28 · Goes silent after an AI conversation',
  },
  audit27Difference: {
    es: 'Un recordatorio de automatización y un seguimiento de IA son mecanismos distintos.',
    en: 'Automation reminders and AI follow-ups are separate mechanisms.',
  },
  audit27P0: {
    es: 'Seguimiento propio de la Asesora apagado.',
    en: 'Advisor follow-up is disabled.',
  },
  audit27P1: {
    es: 'No se programa una insistencia de IA a 24 h por ese ajuste.',
    en: 'This setting does not schedule an AI nudge at 24 h.',
  },
  audit27R0: {
    es: 'Seguimiento propio apagado en Guía Global y Recuperación.',
    en: 'Follow-up disabled for Global Guide and Recovery.',
  },
  audit27R1: {
    es: 'Pueden quedar esperas de automatizaciones: se rigen por sus propias condiciones.',
    en: 'Automation waits may remain: they follow their own conditions.',
  },
  audit27PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit27RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit28Title: {
    es: '29 · Recompra o encuesta después de recibir',
    en: '29 · Reorder or post-delivery survey',
  },
  audit28Difference: {
    es: 'Son oportunidades a diseñar y activar; no forman parte de los flujos actuales revisados.',
    en: 'These are opportunities to design and activate, not part of the reviewed current flows.',
  },
  audit28P0: {
    es: 'Hay definiciones históricas eliminadas de recompra y encuesta.',
    en: 'Historical reorder and survey definitions are deleted.',
  },
  audit28P1: {
    es: 'No aparecen flujos vigentes de estas categorías en la consulta.',
    en: 'No current flows in these categories appear in the query.',
  },
  audit28R0: {
    es: 'No aparecen flujos vigentes de recompra ni encuesta.',
    en: 'No current reorder or survey flows appear.',
  },
  audit28PS: {
    es: 'Sin flujo vigente',
    en: 'No current flow',
  },
  audit28RS: {
    es: 'Sin flujo vigente',
    en: 'No current flow',
  },
  audit29Title: {
    es: '30 · Llamada de confirmación',
    en: '30 · Confirmation call',
  },
  audit29Difference: {
    es: 'La disponibilidad real de llamadas exige validar línea y enrutamiento. El flujo de Pilar es una prueba inactiva.',
    en: 'Actual calling availability requires line and routing validation. Pilar flow is an inactive test.',
  },
  audit29P0: {
    es: 'Agente de voz test activo, con recepción de llamadas habilitada en configuración.',
    en: 'Voice agent test is active, with inbound calling enabled in settings.',
  },
  audit29P1: {
    es: 'Flujo de prueba contra entrega apagado; solo llama si el método coincide con Cash on Delivery.',
    en: 'Test COD flow is disabled; only calls if gateway matches Cash on Delivery.',
  },
  audit29P2: {
    es: 'No hay llamada automática de producción demostrada por este flujo.',
    en: 'This flow does not establish production automated calling.',
  },
  audit29R0: {
    es: 'Guía Global y Recuperación tienen voz apagada.',
    en: 'Global Guide and Recovery have voice disabled.',
  },
  audit29PS: {
    es: 'Prueba inactiva',
    en: 'Inactive test',
  },
  audit29RS: {
    es: 'Desactivado',
    en: 'Disabled',
  },
  audit30Title: {
    es: '31 · Pide una persona o alguien del equipo toma el chat',
    en: '31 · Asks for a person or team takes over',
  },
  audit30Difference: {
    es: 'Asignar un chat y marcar que necesita atención humana no son la misma condición.',
    en: 'Assigning a chat and flagging human attention are not the same condition.',
  },
  audit30P0: {
    es: 'Pedido explícito de persona → detector de escalada y aviso.',
    en: 'Explicit request for a person → escalation detector and alert.',
  },
  audit30P1: {
    es: 'Asesora: no responde cuando el chat está asignado a un humano, según su ajuste.',
    en: 'Advisor: configured not to reply when a chat is assigned to a human.',
  },
  audit30R0: {
    es: 'Pedido de persona → escala y avisa.',
    en: 'Request for a person → escalates and alerts.',
  },
  audit30R1: {
    es: 'Ambos agentes tienen responder estando asignado habilitado; el freno depende además del estado de atención humana.',
    en: 'Both agents allow replies while assigned; stopping also depends on the human-attention state.',
  },
  audit30PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit30RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit31Title: {
    es: '32 · Pide no recibir más mensajes',
    en: '32 · Opts out of messages',
  },
  audit31Difference: {
    es: 'Aplica también a avisos transaccionales en el motor revisado; no basta con terminar una conversación.',
    en: 'Also applies to transactional notifications in the reviewed engine; merely ending a conversation is different.',
  },
  audit31P0: {
    es: 'Baja registrada → barrera de envío impide mensajes del motor.',
    en: 'Recorded opt-out → send gate prevents engine messages.',
  },
  audit31R0: {
    es: 'Baja registrada → barrera de envío impide mensajes del motor.',
    en: 'Recorded opt-out → send gate prevents engine messages.',
  },
  audit31PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit31RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit32Title: {
    es: '33 · IA acaba de escribir o ya salió una plantilla',
    en: '33 · AI just replied or a template was recently sent',
  },
  audit32Difference: {
    es: 'Tracking y carrito están exentos de la barrera de IA reciente, pero conservan otras barreras de envío.',
    en: 'Tracking and cart are exempt from the recent-AI guard but retain other send gates.',
  },
  audit32P0: {
    es: 'Nuevo pedido y otros avisos conversacionales pueden omitirse si IA/humano escribió hace menos de 5 minutos.',
    en: 'New-order and other conversational notices may be skipped if AI/human replied within 5 minutes.',
  },
  audit32P1: {
    es: 'Carrito y rechazo incluyen condición de no plantilla en 48 h.',
    en: 'Cart and rejection flows include a no-template-in-48-h condition.',
  },
  audit32R0: {
    es: 'Nuevo pedido también puede omitirse por la protección de mensaje reciente.',
    en: 'New order may also be skipped by the recent-message guard.',
  },
  audit32R1: {
    es: 'Carrito: barrera compartida de 24 h; segundo intento a 23 h puede bloquearse.',
    en: 'Cart: shared 24 h gate; a second attempt after 23 h may be blocked.',
  },
  audit32PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit32RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit33Title: {
    es: '34 · Canal sin conexión, teléfono inválido o envío bloqueado',
    en: '34 · Disconnected channel, invalid phone or blocked send',
  },
  audit33Difference: {
    es: 'Activo significa habilitado en configuración. Esta revisión no prueba entrega de extremo a extremo ni salud completa de integraciones.',
    en: 'Active means enabled in settings. This review does not prove end-to-end delivery or complete integration health.',
  },
  audit33P0: {
    es: 'Sin teléfono válido o conexión → el intento falla.',
    en: 'No valid phone or connection → attempt fails.',
  },
  audit33P1: {
    es: 'Baja, cupo o ventana de texto libre pueden impedir la salida; se registra el motivo.',
    en: 'Opt-out, quota or free-text window may prevent sending; reason is recorded.',
  },
  audit33R0: {
    es: 'Mismas barreras del motor.',
    en: 'Same engine gates.',
  },
  audit33R1: {
    es: 'Plantilla aprobada no garantiza entrega: canal, destinatario y condiciones de envío siguen aplicando.',
    en: 'Approved template does not guarantee delivery: channel, recipient and send conditions still apply.',
  },
  audit33PS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit33RS: {
    es: 'Activo / reglas de IA',
    en: 'Active / AI rules',
  },
  audit34Title: {
    es: '35 · Activar los borradores de Pilar',
    en: '35 · Activate Pilar drafts',
  },
  audit34Difference: {
    es: 'No activar dos recuperaciones del mismo carrito sin definir cuál debe ejecutarse. En esta tarea no se activó ni modificó nada.',
    en: 'Do not activate two recovery flows for the same cart without deciding which should run. Nothing was activated or modified in this task.',
  },
  audit34P0: {
    es: 'Carrito de 3 intentos apagado: 15 min → 1 h después → 5 h después; se detiene si responde.',
    en: 'Disabled three-attempt cart flow: 15 min → 1 h later → 5 h later; stops on reply.',
  },
  audit34P1: {
    es: 'Revisa compra y mensajes previos; tras el último intento espera 48 h y puede etiquetar recuperación.',
    en: 'Checks purchase and previous messages; waits 48 h after final attempt and may tag recovery.',
  },
  audit34P2: {
    es: 'Pago pendiente apagado: 1 h → 6 h → 24 h desde inicio; reconsulta pago antes de enviar y etiqueta al final.',
    en: 'Disabled pending-payment flow: 1 h → 6 h → 24 h from start; rechecks payment before sending and tags at the end.',
  },
  audit34R0: {
    es: 'No son flujos de Rasmiaw.',
    en: 'These are not Rasmiaw flows.',
  },
  audit34PS: {
    es: 'Borradores apagados',
    en: 'Disabled drafts',
  },
  audit34RS: {
    es: 'No aplica',
    en: 'Not applicable',
  },
  title: {
    es: 'Onboarding',
    en: 'Onboarding',
  },
  description: {
    es: 'Presentaciones, escenarios y decisiones por tienda.',
    en: 'Presentations, scenarios and decisions by store.',
  },
  eyebrow: {
    es: 'DISEÑADO Y CONFIGURADO POR RIVERZ',
    en: 'DESIGNED AND CONFIGURED BY RIVERZ',
  },
  headline: {
    es: 'Tu tienda atiende. Riverz se encarga de los flujos.',
    en: 'Your store serves customers. Riverz handles the flows.',
  },
  intro: {
    es: 'Diseñamos, conectamos y probamos la atención y la posventa de tu negocio. Tú defines las reglas; nosotros construimos la operación.',
    en: 'We design, connect and test customer service and after-sales for your business. You set the rules; we build the operation.',
  },
  pilar: {
    es: 'Pilar',
    en: 'Pilar',
  },
  rasmiaw: {
    es: 'Rasmiaw',
    en: 'Rasmiaw',
  },
  contraentrega: {
    es: '100% contraentrega',
    en: '100% cash on delivery',
  },
  pilarDesc: {
    es: 'Sérum para rostro y cuello · asesoría, recuperación de pagos y seguimiento.',
    en: 'Face and neck serum · advice, payment recovery and tracking.',
  },
  rasmiawDesc: {
    es: 'Productos para gatos · venta asistida y pedidos pendientes.',
    en: 'Cat products · assisted selling and pending orders.',
  },
  contraentregaDesc: {
    es: 'Modelo propuesto · confirmación, entrega y conciliación del recaudo.',
    en: 'Proposed model · confirmation, delivery and collection reconciliation.',
  },
  open: {
    es: 'Abrir presentación',
    en: 'Open presentation',
  },
  back: {
    es: 'Todas las presentaciones',
    en: 'All presentations',
  },
  map: {
    es: 'Servicio completo',
    en: 'Complete service',
  },
  audit: {
    es: 'Comparar operación actual',
    en: 'Compare current operations',
  },
  questions: {
    es: 'Preguntas de onboarding',
    en: 'Onboarding questions',
  },
  print: {
    es: 'Imprimir / PDF',
    en: 'Print / PDF',
  },
  present: {
    es: 'Presentar',
    en: 'Present',
  },
  exit: {
    es: 'Salir de presentación',
    en: 'Exit presentation',
  },
  proposed: {
    es: 'PROPUESTA A CONFIGURAR',
    en: 'PROPOSAL TO CONFIGURE',
  },
  snapshot: {
    es: 'Configuración revisada: 9 sep 2026. No acredita entregas ni sustituye una prueba de extremo a extremo.',
    en: 'Configuration reviewed: Sep 9, 2026. This does not prove delivery or replace end-to-end testing.',
  },
  notAudited: {
    es: 'La tienda contraentrega es un modelo propuesto, sin una cuenta conectada auditada.',
    en: 'The cash-on-delivery store is a proposed model, with no audited connected account.',
  },
  scope: {
    es: 'Una operación conectada, de la primera pregunta a la próxima compra.',
    en: 'One connected operation, from the first question to the next purchase.',
  },
  hub: {
    es: 'IA de Riverz',
    en: 'Riverz AI',
  },
  hubDesc: {
    es: 'Entiende la consulta · consulta datos · ejecuta reglas · entrega contexto al equipo',
    en: 'Understands questions · checks data · applies rules · hands context to the team',
  },
  sources: {
    es: 'WhatsApp · redes sociales · tienda online',
    en: 'WhatsApp · social channels · online store',
  },
  systems: {
    es: 'Catálogo · pedidos · pagos · transportadora',
    en: 'Catalog · orders · payments · carrier',
  },
  human: {
    es: 'Tu equipo decide las excepciones',
    en: 'Your team decides exceptions',
  },
  humanDesc: {
    es: 'La IA recopila la información y entrega el caso. Reembolsos, pagos manuales y cambios sensibles requieren las reglas y aprobaciones acordadas.',
    en: 'AI gathers information and hands over the case. Refunds, manual payments and sensitive changes follow agreed rules and approvals.',
  },
  guard: {
    es: 'Si compra, responde, pide ayuda o solicita no recibir mensajes, aplicamos la salida correspondiente y evitamos seguimientos incompatibles.',
    en: 'If the customer buys, replies, asks for help or opts out, we apply the appropriate exit and prevent conflicting follow-ups.',
  },
  step0: {
    es: 'Atender y vender',
    en: 'Serve and sell',
  },
  step1: {
    es: 'Recuperar la compra',
    en: 'Recover the purchase',
  },
  step2: {
    es: 'Confirmar el pedido',
    en: 'Confirm the order',
  },
  step3: {
    es: 'Entregar y resolver',
    en: 'Deliver and resolve',
  },
  step4: {
    es: 'Acompañar y fidelizar',
    en: 'Support and retain',
  },
  all: {
    es: 'Todos los escenarios',
    en: 'All scenarios',
  },
  when: {
    es: 'Cuando sucede',
    en: 'When this happens',
  },
  action: {
    es: 'Riverz lo resuelve así',
    en: 'How Riverz handles it',
  },
  exception: {
    es: 'Si algo cambia',
    en: 'If something changes',
  },
  decision: {
    es: 'Decisión para configurar',
    en: 'Configuration decision',
  },
  difference: {
    es: 'Diferencia entre marcas',
    en: 'Difference between brands',
  },
  qIntro: {
    es: 'Estas respuestas se convierten en reglas, mensajes y pruebas. El cliente no tiene que dibujar ni crear los flujos.',
    en: 'These answers become rules, messages and tests. The client does not need to draw or build flows.',
  },
  answer: {
    es: 'Respuesta / acuerdo',
    en: 'Answer / agreement',
  },
  export: {
    es: 'Descargar acuerdos',
    en: 'Download decisions',
  },
  answerHint: {
    es: 'Las notas permanecen solo mientras esta página está abierta. Descárgalas antes de salir; no se guardan en la cuenta.',
    en: 'Notes last only while this page is open. Download them before leaving; they are not saved to the account.',
  },
  client: {
    es: 'Nombre del cliente',
    en: 'Client name',
  },
  pending: {
    es: 'Por definir',
    en: 'To be decided',
  },
  deliveryTitle: {
    es: 'Así lo implementamos por ti',
    en: 'How we implement it for you',
  },
  delivery1: {
    es: '01 · Acordamos tus reglas',
    en: '01 · Agree on your rules',
  },
  delivery1Desc: {
    es: 'Productos, promesas, horarios y responsables.',
    en: 'Products, commitments, schedules and owners.',
  },
  delivery2: {
    es: '02 · Riverz construye',
    en: '02 · Riverz builds',
  },
  delivery2Desc: {
    es: 'Conectamos los canales y configuramos IA, mensajes y flujos.',
    en: 'We connect channels and configure AI, messages and flows.',
  },
  delivery3: {
    es: '03 · Probamos juntos',
    en: '03 · Test together',
  },
  delivery3Desc: {
    es: 'Revisamos compras, respuestas, errores y entregas fallidas.',
    en: 'We review purchases, replies, errors and failed deliveries.',
  },
  delivery4: {
    es: '04 · Activamos y medimos',
    en: '04 · Launch and measure',
  },
  delivery4Desc: {
    es: 'Acordamos el alcance, damos seguimiento y ajustamos.',
    en: 'We agree on scope, monitor results and adjust.',
  },
  pilarFocus: {
    es: 'Pilar: asesorar con información verificada, recuperar sin insistir después de la compra y acompañar el uso sin promesas médicas.',
    en: 'Pilar: advise with verified information, stop recovery after purchase and support usage without medical promises.',
  },
  rasmiawFocus: {
    es: 'Rasmiaw: recomendar el producto adecuado, distinguir pago pendiente de contraentrega y aplicar únicamente beneficios autorizados.',
    en: 'Rasmiaw: recommend the right product, distinguish pending payment from cash on delivery and apply only authorized benefits.',
  },
  contraentregaFocus: {
    es: 'Contraentrega: confirmar antes de despachar, resolver novedades y separar pedido entregado, dinero recaudado y dinero recibido por la tienda.',
    en: 'Cash on delivery: confirm before shipping, resolve incidents and distinguish delivery, carrier collection and funds received by the store.',
  },
  pilarGap: {
    es: 'Por implementar o validar: recordatorios de pago pendiente, elección de una sola secuencia de carrito, enlace de recuperación individual y seguimiento posventa. La llamada contraentrega es una prueba inactiva.',
    en: 'To implement or validate: pending-payment reminders, a single cart sequence, individual recovery links and after-sales follow-up. The COD call is an inactive test.',
  },
  rasmiawGap: {
    es: 'Por resolver: conectar Mercado Pago; revisar las 23 h entre intentos frente al límite de 24 h; validar beneficios; filtrar contraentrega por método de pago y volver a consultar el pago antes de cada recordatorio.',
    en: 'To resolve: connect Mercado Pago; review the 23-hour retry against the 24-hour limit; validate benefits; filter COD by payment method and recheck payment before every reminder.',
  },
  contraentregaGap: {
    es: 'Antes de activar: verificar eventos de la transportadora, cobertura, confirmación de pedidos, recaudo y conciliación. Los tiempos y reintentos se definen con el cliente.',
    en: 'Before launch: verify carrier events, coverage, order confirmation, collection and reconciliation. Timing and retries are agreed with the client.',
  },
  readiness: {
    es: 'Preparación para activar',
    en: 'Launch readiness',
  },
  catalogtitle: {
    es: 'Consulta sobre producto',
    en: 'Product question',
  },
  catalogtrigger: {
    es: 'Pregunta por precio, stock o recomendaciones.',
    en: 'Asks about price, stock or recommendations.',
  },
  catalogaction: {
    es: 'La IA consulta catálogo y condiciones del canal, recomienda y comparte el enlace correcto.',
    en: 'AI checks catalog and channel terms, recommends and shares the correct link.',
  },
  catalogexception: {
    es: 'Si falta información verificada, pide el dato o entrega el caso al equipo.',
    en: 'If verified information is missing, it asks for details or hands off.',
  },
  catalogquestion: {
    es: '¿Qué productos, precios y promesas puede comunicar la IA?',
    en: 'Which products, prices and claims may AI communicate?',
  },
  commentstitle: {
    es: 'Comentarios en redes',
    en: 'Social comments',
  },
  commentstrigger: {
    es: 'Una persona pregunta en una publicación.',
    en: 'Someone asks a question on a post.',
  },
  commentsaction: {
    es: 'Respondemos según la intención y continuamos en privado cuando el canal lo permite.',
    en: 'We respond based on intent and continue privately when permitted by the channel.',
  },
  commentsexception: {
    es: 'Datos personales y reclamos pasan a privado; el spam no inicia una venta.',
    en: 'Personal data and complaints move to private chat; spam does not trigger a sale.',
  },
  commentsquestion: {
    es: '¿Qué redes atendemos y qué comentarios requieren una persona?',
    en: 'Which networks do we cover and which comments require a person?',
  },
  checkouttitle: {
    es: 'Compra por conversación',
    en: 'Purchase through chat',
  },
  checkouttrigger: {
    es: 'El cliente quiere comprar.',
    en: 'The customer wants to buy.',
  },
  checkoutaction: {
    es: 'Validamos producto, cantidad y datos; enviamos checkout o creamos el pedido según permisos e integración.',
    en: 'We validate product, quantity and details; send a checkout or create the order based on permissions and integration.',
  },
  checkoutexception: {
    es: 'Sin stock o cobertura, ofrecemos una alternativa aprobada. Evitamos pedidos duplicados.',
    en: 'Without stock or coverage, offer an approved alternative. Prevent duplicate orders.',
  },
  checkoutquestion: {
    es: '¿Venta por enlace o creación de pedido? ¿Quién mantiene stock y precios?',
    en: 'Checkout link or direct order creation? Who maintains stock and prices?',
  },
  carttitle: {
    es: 'Carrito abandonado',
    en: 'Abandoned cart',
  },
  carttrigger: {
    es: 'Deja un checkout sin completar.',
    en: 'Leaves a checkout unfinished.',
  },
  cartaction: {
    es: 'Esperamos el plazo acordado, comprobamos que no compró y enviamos el enlace individual de recuperación.',
    en: 'Wait the agreed time, check there is no purchase and send the individual recovery link.',
  },
  cartexception: {
    es: 'Compra → terminar. Respuesta → IA. Sin respuesta → siguiente intento autorizado o cierre.',
    en: 'Purchase → stop. Reply → AI. No reply → next authorized attempt or close.',
  },
  cartquestion: {
    es: '¿Cuántos intentos, en qué horarios y con qué beneficio máximo?',
    en: 'How many attempts, at what times and with which maximum benefit?',
  },
  rejectedtitle: {
    es: 'Pago rechazado',
    en: 'Rejected payment',
  },
  rejectedtrigger: {
    es: 'La pasarela informa un rechazo.',
    en: 'The gateway reports a rejection.',
  },
  rejectedaction: {
    es: 'Verificamos que siga sin pagar y ofrecemos un medio o enlace autorizado.',
    en: 'Verify it remains unpaid and offer an authorized payment method or link.',
  },
  rejectedexception: {
    es: 'Si ya pagó, detenemos la secuencia. Si envía comprobante, validación humana.',
    en: 'If already paid, stop the sequence. A receipt requires human verification.',
  },
  rejectedquestion: {
    es: '¿Qué pasarela informa rechazos y qué alternativa de pago aceptan?',
    en: 'Which gateway reports rejections and which payment alternatives are accepted?',
  },
  pendingtitle: {
    es: 'Pedido con pago pendiente',
    en: 'Order awaiting payment',
  },
  pendingtrigger: {
    es: 'Se crea un pedido pendiente.',
    en: 'A pending order is created.',
  },
  pendingaction: {
    es: 'Distinguimos transferencia, pasarela y contraentrega antes de elegir el mensaje. Reconsultamos pago en cada intento.',
    en: 'Distinguish transfer, gateway and COD before choosing the message. Recheck payment on every attempt.',
  },
  pendingexception: {
    es: 'Pedido creado no significa pagado. Pago confirmado → preparación; cancelación → detener.',
    en: 'Order created does not mean paid. Verified payment → preparation; cancellation → stop.',
  },
  pendingquestion: {
    es: '¿Cuándo vence un pedido pendiente y quién autoriza cancelarlo?',
    en: 'When does a pending order expire and who approves cancellation?',
  },
  benefittitle: {
    es: 'Confirma o pide beneficio',
    en: 'Confirms or requests a benefit',
  },
  benefittrigger: {
    es: 'Responde CONFIRMAR, BENEFICIO o SÍ.',
    en: 'Replies CONFIRMAR, BENEFICIO or SÍ.',
  },
  benefitaction: {
    es: 'Interpretamos el botón y la etapa. CONFIRMAR conserva contraentrega; un beneficio exige regla y vigencia verificadas.',
    en: 'Interpret the button and stage. CONFIRMAR keeps COD; a benefit requires verified eligibility and validity.',
  },
  benefitexception: {
    es: 'Con pedido existente, el cambio a pago anticipado pasa al equipo; no creamos otro pedido ni marcamos el pago.',
    en: 'For an existing order, switching to prepayment goes to the team; do not create another order or mark it paid.',
  },
  benefitquestion: {
    es: '¿Cuándo se permite 5% o 10% y quién valida el pago del pedido existente?',
    en: 'When is 5% or 10% allowed and who verifies payment on the existing order?',
  },
  receipttitle: {
    es: 'Envía un comprobante',
    en: 'Sends a payment receipt',
  },
  receipttrigger: {
    es: 'Comparte una imagen o afirma que pagó.',
    en: 'Shares an image or says payment was made.',
  },
  receiptaction: {
    es: 'Recopilamos referencia y pedido, pausamos mensajes incompatibles y solicitamos validación.',
    en: 'Collect reference and order, pause conflicting messages and request verification.',
  },
  receiptexception: {
    es: 'Solo la fuente autorizada confirma el pago. Un comprobante no acredita dinero.',
    en: 'Only the authorized source confirms payment. A receipt does not establish funds received.',
  },
  receiptquestion: {
    es: '¿Quién valida pagos y cuánto tiempo tiene para responder?',
    en: 'Who verifies payments and how long do they have to respond?',
  },
  confirmtitle: {
    es: 'Confirmación antes del despacho',
    en: 'Confirmation before dispatch',
  },
  confirmtrigger: {
    es: 'Entra un pedido contraentrega.',
    en: 'A COD order arrives.',
  },
  confirmaction: {
    es: 'Consultamos duplicados y stock; confirmamos producto, total a cobrar, dirección y disponibilidad para recibir.',
    en: 'Check duplicates and stock; confirm product, collection total, address and availability to receive.',
  },
  confirmexception: {
    es: 'Confirmado → habilitar despacho según integración. Rechaza → cancelar según política. Silencio → retener y reintentar.',
    en: 'Confirmed → release for dispatch per integration. Declines → cancel per policy. Silence → hold and retry.',
  },
  confirmquestion: {
    es: '¿Se despacha solo con confirmación? ¿Cuántos intentos antes de cerrar?',
    en: 'Is confirmation required for dispatch? How many attempts before closing?',
  },
  addresstitle: {
    es: 'Dirección incompleta o sin cobertura',
    en: 'Incomplete address or no coverage',
  },
  addresstrigger: {
    es: 'Faltan datos o la zona no tiene entrega.',
    en: 'Details are missing or the area has no service.',
  },
  addressaction: {
    es: 'Pedimos los datos faltantes y validamos cobertura antes de solicitar guía.',
    en: 'Request missing details and validate coverage before requesting a shipping label.',
  },
  addressexception: {
    es: 'Sin cobertura → alternativa aprobada o cancelación; no prometemos una entrega imposible.',
    en: 'No coverage → approved alternative or cancellation; never promise unavailable delivery.',
  },
  addressquestion: {
    es: '¿Qué zonas, recargos, límites de valor y restricciones aplican?',
    en: 'Which areas, surcharges, value limits and restrictions apply?',
  },
  codpaymenttitle: {
    es: 'Solicita descuento o pago anticipado',
    en: 'Requests a discount or prepayment',
  },
  codpaymenttrigger: {
    es: 'Quiere cambiar las condiciones del pedido.',
    en: 'Wants to change order terms.',
  },
  codpaymentaction: {
    es: 'En un modelo 100% contraentrega mantenemos el cobro al recibir y las condiciones aprobadas.',
    en: 'In a 100% COD model, keep payment on receipt and approved terms.',
  },
  codpaymentexception: {
    es: 'Descuentos o excepciones pasan al responsable; no usamos automáticamente el beneficio de Rasmiaw.',
    en: 'Discounts or exceptions go to the owner; do not automatically reuse Rasmiaw benefits.',
  },
  codpaymentquestion: {
    es: '¿Contraentrega es estricta? ¿Hay descuentos autorizados sin cambiar el método?',
    en: 'Is COD mandatory? Are discounts allowed without changing the method?',
  },
  trackingtitle: {
    es: 'Despacho y seguimiento',
    en: 'Dispatch and tracking',
  },
  trackingtrigger: {
    es: 'La tienda o transportadora confirma despacho.',
    en: 'The store or carrier confirms dispatch.',
  },
  trackingaction: {
    es: 'Enviamos la guía y comunicamos los estados disponibles en la integración.',
    en: 'Send tracking and communicate statuses available through the integration.',
  },
  trackingexception: {
    es: 'Sin guía o evento verificable, abrimos seguimiento interno. No inventamos fechas.',
    en: 'Without tracking or a verifiable event, open internal follow-up. Do not invent dates.',
  },
  trackingquestion: {
    es: '¿Qué transportadora usan y qué eventos reales podemos recibir?',
    en: 'Which carrier is used and which real events can we receive?',
  },
  changetitle: {
    es: 'Cambio o cancelación',
    en: 'Change or cancellation',
  },
  changetrigger: {
    es: 'Solicita modificar dirección, producto o pedido.',
    en: 'Requests an address, product or order change.',
  },
  changeaction: {
    es: 'Consultamos la etapa del pedido y recopilamos el cambio solicitado para el responsable.',
    en: 'Check order stage and gather the requested change for the owner.',
  },
  changeexception: {
    es: 'Ya despachado → gestionar con transportadora. No confirmar cambios sin ejecución verificada.',
    en: 'Already dispatched → coordinate with carrier. Do not confirm unverified changes.',
  },
  changequestion: {
    es: '¿Hasta qué estado se puede editar o cancelar y quién aprueba?',
    en: 'Until which state can an order be edited or cancelled and who approves?',
  },
  incidenttitle: {
    es: 'Demora o intento fallido',
    en: 'Delay or failed delivery attempt',
  },
  incidenttrigger: {
    es: 'La transportadora reporta novedad o el cliente reclama.',
    en: 'Carrier reports an incident or the customer complains.',
  },
  incidentaction: {
    es: 'Identificamos causa, pedimos datos útiles y gestionamos reprogramación con la integración o el equipo.',
    en: 'Identify cause, request useful details and coordinate rescheduling through integration or the team.',
  },
  incidentexception: {
    es: 'Sin resolución o fuera del plazo acordado → escalar con historial y responsable.',
    en: 'Unresolved or beyond agreed time → escalate with history and owner.',
  },
  incidentquestion: {
    es: '¿Cuánto esperamos, cuántos reintentos y quién gestiona la novedad?',
    en: 'How long do we wait, how many retries and who handles the incident?',
  },
  refusaltitle: {
    es: 'Rechaza o no tiene el dinero',
    en: 'Refuses or cannot pay',
  },
  refusaltrigger: {
    es: 'El repartidor no puede completar el cobro.',
    en: 'The courier cannot collect payment.',
  },
  refusalaction: {
    es: 'Recogemos el motivo y coordinamos un nuevo intento solo si cliente y transportadora lo permiten.',
    en: 'Collect the reason and coordinate another attempt only if customer and carrier allow it.',
  },
  refusalexception: {
    es: 'Rechazo definitivo → retorno y cierre. Revisamos gastos y excepciones según política aprobada.',
    en: 'Final refusal → return and close. Review costs and exceptions under approved policy.',
  },
  refusalquestion: {
    es: '¿Quién asume flete y retorno? ¿Cuándo se autoriza otro envío?',
    en: 'Who pays shipping and return costs? When is another shipment authorized?',
  },
  collectiontitle: {
    es: 'Entregado, recaudado y conciliado',
    en: 'Delivered, collected and reconciled',
  },
  collectiontrigger: {
    es: 'La transportadora marca entrega y luego reporta recaudo.',
    en: 'The carrier marks delivery and later reports collection.',
  },
  collectionaction: {
    es: 'Separamos entrega, recaudo y abono a la tienda; conciliamos con reportes o integración disponible.',
    en: 'Separate delivery, collection and store settlement; reconcile using reports or available integration.',
  },
  collectionexception: {
    es: 'Faltante, comisión inesperada o abono vencido → alerta al responsable financiero.',
    en: 'Shortfall, unexpected fee or overdue settlement → notify finance owner.',
  },
  collectionquestion: {
    es: '¿Dónde se verifica el recaudo, cada cuánto abonan y quién concilia diferencias?',
    en: 'Where is collection verified, how often is it settled and who reconciles discrepancies?',
  },
  returnstitle: {
    es: 'Producto incorrecto, daño o devolución',
    en: 'Wrong product, damage or return',
  },
  returnstrigger: {
    es: 'Reporta un problema después de recibir.',
    en: 'Reports a problem after delivery.',
  },
  returnsaction: {
    es: 'Recopilamos pedido, motivo y evidencias necesarias; aplicamos la política y entregamos el caso completo.',
    en: 'Gather order, reason and necessary evidence; apply policy and hand over the complete case.',
  },
  returnsexception: {
    es: 'Reposición, devolución o reembolso requieren elegibilidad y aprobación acordadas.',
    en: 'Replacement, return or refund requires agreed eligibility and approval.',
  },
  returnsquestion: {
    es: '¿Plazos, evidencias, exclusiones y responsable de aprobar cada solución?',
    en: 'What are the deadlines, evidence, exclusions and solution approver?',
  },
  caretitle: {
    es: 'Acompañamiento después de recibir',
    en: 'Support after delivery',
  },
  caretrigger: {
    es: 'La entrega está verificada.',
    en: 'Delivery is verified.',
  },
  careaction: {
    es: 'Enviamos instrucciones aprobadas de uso, cuidado o montaje en el momento acordado.',
    en: 'Send approved use, care or assembly instructions at the agreed time.',
  },
  careexception: {
    es: 'Pilar: reacción adversa → atención humana. Rasmiaw: problema de montaje → soporte.',
    en: 'Pilar: adverse reaction → human support. Rasmiaw: assembly issue → support.',
  },
  carequestion: {
    es: '¿Qué guía útil recibe el cliente y cuándo corresponde pedir ayuda humana?',
    en: 'Which helpful guide should the customer receive and when should a human help?',
  },
  satisfactiontitle: {
    es: 'Satisfacción y reseña',
    en: 'Satisfaction and review',
  },
  satisfactiontrigger: {
    es: 'Transcurre el plazo acordado desde la entrega.',
    en: 'The agreed period after delivery passes.',
  },
  satisfactionaction: {
    es: 'Consultamos satisfacción. Si está satisfecho, invitamos a dejar una reseña según la política acordada.',
    en: 'Ask about satisfaction. If satisfied, invite a review under the agreed policy.',
  },
  satisfactionexception: {
    es: 'Si hay un reclamo abierto, priorizamos resolverlo y pausamos promociones.',
    en: 'If there is an open complaint, prioritize resolution and pause promotions.',
  },
  satisfactionquestion: {
    es: '¿Cuándo preguntar y a quién escalar una mala experiencia?',
    en: 'When should we ask and who handles a poor experience?',
  },
  repeattitle: {
    es: 'Recompra o nueva recomendación',
    en: 'Repeat purchase or recommendation',
  },
  repeattrigger: {
    es: 'Llega el momento pertinente para el producto.',
    en: 'The appropriate moment for the product arrives.',
  },
  repeataction: {
    es: 'Usamos compra y preferencias para recomendar solo con consentimiento y reglas del canal.',
    en: 'Use purchases and preferences to recommend only with consent and channel rules.',
  },
  repeatexception: {
    es: 'Baja, compra reciente o caso abierto → excluir. No asumir que todo producto se repone.',
    en: 'Opt-out, recent purchase or open case → exclude. Do not assume every product needs replenishment.',
  },
  repeatquestion: {
    es: '¿Existe un ciclo real de recompra y qué permiso tenemos para contactar?',
    en: 'Is there a real repurchase cycle and what contact permission do we have?',
  },
  handofftitle: {
    es: 'Necesita una persona',
    en: 'Needs a person',
  },
  handofftrigger: {
    es: 'Pide un asesor, hay un caso sensible o falta información.',
    en: 'Requests an advisor, a sensitive case arises or information is missing.',
  },
  handoffaction: {
    es: 'Asignamos responsable con resumen, pedido y próximos pasos; acordamos cuándo se pausa y retoma la IA.',
    en: 'Assign an owner with summary, order and next steps; agree when AI pauses and resumes.',
  },
  handoffexception: {
    es: 'Fuera de horario → comunicar plazo real y dejar el caso en cola. Sin respuesta interna → escalar.',
    en: 'Outside working hours → communicate a real response time and queue the case. No internal response → escalate.',
  },
  handoffquestion: {
    es: '¿Quién recibe cada caso, en qué horario y con qué tiempo máximo de respuesta?',
    en: 'Who receives each case, during which hours and with what response deadline?',
  },
  deliveryfailuretitle: {
    es: 'Mensaje no entregado o integración caída',
    en: 'Undelivered message or integration outage',
  },
  deliveryfailuretrigger: {
    es: 'Un envío falla o falta un evento esperado.',
    en: 'A message fails or an expected event is missing.',
  },
  deliveryfailureaction: {
    es: 'Registramos el fallo, evitamos duplicados y avisamos al responsable con reintentos controlados.',
    en: 'Record failure, prevent duplicates and notify the owner with controlled retries.',
  },
  deliveryfailureexception: {
    es: 'Sin consentimiento o con baja, no reintentamos por otro canal para eludir la preferencia.',
    en: 'Without consent or after opt-out, do not retry through another channel to bypass preference.',
  },
  deliveryfailurequestion: {
    es: '¿Quién recibe alertas y cuál es el canal alternativo autorizado?',
    en: 'Who receives alerts and which alternative channel is authorized?',
  },
  goalQ: {
    es: '¿Qué resultado define que el servicio está funcionando bien y cuál es la situación actual?',
    en: 'What outcome defines successful service and what is the current baseline?',
  },
  goalWhy: {
    es: 'Fijamos métricas de respuesta, conversión, entrega y resolución.',
    en: 'Set response, conversion, delivery and resolution metrics.',
  },
  channelsQ: {
    es: '¿Dónde venden y atienden, qué volumen reciben y quién nos da acceso a cada canal?',
    en: 'Where do you sell and support, what volume arrives and who grants channel access?',
  },
  channelsWhy: {
    es: 'Define conexiones, capacidad y responsables.',
    en: 'Defines connections, capacity and owners.',
  },
  truthQ: {
    es: '¿Cuál es la fuente oficial de precios, stock, promociones y condiciones de envío?',
    en: 'What is the official source of prices, stock, promotions and shipping terms?',
  },
  truthWhy: {
    es: 'La IA responde con datos mantenidos por la tienda.',
    en: 'AI responds using store-maintained data.',
  },
  promiseQ: {
    es: '¿Qué puede prometer la IA y qué debe consultar siempre con una persona?',
    en: 'What may AI promise and what must always go to a person?',
  },
  promiseWhy: {
    es: 'Establece límites, permisos y aprobaciones.',
    en: 'Sets boundaries, permissions and approvals.',
  },
  paymentQ: {
    es: '¿Qué medios de pago aceptan y qué fuente confirma realmente que el dinero llegó?',
    en: 'Which payment methods are accepted and what source confirms funds actually arrived?',
  },
  paymentWhy: {
    es: 'Separa pedido creado, comprobante y pago acreditado.',
    en: 'Separates order creation, receipt and verified payment.',
  },
  recoveryQ: {
    es: '¿Cuántos recordatorios autorizan, en qué plazos y cuándo debemos detenerlos?',
    en: 'How many reminders are allowed, at which intervals and when must they stop?',
  },
  recoveryWhy: {
    es: 'Define esperas, límite de intentos y salidas por compra, respuesta o baja.',
    en: 'Defines waits, attempt limits and exits for purchase, reply or opt-out.',
  },
  logisticsQ: {
    es: '¿Quién despacha, qué transportadoras usan y qué estados y plazos pueden confirmar?',
    en: 'Who dispatches, which carriers are used and which statuses and times can be verified?',
  },
  logisticsWhy: {
    es: 'Conecta seguimiento y gestión de novedades.',
    en: 'Connects tracking and incident handling.',
  },
  changesQ: {
    es: '¿Hasta cuándo se permite cambiar o cancelar un pedido y quién lo ejecuta?',
    en: 'Until when may an order be changed or cancelled and who executes it?',
  },
  changesWhy: {
    es: 'Evita prometer cambios después del despacho.',
    en: 'Prevents promises of changes after dispatch.',
  },
  policyQ: {
    es: '¿Cuál es la política de cambios, garantías y devoluciones; quién aprueba gastos y reembolsos?',
    en: 'What is the exchange, warranty and return policy; who approves costs and refunds?',
  },
  policyWhy: {
    es: 'Define elegibilidad, evidencia y ruta de aprobación.',
    en: 'Defines eligibility, evidence and approval routing.',
  },
  ownersQ: {
    es: '¿Quién atiende excepciones, en qué horario y cuánto tiempo máximo puede esperar el cliente?',
    en: 'Who handles exceptions, during which hours and what is the maximum customer wait?',
  },
  ownersWhy: {
    es: 'Cada caso queda con responsable y plazo de escalamiento.',
    en: 'Each case gets an owner and escalation deadline.',
  },
  consentQ: {
    es: '¿Qué permisos tienen para enviar mensajes y cómo registran bajas y preferencias?',
    en: 'What messaging permissions exist and how are opt-outs and preferences recorded?',
  },
  consentWhy: {
    es: 'Define exclusiones de seguimiento y campañas.',
    en: 'Defines follow-up and campaign exclusions.',
  },
  aftercareQ: {
    es: '¿Qué necesita saber el cliente después de recibir y cuándo tiene sentido una nueva compra?',
    en: 'What does the customer need after delivery and when does another purchase make sense?',
  },
  aftercareWhy: {
    es: 'Diseña guía de uso, satisfacción y recompra pertinentes.',
    en: 'Designs relevant usage guidance, satisfaction and repeat purchase.',
  },
  pilarClaimsQ: {
    es: '¿Qué afirmaciones del sérum están aprobadas y qué respuesta damos ante irritación o una consulta médica?',
    en: 'Which serum claims are approved and how do we handle irritation or a medical question?',
  },
  pilarClaimsWhy: {
    es: 'Construye asesoría verificada y derivación de casos sensibles.',
    en: 'Builds verified advice and sensitive-case handoff.',
  },
  pilarCartQ: {
    es: '¿Conservamos un mensaje a los 15 minutos o reemplazamos ese flujo por varios intentos? ¿Activamos recordatorio de transferencia?',
    en: 'Keep one message at 15 minutes or replace it with multiple attempts? Enable transfer reminders?',
  },
  pilarCartWhy: {
    es: 'Elegimos una sola recuperación y probamos el enlace individual; los borradores actuales están apagados.',
    en: 'Choose one recovery flow and test individual links; current drafts are disabled.',
  },
  rasmiawFitQ: {
    es: '¿Cómo recomiendan el rascador según tamaño, cantidad de gatos y espacio, y qué datos de montaje y garantía están aprobados?',
    en: 'How do you recommend scratchers by cat size, number and space, and which assembly and warranty details are approved?',
  },
  rasmiawFitWhy: {
    es: 'Personaliza venta y soporte con información del producto.',
    en: 'Personalizes sales and support with product information.',
  },
  rasmiawBenefitQ: {
    es: '¿A qué pedidos aplica 5% o 10%, cuándo vence, se acumula y quién verifica el pago si ya existe pedido?',
    en: 'Which orders qualify for 5% or 10%, when does it expire, can it stack and who checks payment on existing orders?',
  },
  rasmiawBenefitWhy: {
    es: 'Define elegibilidad real; un botón o tope de descuento no crea por sí solo el beneficio.',
    en: 'Defines real eligibility; a button or discount cap does not itself create the benefit.',
  },
  rasmiawPendingQ: {
    es: '¿Qué métodos aparecen como pendientes y cuáles son contraentrega? ¿Quién conecta Mercado Pago?',
    en: 'Which methods appear as pending and which are COD? Who connects Mercado Pago?',
  },
  rasmiawPendingWhy: {
    es: 'Separa rutas y desbloquea la recuperación de rechazos.',
    en: 'Separates routes and unblocks rejected-payment recovery.',
  },
  codConfirmQ: {
    es: '¿Se exige confirmación antes de despachar? ¿Qué hacemos ante silencio, duplicados o rechazo?',
    en: 'Is confirmation required before dispatch? What happens on silence, duplicates or refusal?',
  },
  codConfirmWhy: {
    es: 'Define liberación, retención, reintentos y cancelación del pedido.',
    en: 'Defines release, hold, retry and cancellation.',
  },
  codCoverageQ: {
    es: '¿Qué zonas cubren, cuánto se cobra al recibir y hay límites, recargos o revisión del paquete?',
    en: 'Which areas are covered, what is collected and are there limits, surcharges or package inspection?',
  },
  codCoverageWhy: {
    es: 'Evita confirmar condiciones que la transportadora no ofrece.',
    en: 'Avoids confirming terms the carrier does not offer.',
  },
  codFailedQ: {
    es: '¿Qué hacemos si no está, no tiene dinero o rechaza? ¿Quién paga los reintentos y el retorno?',
    en: 'What if the customer is absent, cannot pay or refuses? Who pays retries and return?',
  },
  codFailedWhy: {
    es: 'Diseña cada salida de entrega fallida y sus costos.',
    en: 'Designs each failed-delivery outcome and its costs.',
  },
  codReconcileQ: {
    es: '¿Cada cuánto liquida la transportadora, dónde validamos recaudos y quién resuelve faltantes?',
    en: 'How often does the carrier settle, where do we verify collections and who resolves shortfalls?',
  },
  codReconcileWhy: {
    es: 'Distingue entrega, dinero cobrado y abono recibido.',
    en: 'Distinguishes delivery, money collected and settlement received.',
  },
  launchQ: {
    es: '¿Quién aprueba los casos de prueba, qué debe estar listo para activar y cuándo revisamos los resultados?',
    en: 'Who approves test cases, what must be ready for launch and when do we review results?',
  },
  launchWhy: {
    es: 'Cierra alcance, responsables y criterio de aceptación.',
    en: 'Finalizes scope, owners and acceptance criteria.',
  },
} satisfies Namespace;
