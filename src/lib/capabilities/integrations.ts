/**
 * Con qué está conectada la cuenta, y cómo cortarlo.
 *
 * Conectar no puede vivir acá y no es un problema a resolver: es un OAuth con
 * una persona apretando "Aceptar" en el navegador de Meta, de Google o de
 * Mercado Libre. Diagnosticar sí, y hasta ahora no se podía preguntar. "¿Qué
 * canales tengo?", "¿cuál se cayó?", "¿cuándo vence el token?" salían de refilón
 * dentro de `operacion.estado`, que devuelve el canal y su estado y nada más:
 * ni con qué cuenta, ni desde cuándo, ni qué error trae, ni cuánto le queda al
 * token. Justo lo que hace falta para saber por qué dejaron de entrar mensajes.
 *
 * Desconectar es lo contrario de diagnosticar y por eso es irreversible: corta
 * el canal para TODA la cuenta y volver exige otra vez el navegador y la
 * persona. Nada de lo que hay acá adentro puede deshacerlo.
 */
import {
  getPublicConnection,
  type PublicStoreConnection,
} from '@/lib/commerce/connection'
import { COMMERCE_PLATFORMS } from '@/lib/commerce/types'
import { CHANNEL_DISPLAY } from '@/lib/channels/display'
import {
  canalesDelGrupo,
  desconectarCanal,
  listarConexionesDeCanal,
} from '@/lib/integrations/disconnect'
import type { Channel } from '@/types'
import type { Capability, CapabilityContext } from './types'

/**
 * Los canales que se conectan contra un tercero, que son los únicos que se
 * pueden diagnosticar y cortar así. Quedan afuera `voice` y `webchat`: no tienen
 * cuenta ajena ni token: el chat web se apaga desde su propia configuración y
 * cortarlo por acá sería usar la palanca equivocada.
 */
const CANALES_CONECTABLES: Channel[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'fb_comment',
  'ig_comment',
  'gmail',
  'outlook',
  'mercadolibre',
  'tiktok_comment',
]

interface FilaConexion {
  id: string
  channel: Channel
  label: string | null
  status: string
  external_account_id: string | null
  config: Record<string, unknown> | null
  /** Se lee para sacar UNA fecha; nunca se devuelve. Ver `vencimiento`. */
  secrets: Record<string, unknown> | null
  last_error: string | null
  last_synced_at: string | null
  created_at: string
}

function texto(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length > 0 ? s : null
}

/**
 * Cuándo vence el token, mirando los DOS lugares donde quedó guardado.
 *
 * Son dos épocas, no un descuido: los canales de OAuth genérico (Gmail,
 * Outlook, Meta) lo escriben junto al refresh_token en `secrets`, mientras que
 * Mercado Libre y TikTok lo publican en `config`, que es la parte no secreta.
 * Leer uno solo dejaba sin fecha justo a la mitad de los canales.
 */
function vencimiento(fila: FilaConexion): string | null {
  return (
    texto(fila.config?.token_expires_at) ??
    texto(fila.secrets?.access_token_expires_at)
  )
}

/**
 * Con qué cuenta del otro lado está conectado esto.
 *
 * "Instagram: conectado" no alcanza cuando el comercio tiene dos cuentas y una
 * se cayó. El `label` ya suele traerlo armado por el conector; los config son el
 * respaldo para las filas viejas, que se guardaron sin label.
 */
function cuentaDe(fila: FilaConexion): string | null {
  const cfg = fila.config ?? {}
  return (
    texto(fila.label) ??
    texto(cfg.display_phone_number) ??
    texto(cfg.email) ??
    texto(cfg.username) ??
    texto(cfg.page_name) ??
    texto(fila.external_account_id)
  )
}

async function estado(ctx: CapabilityContext) {
  const [conexiones, tiendas] = await Promise.all([
    ctx.db
      .from('channel_connections')
      .select(
        'id, channel, label, status, external_account_id, config, secrets, last_error, last_synced_at, created_at',
      )
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: false }),
    // Una consulta por plataforma y no una sola: la tabla de tiendas es
    // multi-plataforma desde la 126 y toda lectura filtra por `platform`. Un
    // workspace puede tener Shopify y WooCommerce a la vez.
    Promise.all(
      COMMERCE_PLATFORMS.map((p) => getPublicConnection(ctx.db, p, ctx.workspaceId)),
    ),
  ])

  // Un error de lectura no puede degradar a lista vacía: "no hay canales" se
  // lee como "no tenés nada conectado", que es la respuesta contraria a la
  // verdadera y la peor posible para quien está diagnosticando una caída.
  if (conexiones.error) throw new Error(conexiones.error.message)

  const ahora = Date.now()
  const filas = (conexiones.data ?? []) as unknown as FilaConexion[]

  return {
    // Se listan TAMBIÉN las desconectadas, al revés que `operacion.estado`. Es
    // el punto de esta capacidad: "Instagram figura desconectado desde el 5"
    // contesta la pregunta, y una lista donde el canal simplemente no aparece
    // se lee igual que "nunca lo conectaste".
    canales: filas.map((f) => {
      const vence = vencimiento(f)
      return {
        canal: f.channel,
        nombre: CHANNEL_DISPLAY[f.channel]?.label ?? f.channel,
        cuenta: cuentaDe(f),
        estado: f.status,
        conectado_desde: f.created_at,
        // El vencimiento por sí solo no es una falla: los crons renuevan con el
        // refresh_token antes de que llegue. Importa cuando ya pasó y el estado
        // no volvió a 'connected' — ahí la renovación no prosperó.
        vence: vence,
        vencido: vence ? Date.parse(vence) < ahora : false,
        ultimo_error: f.last_error,
        ultima_sincronizacion: f.last_synced_at,
      }
    }),
    tiendas: tiendas
      .filter((t): t is PublicStoreConnection => t != null)
      .map((t) => ({
        plataforma: t.platform,
        tienda: t.shop_name ?? t.shop_domain,
        dominio: t.shop_domain,
        estado: t.status,
        metodo: t.connection_method,
        conectado_desde: t.installed_at,
      })),
  }
}

/** El canal pedido, o un error que dice cuáles valen. */
function leerCanal(valor: unknown): Channel {
  const canal = String(valor ?? '').trim() as Channel
  if (!CANALES_CONECTABLES.includes(canal)) {
    throw new Error(
      `no se puede desconectar "${canal}" — los canales son: ${CANALES_CONECTABLES.join(', ')}`,
    )
  }
  return canal
}

/** "Instagram y Comentarios IG": lo que cae junto, dicho junto. */
function nombresDelGrupo(canal: Channel): string {
  return canalesDelGrupo(canal)
    .map((c) => CHANNEL_DISPLAY[c]?.label ?? c)
    .join(' y ')
}

async function desconectar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const canal = leerCanal(args.canal)
  const cortadas = await desconectarCanal(ctx.db, {
    workspaceId: ctx.workspaceId,
    channel: canal,
  })
  return {
    desconectadas: cortadas,
    nota:
      cortadas.length === 0
        ? `No había ninguna conexión activa de ${nombresDelGrupo(canal)}.`
        : `${nombresDelGrupo(canal)} quedó desconectado. Para volver hay que reconectar desde Ajustes → Canales.`,
  }
}

export const INTEGRATION_CAPABILITIES: Capability[] = [
  {
    key: 'integraciones.estado',
    description:
      'Con qué está conectada la cuenta: cada canal (WhatsApp, Instagram, Messenger, comentarios, Gmail, Outlook, Mercado Libre, TikTok) con la cuenta del otro lado, si está conectado o caído, desde cuándo, el último error y cuándo vence su token; más la tienda conectada (Shopify, Tiendanube, WooCommerce). Es lo que hay que mirar cuando dejaron de entrar o de salir mensajes por un canal.',
    descriptionEn:
      'What the account is connected to: every channel (WhatsApp, Instagram, Messenger, comments, Gmail, Outlook, Mercado Libre, TikTok) with the account on the other side, whether it is connected or down, since when, the last error and when its token expires; plus the connected store (Shopify, Tiendanube, WooCommerce). This is what to look at when messages stopped coming in or going out through a channel.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: estado,
  },

  {
    key: 'integraciones.desconectar',
    description:
      'Desconecta un canal en toda la cuenta: deja de recibir y de enviar por ahí. En Facebook e Instagram cae también la conexión hermana de comentarios, porque comparten el mismo acceso. No se deshace desde acá: reconectar exige que una persona autorice de nuevo en Ajustes → Canales.',
    descriptionEn:
      'Disconnects a channel for the whole account: it stops receiving and sending through it. On Facebook and Instagram the sibling comments connection goes down too, because they share the same access. It cannot be undone from here: reconnecting requires a person to authorize again in Settings → Channels.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        canal: {
          type: 'string',
          enum: CANALES_CONECTABLES,
          description: 'Canal a desconectar, tal como aparece en integraciones.estado.',
        },
      },
      required: ['canal'],
    },
    async preview(ctx, args) {
      const canal = leerCanal(args.canal)
      const nombres = nombresDelGrupo(canal)
      const vivas = await listarConexionesDeCanal(ctx.db, ctx.workspaceId, canal)
      if (vivas.length === 0) {
        return `No hay ninguna conexión activa de ${nombres} en esta cuenta: no habría nada que desconectar.`
      }
      // Las cuentas concretas, no el nombre del canal: el comercio puede tener
      // dos números o dos páginas, y "desconectaría WhatsApp" no le dice cuál.
      const cuentas = [
        ...new Set(vivas.map((c) => c.label ?? c.external_account_id ?? c.id)),
      ].join(', ')
      return (
        `Desconectaría ${nombres} (${cuentas}) en toda la cuenta. ` +
        `Dejan de entrar los mensajes que lleguen por ahí, el agente no vuelve a contestar en ese canal, ` +
        `y las automatizaciones y campañas que envían por ${nombres} empiezan a fallar. ` +
        `No se deshace llamando de nuevo: para volver, alguien tiene que reconectar en Ajustes → Canales y autorizar los permisos otra vez.`
      )
    },
    run: desconectar,
  },
]
