import type { Locale } from '@/lib/i18n/config'
import { translate } from '@/lib/i18n/translate'

/**
 * El pliego de la marca.
 *
 * Al conectar la tienda, Riverz ya sabe QUÉ vende el comercio: catálogo,
 * precios, stock, moneda, país, el tono del sitio y las políticas que publica.
 * Nada de eso se pregunta.
 *
 * Lo que no está escrito en ningún lado son las REGLAS: hasta cuánto descuento
 * puede dar la IA, si puede cancelar un pedido, a qué hora se puede escribir,
 * qué escala a una persona. Sin eso, montar la operación es adivinar — y
 * adivinar en este terreno es exactamente el miedo del comercio: que un bot
 * invente un precio o prometa algo que no se puede cumplir.
 *
 * Este módulo es ese pliego: las preguntas, sus valores por defecto y el texto
 * que después lee el Operador para montar la cuenta. Vive acá y no en el
 * componente porque lo leen tres lugares —la pantalla, la API y el prompt del
 * Operador— y las tres tienen que ver exactamente la misma lista.
 *
 * Regla de oro de los valores por defecto: **el que no le escribe a nadie y no
 * toca plata**. Un pliego a medio contestar tiene que dejar la cuenta inerte,
 * nunca suelta.
 */

export type TipoPregunta =
  | 'opcion'
  | 'multi'
  | 'texto'
  | 'numero'
  | 'horario'
  | 'herramienta'

export interface OpcionPregunta {
  valor: string
  labelKey: string
}

/** Qué está conectado en la cuenta. Decide qué bloques tienen sentido. */
export interface ContextoPliego {
  tienda: boolean
  whatsapp: boolean
  meta: boolean
  mercadolibre: boolean
  email: boolean
  telefono: boolean
}

export type Respuestas = Record<string, unknown>

export interface Pregunta {
  id: string
  labelKey: string
  ayudaKey?: string
  tipo: TipoPregunta
  opciones?: OpcionPregunta[]
  porDefecto: unknown
  /** Qué termina configurando. Lo lee el Operador, no la pantalla. */
  configura: string
  /** Si devuelve false, la pregunta ni se muestra ni cuenta como faltante. */
  aplica?: (ctx: ContextoPliego, r: Respuestas) => boolean
  min?: number
  max?: number
}

export interface BloquePliego {
  id: string
  tituloKey: string
  notaKey?: string
  preguntas: Pregunta[]
  aplica?: (ctx: ContextoPliego, r: Respuestas) => boolean
}

/** Los tres estados de una herramienta, iguales a los de la pizarra. */
const HERRAMIENTA: OpcionPregunta[] = [
  { valor: 'off', labelKey: 'pliego.optApagada' },
  { valor: 'aprobacion', labelKey: 'pliego.optAprobacion' },
  { valor: 'auto', labelKey: 'pliego.optAuto' },
]

const SI_NO: OpcionPregunta[] = [
  { valor: 'si', labelKey: 'pliego.optSi' },
  { valor: 'no', labelKey: 'pliego.optNo' },
]

const si = (v: unknown) => v === 'si'

export const BLOQUES: BloquePliego[] = [
  {
    id: 'objetivos',
    tituloKey: 'pliego.b1',
    preguntas: [
      {
        id: 'dolor',
        labelKey: 'pliego.pDolor',
        tipo: 'multi',
        opciones: [
          { valor: 'ventas', labelKey: 'pliego.oDolorVentas' },
          { valor: 'postventa', labelKey: 'pliego.oDolorPostventa' },
          { valor: 'mensajes', labelKey: 'pliego.oDolorMensajes' },
        ],
        porDefecto: ['ventas', 'postventa', 'mensajes'],
        configura: 'qué playbooks se montan',
      },
      {
        id: 'rol',
        labelKey: 'pliego.pRol',
        tipo: 'opcion',
        opciones: [
          { valor: 'vender', labelKey: 'pliego.oRolVender' },
          { valor: 'atender', labelKey: 'pliego.oRolAtender' },
          { valor: 'ambas', labelKey: 'pliego.oRolAmbas' },
        ],
        porDefecto: 'ambas',
        configura: 'rol de los agentes',
      },
      {
        id: 'agentes',
        labelKey: 'pliego.pAgentes',
        tipo: 'opcion',
        opciones: [
          { valor: 'uno', labelKey: 'pliego.oAgentesUno' },
          { valor: 'por_tarea', labelKey: 'pliego.oAgentesPorTarea' },
        ],
        porDefecto: 'por_tarea',
        configura: 'cuántos agentes se crean',
      },
      {
        id: 'modo',
        labelKey: 'pliego.pModo',
        tipo: 'opcion',
        opciones: [
          { valor: 'auto', labelKey: 'pliego.oModoAuto' },
          { valor: 'borrador', labelKey: 'pliego.oModoBorrador' },
        ],
        porDefecto: 'borrador',
        configura: 'ai_agents.approval_mode',
      },
    ],
  },
  {
    id: 'voz',
    tituloKey: 'pliego.b2',
    preguntas: [
      {
        id: 'trato',
        labelKey: 'pliego.pTrato',
        tipo: 'opcion',
        opciones: [
          { valor: 'tu', labelKey: 'pliego.oTratoTu' },
          { valor: 'usted', labelKey: 'pliego.oTratoUsted' },
          { valor: 'vos', labelKey: 'pliego.oTratoVos' },
        ],
        porDefecto: 'tu',
        configura: 'persona del agente',
      },
      {
        id: 'nunca',
        labelKey: 'pliego.pNunca',
        tipo: 'texto',
        porDefecto: '',
        configura: 'never_say global',
      },
      {
        id: 'siempre',
        labelKey: 'pliego.pSiempre',
        ayudaKey: 'pliego.pSiempreAyuda',
        tipo: 'texto',
        porDefecto: '',
        configura: 'say_guidelines global',
      },
      {
        id: 'emojis',
        labelKey: 'pliego.pEmojis',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'estilo del agente',
      },
      {
        id: 'audio',
        labelKey: 'pliego.pAudio',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'notas de voz salientes',
      },
      {
        id: 'idioma',
        labelKey: 'pliego.pIdioma',
        tipo: 'opcion',
        opciones: [
          { valor: 'auto', labelKey: 'pliego.oIdiomaAuto' },
          { valor: 'es', labelKey: 'pliego.oIdiomaEs' },
          { valor: 'en', labelKey: 'pliego.oIdiomaEn' },
        ],
        porDefecto: 'auto',
        configura: 'ai_agents.language',
      },
    ],
  },
  {
    id: 'venta',
    tituloKey: 'pliego.b3',
    aplica: (ctx) => ctx.tienda,
    preguntas: [
      {
        id: 'cierre',
        labelKey: 'pliego.pCierre',
        tipo: 'opcion',
        opciones: [
          { valor: 'carrito', labelKey: 'pliego.oCierreCarrito' },
          { valor: 'checkout', labelKey: 'pliego.oCierreCheckout' },
          { valor: 'link', labelKey: 'pliego.oCierreLink' },
        ],
        porDefecto: 'checkout',
        configura: 'herramienta de cierre de venta',
      },
      {
        id: 'descuento',
        labelKey: 'pliego.pDescuento',
        ayudaKey: 'pliego.pDescuentoAyuda',
        tipo: 'numero',
        min: 0,
        max: 60,
        porDefecto: 0,
        configura: 'ai_agents.discount_cap',
      },
      {
        id: 'descuento_cuando',
        labelKey: 'pliego.pDescuentoCuando',
        tipo: 'opcion',
        opciones: [
          { valor: 'siempre', labelKey: 'pliego.oDescSiempre' },
          { valor: 'cerrar', labelKey: 'pliego.oDescCerrar' },
        ],
        porDefecto: 'cerrar',
        configura: 'regla de descuento',
        aplica: (_ctx, r) => Number(r.descuento ?? 0) > 0,
      },
      {
        id: 'contraentrega',
        labelKey: 'pliego.pContraentrega',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'flujo de contraentrega',
      },
      {
        id: 'zonas',
        labelKey: 'pliego.pZonas',
        tipo: 'texto',
        porDefecto: '',
        configura: 'zonas de contraentrega',
        aplica: (_ctx, r) => si(r.contraentrega),
      },
      {
        id: 'cruzada',
        labelKey: 'pliego.pCruzada',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'recomendación complementaria',
      },
      {
        id: 'excluidos',
        labelKey: 'pliego.pExcluidos',
        tipo: 'texto',
        porDefecto: '',
        configura: 'productos fuera del chat',
      },
    ],
  },
  {
    id: 'pedidos',
    tituloKey: 'pliego.b4',
    notaKey: 'pliego.b4Nota',
    aplica: (ctx) => ctx.tienda,
    preguntas: [
      {
        id: 't_crear_pedido',
        labelKey: 'pliego.pCrearPedido',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'aprobacion',
        configura: 'pedidos.crear',
      },
      {
        id: 't_consultar_pedido',
        labelKey: 'pliego.pConsultarPedido',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'auto',
        configura: 'pedidos.consultar',
      },
      {
        id: 't_marcar_pago',
        labelKey: 'pliego.pMarcarPago',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'aprobacion',
        configura: 'pedidos.marcar_pago',
      },
      {
        id: 't_agregar_unidades',
        labelKey: 'pliego.pAgregarUnidades',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'aprobacion',
        configura: 'pedidos.agregar_unidades',
      },
      {
        id: 't_cancelar',
        labelKey: 'pliego.pCancelar',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'off',
        configura: 'pedidos.cancelar',
      },
      {
        id: 't_reembolsar',
        labelKey: 'pliego.pReembolsar',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'off',
        configura: 'pedidos.reembolsar',
      },
      {
        id: 't_devolucion',
        labelKey: 'pliego.pDevolucion',
        tipo: 'herramienta',
        opciones: HERRAMIENTA,
        porDefecto: 'aprobacion',
        configura: 'devoluciones.abrir',
      },
      {
        id: 'aprobador',
        labelKey: 'pliego.pAprobador',
        tipo: 'texto',
        porDefecto: '',
        configura: 'a quién le llegan las aprobaciones',
      },
    ],
  },
  {
    id: 'recuperacion',
    tituloKey: 'pliego.b5',
    aplica: (ctx) => ctx.tienda,
    preguntas: [
      {
        id: 'carrito_horas',
        labelKey: 'pliego.pCarritoHoras',
        tipo: 'numero',
        min: 1,
        max: 72,
        porDefecto: 1,
        configura: 'espera de la automatización de carrito',
      },
      {
        id: 'carrito_veces',
        labelKey: 'pliego.pCarritoVeces',
        tipo: 'numero',
        min: 1,
        max: 3,
        porDefecto: 2,
        configura: 'cuántos recordatorios de carrito',
      },
      {
        id: 'carrito_descuento',
        labelKey: 'pliego.pCarritoDescuento',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'descuento en recuperación',
      },
      {
        id: 'sin_pagar_horas',
        labelKey: 'pliego.pSinPagar',
        tipo: 'numero',
        min: 1,
        max: 72,
        porDefecto: 2,
        configura: 'espera del pedido sin pagar',
      },
      {
        id: 'rechazado',
        labelKey: 'pliego.pRechazado',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'flujo de pagos rechazados',
      },
      {
        id: 'ventana_envios',
        labelKey: 'pliego.pVentanaEnvios',
        tipo: 'horario',
        porDefecto: { desde: '09:00', hasta: '21:00' },
        configura: 'horario en que pueden salir mensajes',
      },
    ],
  },
  {
    id: 'recompra',
    tituloKey: 'pliego.b6',
    preguntas: [
      {
        id: 'recompra_dias',
        labelKey: 'pliego.pRecompraDias',
        ayudaKey: 'pliego.pRecompraDiasAyuda',
        tipo: 'numero',
        min: 7,
        max: 365,
        porDefecto: 30,
        configura: 'espera de la automatización de recompra',
      },
      {
        id: 'campanas',
        labelKey: 'pliego.pCampanas',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'difusión',
      },
      {
        id: 'campanas_frecuencia',
        labelKey: 'pliego.pCampanasFrecuencia',
        tipo: 'opcion',
        opciones: [
          { valor: 'semanal', labelKey: 'pliego.oFrecSemanal' },
          { valor: 'quincenal', labelKey: 'pliego.oFrecQuincenal' },
          { valor: 'mensual', labelKey: 'pliego.oFrecMensual' },
        ],
        porDefecto: 'semanal',
        configura: 'tope de frecuencia de campañas',
        aplica: (_ctx, r) => si(r.campanas),
      },
      {
        id: 'excluir',
        labelKey: 'pliego.pExcluir',
        tipo: 'multi',
        opciones: [
          { valor: 'reciente', labelKey: 'pliego.oExclReciente' },
          { valor: 'queja', labelKey: 'pliego.oExclQueja' },
          { valor: 'optout', labelKey: 'pliego.oExclOptout' },
        ],
        porDefecto: ['reciente', 'queja', 'optout'],
        configura: 'segmentos de exclusión',
      },
    ],
  },
  {
    id: 'postventa',
    tituloKey: 'pliego.b7',
    preguntas: [
      {
        id: 'envio_dias',
        labelKey: 'pliego.pEnvioDias',
        ayudaKey: 'pliego.pEnvioDiasAyuda',
        tipo: 'texto',
        porDefecto: '',
        configura: 'conocimiento de entrega',
      },
      {
        id: 'politica_cambios',
        labelKey: 'pliego.pPoliticaCambios',
        tipo: 'texto',
        porDefecto: '',
        configura: 'conocimiento de devoluciones',
      },
      {
        id: 'requisitos',
        labelKey: 'pliego.pRequisitos',
        tipo: 'multi',
        opciones: [
          { valor: 'motivo', labelKey: 'pliego.oReqMotivo' },
          { valor: 'fotos', labelKey: 'pliego.oReqFotos' },
          { valor: 'pedido', labelKey: 'pliego.oReqPedido' },
        ],
        porDefecto: ['motivo', 'fotos'],
        configura: 'requisitos para abrir una devolución',
      },
      {
        id: 'csat',
        labelKey: 'pliego.pCsat',
        tipo: 'opcion',
        opciones: [
          { valor: 'no', labelKey: 'pliego.oCsatNo' },
          { valor: '1', labelKey: 'pliego.oCsat1' },
          { valor: '3', labelKey: 'pliego.oCsat3' },
          { valor: '7', labelKey: 'pliego.oCsat7' },
        ],
        porDefecto: '3',
        configura: 'encuesta de satisfacción posventa',
      },
      {
        id: 'queja',
        labelKey: 'pliego.pQueja',
        tipo: 'opcion',
        opciones: [
          { valor: 'sigue', labelKey: 'pliego.oQuejaSigue' },
          { valor: 'persona', labelKey: 'pliego.oQuejaPersona' },
        ],
        porDefecto: 'persona',
        configura: 'escalamiento por queja',
      },
    ],
  },
  {
    id: 'canales',
    tituloKey: 'pliego.b8',
    preguntas: [
      {
        id: 'solo_humano',
        labelKey: 'pliego.pSoloHumano',
        tipo: 'texto',
        porDefecto: '',
        configura: 'canales sin IA',
      },
      {
        id: 'chatweb',
        labelKey: 'pliego.pChatweb',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'widget de chat web',
        aplica: (ctx) => ctx.tienda,
      },
      {
        id: 'ml_alcance',
        labelKey: 'pliego.pMlAlcance',
        tipo: 'multi',
        opciones: [
          { valor: 'preguntas', labelKey: 'pliego.oMlPreguntas' },
          { valor: 'posventa', labelKey: 'pliego.oMlPosventa' },
          { valor: 'opiniones', labelKey: 'pliego.oMlOpiniones' },
        ],
        porDefecto: ['preguntas', 'posventa'],
        configura: 'alcance de Mercado Libre',
        aplica: (ctx) => ctx.mercadolibre,
      },
      {
        id: 'email',
        labelKey: 'pliego.pEmail',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'correo en la bandeja',
        aplica: (ctx) => ctx.email,
      },
    ],
  },
  {
    id: 'comentarios',
    tituloKey: 'pliego.b9',
    aplica: (ctx) => ctx.meta,
    preguntas: [
      {
        id: 'comentarios',
        labelKey: 'pliego.pComentarios',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'respuesta a comentarios',
      },
      {
        id: 'comentario_dm',
        labelKey: 'pliego.pComentarioDm',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'comentario a mensaje privado',
        aplica: (_ctx, r) => si(r.comentarios),
      },
      {
        id: 'ocultar',
        labelKey: 'pliego.pOcultar',
        tipo: 'multi',
        opciones: [
          { valor: 'insultos', labelKey: 'pliego.oOcultarInsultos' },
          { valor: 'competencia', labelKey: 'pliego.oOcultarCompetencia' },
          { valor: 'precios', labelKey: 'pliego.oOcultarPrecios' },
        ],
        porDefecto: ['insultos'],
        configura: 'moderación de comentarios',
      },
      {
        id: 'prospeccion',
        labelKey: 'pliego.pProspeccion',
        ayudaKey: 'pliego.pProspeccionAyuda',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'prospección de Instagram',
      },
    ],
  },
  {
    id: 'llamadas',
    tituloKey: 'pliego.b10',
    preguntas: [
      {
        id: 'voz_entrante',
        labelKey: 'pliego.pVozEntrante',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'llamadas entrantes',
      },
      {
        id: 'voz_cod',
        labelKey: 'pliego.pVozCod',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'llamada de confirmación contraentrega',
        aplica: (_ctx, r) => si(r.contraentrega),
      },
      {
        id: 'voz_genero',
        labelKey: 'pliego.pVozGenero',
        tipo: 'opcion',
        opciones: [
          { valor: 'f', labelKey: 'pliego.oVozF' },
          { valor: 'm', labelKey: 'pliego.oVozM' },
        ],
        porDefecto: 'f',
        configura: 'voz del agente telefónico',
        aplica: (_ctx, r) => si(r.voz_entrante) || si(r.voz_cod),
      },
      {
        id: 'voz_horario',
        labelKey: 'pliego.pVozHorario',
        tipo: 'horario',
        porDefecto: { desde: '10:00', hasta: '19:00' },
        configura: 'horario de llamadas',
        aplica: (_ctx, r) => si(r.voz_entrante) || si(r.voz_cod),
      },
    ],
  },
  {
    id: 'equipo',
    tituloKey: 'pliego.b11',
    preguntas: [
      {
        id: 'horario',
        labelKey: 'pliego.pHorario',
        tipo: 'horario',
        porDefecto: { desde: '09:00', hasta: '18:00' },
        configura: 'horario de atención del workspace',
      },
      {
        id: 'fuera_horario',
        labelKey: 'pliego.pFueraHorario',
        tipo: 'opcion',
        opciones: [
          { valor: 'contesta', labelKey: 'pliego.oFueraContesta' },
          { valor: 'avisa', labelKey: 'pliego.oFueraAvisa' },
        ],
        porDefecto: 'contesta',
        configura: 'comportamiento fuera de horario',
      },
      {
        id: 'escalar_palabras',
        labelKey: 'pliego.pEscalarPalabras',
        tipo: 'texto',
        porDefecto: 'abogado, denuncia, fraude, prensa',
        configura: 'escalate_keywords',
      },
      {
        id: 'pide_humano',
        labelKey: 'pliego.pPideHumano',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'escalamiento a pedido del cliente',
      },
      {
        id: 'equipo',
        labelKey: 'pliego.pEquipo',
        ayudaKey: 'pliego.pEquipoAyuda',
        tipo: 'texto',
        porDefecto: '',
        configura: 'miembros a invitar',
      },
      {
        id: 'silencio_humano',
        labelKey: 'pliego.pSilencioHumano',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'si',
        configura: 'la IA se calla si contesta una persona',
      },
    ],
  },
  {
    id: 'delicado',
    tituloKey: 'pliego.b12',
    preguntas: [
      {
        id: 'salud',
        labelKey: 'pliego.pSalud',
        tipo: 'opcion',
        opciones: SI_NO,
        porDefecto: 'no',
        configura: 'health_sensitive',
      },
      {
        id: 'regulacion',
        labelKey: 'pliego.pRegulacion',
        tipo: 'texto',
        porDefecto: '',
        configura: 'guardrails globales',
      },
      {
        id: 'datos',
        labelKey: 'pliego.pDatos',
        ayudaKey: 'pliego.pDatosNota',
        tipo: 'multi',
        opciones: [
          { valor: 'documento', labelKey: 'pliego.oDatosDocumento' },
          { valor: 'direccion', labelKey: 'pliego.oDatosDireccion' },
        ],
        porDefecto: ['direccion'],
        configura: 'datos que puede pedir por chat',
      },
      {
        id: 'no_sabe',
        labelKey: 'pliego.pNoSabe',
        tipo: 'opcion',
        opciones: [
          { valor: 'consulta', labelKey: 'pliego.oNoSabeConsulta' },
          { valor: 'resuelve', labelKey: 'pliego.oNoSabeResuelve' },
        ],
        porDefecto: 'consulta',
        configura: 'política de no-saber',
      },
    ],
  },
  {
    id: 'valor',
    tituloKey: 'pliego.b13',
    preguntas: [
      {
        id: 'meta',
        labelKey: 'pliego.pMeta',
        tipo: 'opcion',
        opciones: [
          { valor: 'conversaciones', labelKey: 'pliego.oMetaConversaciones' },
          { valor: 'carrito', labelKey: 'pliego.oMetaCarrito' },
          { valor: 'pedido', labelKey: 'pliego.oMetaPedido' },
          { valor: 'tiempo', labelKey: 'pliego.oMetaTiempo' },
        ],
        porDefecto: 'pedido',
        configura: 'la meta acordada',
      },
      {
        id: 'numero',
        labelKey: 'pliego.pNumero',
        tipo: 'opcion',
        opciones: [
          { valor: 'ventas', labelKey: 'pliego.oNumeroVentas' },
          { valor: 'conversaciones', labelKey: 'pliego.oNumeroConversaciones' },
          { valor: 'tiempo', labelKey: 'pliego.oNumeroTiempo' },
        ],
        porDefecto: 'ventas',
        configura: 'qué se muestra primero en el panel',
      },
      {
        id: 'volumen',
        labelKey: 'pliego.pVolumen',
        tipo: 'texto',
        porDefecto: '',
        configura: 'dimensionar límites y costo',
      },
    ],
  },
]

/** Todas las preguntas, sin importar el bloque. */
export const PREGUNTAS: Pregunta[] = BLOQUES.flatMap((b) => b.preguntas)

const PREGUNTA_POR_ID = new Map(PREGUNTAS.map((p) => [p.id, p]))

/** El pliego entero en su mínimo seguro. */
export function pliegoPorDefecto(): Respuestas {
  return Object.fromEntries(PREGUNTAS.map((p) => [p.id, p.porDefecto]))
}

/**
 * Qué se muestra con lo que hay conectado y con lo ya contestado.
 *
 * Un bloque que no aplica no aparece Y no cuenta como faltante: preguntarle
 * por Mercado Libre a quien no lo conectó es hacerle perder el tiempo, y
 * dejarlo "sin contestar" para siempre convierte el pliego en una lista que
 * nunca se termina.
 */
export function bloquesVisibles(
  ctx: ContextoPliego,
  r: Respuestas,
): BloquePliego[] {
  // Sobre los valores EFECTIVOS —lo contestado encima de los defectos— y no
  // sobre lo contestado a secas. Si no, una pregunta que depende de un defecto
  // no aparece nunca: las campañas vienen en "sí", así que la pregunta por su
  // frecuencia tiene que estar desde el principio, no recién cuando alguien
  // vuelve a marcar el "sí" que ya estaba marcado.
  const eff = { ...pliegoPorDefecto(), ...r }
  return BLOQUES.filter((b) => b.aplica?.(ctx, eff) ?? true).map((b) => ({
    ...b,
    preguntas: b.preguntas.filter((p) => p.aplica?.(ctx, eff) ?? true),
  }))
}

/**
 * Lo que llega del navegador, recortado a lo que el pliego admite.
 *
 * Estas respuestas terminan decidiendo si la IA puede reembolsar plata. Un id
 * desconocido, una opción inventada o un descuento de 900 % no pueden entrar
 * sólo porque alguien los mandó en un JSON.
 */
export function normalizarPliego(entrada: unknown): Respuestas {
  const crudo = (entrada ?? {}) as Record<string, unknown>
  const salida: Respuestas = {}
  for (const [id, valor] of Object.entries(crudo)) {
    const p = PREGUNTA_POR_ID.get(id)
    if (!p) continue
    const limpio = limpiar(p, valor)
    if (limpio !== undefined) salida[id] = limpio
  }
  return salida
}

function limpiar(p: Pregunta, valor: unknown): unknown {
  switch (p.tipo) {
    case 'opcion':
    case 'herramienta': {
      const ok = p.opciones?.some((o) => o.valor === valor)
      return ok ? valor : undefined
    }
    case 'multi': {
      if (!Array.isArray(valor)) return undefined
      const validos = new Set(p.opciones?.map((o) => o.valor) ?? [])
      return valor.filter((v) => typeof v === 'string' && validos.has(v))
    }
    case 'texto': {
      if (typeof valor !== 'string') return undefined
      return valor.slice(0, 2000)
    }
    case 'numero': {
      const n = Number(valor)
      if (!Number.isFinite(n)) return undefined
      return Math.min(p.max ?? 1e6, Math.max(p.min ?? 0, Math.round(n)))
    }
    case 'horario': {
      const v = valor as { desde?: unknown; hasta?: unknown } | null
      if (!v || typeof v !== 'object') return undefined
      const hora = (x: unknown) =>
        typeof x === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(x) ? x : null
      const desde = hora(v.desde)
      const hasta = hora(v.hasta)
      if (!desde || !hasta) return undefined
      return { desde, hasta }
    }
  }
}

/** Cuántas preguntas visibles siguen sin respuesta propia. */
export function faltantes(ctx: ContextoPliego, r: Respuestas): number {
  return bloquesVisibles(ctx, r)
    .flatMap((b) => b.preguntas)
    .filter((p) => r[p.id] === undefined).length
}

/**
 * El pliego como texto, para el prompt del Operador.
 *
 * Va en el idioma del comercio, igual que todo lo que el Operador escribe, y
 * cada línea lleva QUÉ configura: sin eso el modelo lee una encuesta en vez de
 * una orden de trabajo. Las preguntas que no aplican no se listan.
 */
export function pliegoATexto(
  ctx: ContextoPliego,
  respuestas: Respuestas,
  locale: Locale,
): string {
  const r = { ...pliegoPorDefecto(), ...respuestas }
  const lineas: string[] = []
  for (const bloque of bloquesVisibles(ctx, r)) {
    lineas.push(`## ${translate(locale, bloque.tituloKey)}`)
    for (const p of bloque.preguntas) {
      const propia = respuestas[p.id] !== undefined
      const valor = describir(p, r[p.id], locale)
      lineas.push(
        `- ${translate(locale, p.labelKey)} → ${valor} [${p.configura}]${
          propia ? '' : ' (por defecto)'
        }`,
      )
    }
  }
  return lineas.join('\n')
}

function describir(p: Pregunta, valor: unknown, locale: Locale): string {
  if (valor === undefined || valor === null || valor === '') {
    return translate(locale, 'pliego.sinRespuesta')
  }
  switch (p.tipo) {
    case 'opcion':
    case 'herramienta': {
      const o = p.opciones?.find((x) => x.valor === valor)
      return o ? translate(locale, o.labelKey) : String(valor)
    }
    case 'multi': {
      const vals = Array.isArray(valor) ? valor : []
      if (vals.length === 0) return translate(locale, 'pliego.optNo')
      return vals
        .map((v) => {
          const o = p.opciones?.find((x) => x.valor === v)
          return o ? translate(locale, o.labelKey) : String(v)
        })
        .join(', ')
    }
    case 'horario': {
      const h = valor as { desde: string; hasta: string }
      return `${h.desde}–${h.hasta}`
    }
    default:
      return String(valor)
  }
}
