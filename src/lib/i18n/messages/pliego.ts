import type { Namespace } from "./types";

/**
 * El pliego de la marca: las preguntas que sólo el comercio puede contestar.
 *
 * Todo lo que se puede deducir —país, moneda, catálogo, tono, políticas
 * publicadas, qué canales conectó— NO se pregunta: llega puesto. Acá quedan
 * únicamente las reglas del negocio, que no están escritas en ningún lado
 * salvo en la cabeza del dueño.
 *
 * Cada respuesta termina en dos lugares: la configuración que arma el Operador
 * y el contexto que lee para armarla. Por eso el texto es corto y directo: lo
 * lee una persona en una reunión, no un implementador.
 */
export const pliego = {
  // === La pantalla ==========================================================
  titulo: { es: "Cómo quieres que trabaje", en: "How you want it to work" },
  bajada: {
    es: "Ya sabemos qué vendes. Falta saber qué te deja hacer.",
    en: "We already know what you sell. Now we need to know what you allow.",
  },
  guardado: { es: "Guardado", en: "Saved" },
  guardando: { es: "Guardando…", en: "Saving…" },
  listo: { es: "Listo, móntenlo", en: "Done, build it" },
  faltan: {
    es: "Lo que no contestes queda en el mínimo seguro.",
    en: "Anything unanswered stays at the safe minimum.",
  },
  dedujimos: {
    es: "Esto lo sacamos de tu tienda y tu web",
    en: "We took this from your store and site",
  },
  deducidoNota: {
    es: "Si algo no coincide, cámbialo aquí.",
    en: "If something doesn't match, change it here.",
  },

  // === Opciones compartidas =================================================
  optSi: { es: "Sí", en: "Yes" },
  optNo: { es: "No", en: "No" },
  optApagada: { es: "No puede", en: "Can't" },
  optAprobacion: { es: "Me pregunta", en: "Asks me" },
  optAuto: { es: "Sola", en: "On its own" },
  horaDesde: { es: "Desde", en: "From" },
  horaHasta: { es: "Hasta", en: "To" },
  sinRespuesta: { es: "Sin contestar", en: "Unanswered" },

  // === 1 · Qué quieres que haga ============================================
  b1: { es: "Qué quieres que haga", en: "What you want it to do" },
  pDolor: { es: "¿Qué te duele más hoy?", en: "What hurts most today?" },
  oDolorVentas: { es: "Pierdo ventas", en: "I lose sales" },
  oDolorPostventa: {
    es: "La postventa me come el día",
    en: "After-sales eats my day",
  },
  oDolorMensajes: {
    es: "No doy abasto con los mensajes",
    en: "I can't keep up with messages",
  },
  pRol: {
    es: "¿Quieres que venda, que atienda, o las dos?",
    en: "Should it sell, support, or both?",
  },
  oRolVender: { es: "Vender", en: "Sell" },
  oRolAtender: { es: "Atender", en: "Support" },
  oRolAmbas: { es: "Las dos", en: "Both" },
  pAgentes: {
    es: "¿Un solo asistente para todo, o uno por tarea?",
    en: "One assistant for everything, or one per job?",
  },
  oAgentesUno: { es: "Uno solo", en: "Just one" },
  oAgentesPorTarea: { es: "Uno por tarea", en: "One per job" },
  pModo: {
    es: "¿Contesta sola, o te deja el mensaje escrito para que lo mandes tú?",
    en: "Does it reply on its own, or draft the message for you to send?",
  },
  oModoAuto: { es: "Contesta sola", en: "Replies on its own" },
  oModoBorrador: { es: "Me lo deja escrito", en: "Drafts it for me" },

  // === 2 · Voz y límites ====================================================
  b2: { es: "Cómo habla", en: "How it talks" },
  pTrato: {
    es: "¿Cómo le hablas a tu cliente?",
    en: "How do you address your customer?",
  },
  oTratoTu: { es: "De tú", en: "Informal" },
  oTratoUsted: { es: "De usted", en: "Formal" },
  oTratoVos: { es: "De vos", en: "Regional informal" },
  pNunca: {
    es: "¿Algo que nunca puede decir ni prometer?",
    en: "Anything it must never say or promise?",
  },
  pSiempre: {
    es: "¿Algo que sí quieres que repita siempre?",
    en: "Anything you want it to always repeat?",
  },
  pSiempreAyuda: {
    es: "Envío gratis desde cierto monto, garantía, cuotas.",
    en: "Free shipping over an amount, warranty, instalments.",
  },
  pEmojis: { es: "¿Usa emojis?", en: "Does it use emoji?" },
  pAudio: { es: "¿Puede mandar notas de voz?", en: "Can it send voice notes?" },
  pIdioma: {
    es: "¿En qué idioma le escribe al cliente?",
    en: "What language does it write in?",
  },
  oIdiomaAuto: { es: "El del país de la tienda", en: "The store country's" },
  oIdiomaEs: { es: "Español", en: "Spanish" },
  oIdiomaEn: { es: "Inglés", en: "English" },

  // === 3 · Vender y cobrar ==================================================
  b3: { es: "Vender y cobrar", en: "Selling and charging" },
  pCierre: {
    es: "Cuando el cliente quiere comprar, ¿qué le manda?",
    en: "When the customer wants to buy, what does it send?",
  },
  oCierreCarrito: { es: "El carrito armado", en: "A ready cart" },
  oCierreCheckout: { es: "El checkout de la tienda", en: "The store checkout" },
  oCierreLink: { es: "Un link de pago", en: "A payment link" },
  pDescuento: {
    es: "¿Hasta cuánto descuento puede dar?",
    en: "How much discount can it give?",
  },
  pDescuentoAyuda: {
    es: "Cero significa que nunca ofrece descuento por su cuenta.",
    en: "Zero means it never offers a discount on its own.",
  },
  pDescuentoCuando: { es: "¿Cuándo lo ofrece?", en: "When does it offer it?" },
  oDescSiempre: { es: "Cuando ayude a cerrar", en: "Whenever it helps close" },
  oDescCerrar: {
    es: "Sólo si el cliente se está yendo",
    en: "Only if the customer is leaving",
  },
  pContraentrega: {
    es: "¿Trabajas contraentrega?",
    en: "Do you do cash on delivery?",
  },
  pZonas: { es: "¿En qué zonas?", en: "In which areas?" },
  pCruzada: {
    es: "¿Puede recomendar algo que el cliente no preguntó?",
    en: "Can it recommend something the customer didn't ask about?",
  },
  pExcluidos: {
    es: "¿Hay productos que no quieres que venda por chat?",
    en: "Any products you don't want sold over chat?",
  },

  // === 4 · Pedidos ==========================================================
  b4: { es: "Qué puede tocar de un pedido", en: "What it can touch on an order" },
  b4Nota: {
    es: "Tres opciones en cada una: no puede, me pregunta, o lo hace sola.",
    en: "Three options each: can't, asks me, or does it on its own.",
  },
  pCrearPedido: {
    es: "Crear un pedido en tu tienda",
    en: "Create an order in your store",
  },
  pConsultarPedido: {
    es: "Consultar un pedido y dar la guía",
    en: "Look up an order and give tracking",
  },
  pMarcarPago: {
    es: "Marcar un pago como recibido",
    en: "Mark a payment as received",
  },
  pAgregarUnidades: {
    es: "Agregar unidades a un pedido hecho",
    en: "Add units to an existing order",
  },
  pCancelar: { es: "Cancelar un pedido", en: "Cancel an order" },
  pReembolsar: { es: "Devolver el dinero", en: "Refund the money" },
  pDevolucion: {
    es: "Abrir una devolución o un cambio",
    en: "Open a return or exchange",
  },
  pAprobador: {
    es: "¿Quién aprueba lo que queda pendiente?",
    en: "Who approves what's left pending?",
  },

  // === 5 · Recuperar ========================================================
  b5: {
    es: "Recuperar lo que se está por perder",
    en: "Recovering what's about to be lost",
  },
  pCarritoHoras: {
    es: "Carrito abandonado: ¿a las cuántas horas le escribe?",
    en: "Abandoned cart: after how many hours does it write?",
  },
  pCarritoVeces: {
    es: "¿Cuántas veces insiste?",
    en: "How many times does it follow up?",
  },
  pCarritoDescuento: {
    es: "¿Puede ofrecer algo para cerrar ese carrito?",
    en: "Can it offer something to close that cart?",
  },
  pSinPagar: {
    es: "Pedido hecho y sin pagar: ¿a las cuántas horas?",
    en: "Order placed and unpaid: after how many hours?",
  },
  pRechazado: {
    es: "Pago rechazado: ¿le escribe y le pasa otro medio?",
    en: "Payment declined: does it write and offer another method?",
  },
  pVentanaEnvios: {
    es: "¿En qué horario pueden salir mensajes?",
    en: "During what hours can messages go out?",
  },

  // === 6 · Volver a vender ==================================================
  b6: {
    es: "Volver a venderle al que ya compró",
    en: "Selling again to past buyers",
  },
  pRecompraDias: {
    es: "¿Cada cuántos días se repone lo que vendes?",
    en: "How many days until what you sell runs out?",
  },
  pRecompraDiasAyuda: {
    es: "Es cuándo vuelve a escribirle al que ya compró.",
    en: "That's when it writes again to a past buyer.",
  },
  pCampanas: { es: "¿Quieres campañas masivas?", en: "Do you want bulk campaigns?" },
  pCampanasFrecuencia: {
    es: "¿Cada cuánto como máximo?",
    en: "How often at most?",
  },
  oFrecSemanal: { es: "Una por semana", en: "Once a week" },
  oFrecQuincenal: { es: "Una cada quince días", en: "Every two weeks" },
  oFrecMensual: { es: "Una por mes", en: "Once a month" },
  pExcluir: {
    es: "¿A quién no le escribimos de más?",
    en: "Who should we not over-message?",
  },
  oExclReciente: { es: "El que compró recién", en: "Just bought" },
  oExclQueja: { es: "El que se quejó", en: "Complained" },
  oExclOptout: { es: "El que pidió que no", en: "Asked us to stop" },

  // === 7 · Postventa ========================================================
  b7: { es: "Después de la compra", en: "After the purchase" },
  pEnvioDias: {
    es: "¿Cuánto tarda tu envío?",
    en: "How long does your shipping take?",
  },
  pEnvioDiasAyuda: { es: "Por zona, si cambia.", en: "By area, if it varies." },
  pPoliticaCambios: {
    es: "Tu política de cambios y devoluciones, en una frase",
    en: "Your returns policy, in one sentence",
  },
  pRequisitos: {
    es: "Para abrir una devolución necesitas",
    en: "To open a return you need",
  },
  oReqMotivo: { es: "El motivo", en: "The reason" },
  oReqFotos: { es: "Fotos", en: "Photos" },
  oReqPedido: { es: "El número de pedido", en: "The order number" },
  pCsat: {
    es: "¿Pide opinión después de la entrega?",
    en: "Does it ask for feedback after delivery?",
  },
  oCsatNo: { es: "No", en: "No" },
  oCsat1: { es: "Al día siguiente", en: "Next day" },
  oCsat3: { es: "A los tres días", en: "After three days" },
  oCsat7: { es: "A la semana", en: "After a week" },
  pQueja: {
    es: "Si el cliente se queja fuerte, ¿sigue ella o llama a una persona?",
    en: "If the customer complains hard, does it continue or call a person?",
  },
  oQuejaSigue: { es: "Sigue ella", en: "It continues" },
  oQuejaPersona: { es: "Llama a una persona", en: "Calls a person" },

  // === 8 · Canales ==========================================================
  b8: { es: "Dónde contesta", en: "Where it replies" },
  pCanales: {
    es: "¿En qué canales contesta la IA?",
    en: "On which channels does the AI reply?",
  },
  pSoloHumano: {
    es: "¿En alguno quieres que conteste sólo una persona?",
    en: "Any channel where only a person should reply?",
  },
  pChatweb: {
    es: "¿Ponemos el chat en tu tienda?",
    en: "Should we put the chat on your store?",
  },
  pMlAlcance: {
    es: "En Mercado Libre, ¿qué contesta?",
    en: "On Mercado Libre, what does it answer?",
  },
  oMlPreguntas: { es: "Preguntas de la publicación", en: "Listing questions" },
  oMlPosventa: { es: "Posventa del pedido", en: "Order after-sales" },
  oMlOpiniones: { es: "Opiniones", en: "Reviews" },
  pEmail: {
    es: "¿Los correos de ventas también entran aquí?",
    en: "Do sales emails come in here too?",
  },

  // === 9 · Comentarios ======================================================
  b9: {
    es: "Comentarios y mensajes que salen primero",
    en: "Comments and outbound-first messages",
  },
  pComentarios: {
    es: "¿Contesta los comentarios de tus publicaciones y anuncios?",
    en: "Does it reply to comments on your posts and ads?",
  },
  pComentarioDm: {
    es: "¿Y además le manda un privado al que comenta?",
    en: "And also DM whoever comments?",
  },
  pOcultar: {
    es: "¿Qué comentarios prefieres ocultar?",
    en: "Which comments would you rather hide?",
  },
  oOcultarInsultos: { es: "Insultos", en: "Insults" },
  oOcultarCompetencia: {
    es: "Los que nombran a la competencia",
    en: "Ones naming competitors",
  },
  oOcultarPrecios: { es: "Los que preguntan precio", en: "Ones asking price" },
  pProspeccion: {
    es: "¿Quieres escribirle primero a gente que no te escribió?",
    en: "Do you want to message people who haven't written to you?",
  },
  pProspeccionAyuda: {
    es: "Meta lo limita y se activa aparte.",
    en: "Meta limits this and it's enabled separately.",
  },

  // === 10 · Llamadas ========================================================
  b10: { es: "Llamadas", en: "Calls" },
  pVozEntrante: {
    es: "¿Quieres que atienda el teléfono?",
    en: "Should it answer the phone?",
  },
  pVozCod: {
    es: "¿Que llame para confirmar los pedidos contraentrega?",
    en: "Should it call to confirm cash-on-delivery orders?",
  },
  pVozGenero: { es: "¿Qué voz?", en: "Which voice?" },
  oVozF: { es: "De mujer", en: "Female" },
  oVozM: { es: "De hombre", en: "Male" },
  pVozHorario: {
    es: "¿En qué horario puede llamar?",
    en: "During what hours can it call?",
  },

  // === 11 · Personas ========================================================
  b11: { es: "Tu equipo y cuándo entra", en: "Your team and when they step in" },
  pHorario: {
    es: "¿En qué horario atiende tu equipo?",
    en: "What are your team's hours?",
  },
  pFueraHorario: {
    es: "Fuera de ese horario, ¿contesta igual o avisa que responden mañana?",
    en: "Outside those hours, does it reply anyway or say you'll answer tomorrow?",
  },
  oFueraContesta: { es: "Contesta igual", en: "Replies anyway" },
  oFueraAvisa: {
    es: "Avisa que responden mañana",
    en: "Says you'll answer tomorrow",
  },
  pEscalarPalabras: {
    es: "¿Qué palabras tienen que llamar a una persona sí o sí?",
    en: "Which words must always call in a person?",
  },
  pPideHumano: {
    es: "Si el cliente pide hablar con una persona, ¿se aparta enseguida?",
    en: "If the customer asks for a person, does it step aside right away?",
  },
  pEquipo: {
    es: "¿Quiénes de tu equipo entran a Riverz?",
    en: "Who from your team gets into Riverz?",
  },
  pEquipoAyuda: { es: "Nombre y correo de cada uno.", en: "Name and email for each." },
  pSilencioHumano: {
    es: "Si alguien de tu equipo ya está contestando un chat, ¿la IA se calla?",
    en: "If someone from your team is already replying, does the AI stay quiet?",
  },

  // === 12 · Casos delicados =================================================
  b12: { es: "Lo delicado", en: "The delicate part" },
  pSalud: {
    es: "¿Vendes salud, suplementos o algo con restricción de edad?",
    en: "Do you sell health products, supplements, or anything age-restricted?",
  },
  pRegulacion: {
    es: "¿Hay afirmaciones que no puedes hacer por regulación?",
    en: "Any claims you can't make for regulatory reasons?",
  },
  pDatos: {
    es: "¿Qué datos puede pedir por chat?",
    en: "What data can it ask for over chat?",
  },
  oDatosDocumento: { es: "Documento", en: "ID number" },
  oDatosDireccion: { es: "Dirección", en: "Address" },
  pDatosNota: {
    es: "Datos de tarjeta no se piden por chat, nunca.",
    en: "Card details are never requested over chat.",
  },
  pNoSabe: {
    es: "Si no sabe algo, ¿improvisa o dice que consulta?",
    en: "If it doesn't know something, does it improvise or say it will check?",
  },
  oNoSabeConsulta: { es: "Dice que consulta", en: "Says it will check" },
  oNoSabeResuelve: { es: "Sale del paso como pueda", en: "Makes do" },

  // === 13 · Cuándo está funcionando =========================================
  b13: { es: "Cuándo decimos que funciona", en: "When we call it working" },
  pMeta: {
    es: "¿Qué tendría que pasar en dos semanas para que digas que sirve?",
    en: "What would have to happen in two weeks for you to say it works?",
  },
  oMetaConversaciones: {
    es: "Que conteste sola lo repetitivo",
    en: "It handles the repetitive stuff",
  },
  oMetaCarrito: { es: "Que recupere un carrito", en: "It recovers a cart" },
  oMetaPedido: { es: "Que cierre un pedido", en: "It closes an order" },
  oMetaTiempo: {
    es: "Que nadie espere una respuesta",
    en: "Nobody waits for a reply",
  },
  pNumero: {
    es: "¿Qué número miras para saber si el día fue bueno?",
    en: "Which number tells you the day went well?",
  },
  oNumeroVentas: { es: "Las ventas", en: "Sales" },
  oNumeroConversaciones: {
    es: "Los mensajes contestados",
    en: "Messages answered",
  },
  oNumeroTiempo: {
    es: "Lo que tardamos en responder",
    en: "How long we take to reply",
  },
  pVolumen: {
    es: "¿Cuántas conversaciones y pedidos por día tienes?",
    en: "How many conversations and orders a day do you get?",
  },
} satisfies Namespace;
