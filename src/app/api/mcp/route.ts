import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { limitByKey } from '@/lib/rate-limit'
import { MCP_TOOLS, findTool, type McpTool } from '@/lib/mcp/registry'

/**
 * La operación de Riverz, expuesta como herramientas.
 *
 * Es un servidor MCP mínimo hablado en JSON-RPC sobre HTTP: `initialize`,
 * `tools/list`, `tools/call`. Va escrito a mano y no con el SDK porque son
 * tres métodos y el SDK trae su propio transporte, que no encaja con un route
 * handler de Next.
 *
 * QUÉ PROTEGE
 *
 * Esto opera sobre cuentas de comercios reales — la de Pilar tiene 3.264
 * contactos — así que no alcanza con que ande:
 *
 *   * Entra sólo con la clave de plataforma. No hay sesión de navegador ni
 *     usuario: es una puerta de servicio.
 *   * El workspace es un parámetro explícito de cada herramienta. Nunca se
 *     adivina "la cuenta del que llama", que es justo el error que enterró
 *     dos flujos en esta misma base.
 *   * Todo queda registrado, incluidas las lecturas: sobre datos ajenos,
 *     saber quién miró qué también es parte de la respuesta.
 *   * Lo irreversible no se ejecuta de una: devuelve qué haría y un token de
 *     un solo uso. Sin ese token en la segunda llamada, no pasa nada. La
 *     confirmación vive en el protocolo y no en la buena voluntad del cliente
 *     que lo llama.
 */

export const runtime = 'nodejs'

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function rpcOk(id: RpcRequest['id'], result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function rpcError(id: RpcRequest['id'], code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

/** La clave de plataforma, comparada sin filtrar el tiempo que tarda. */
function autorizado(req: Request): string | null {
  const esperado = process.env.MCP_ADMIN_TOKEN
  if (!esperado) return null
  const header = req.headers.get('authorization') ?? ''
  const enviado = header.replace(/^Bearer\s+/i, '')
  if (!enviado) return null
  const a = Buffer.from(enviado)
  const b = Buffer.from(esperado)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return req.headers.get('x-mcp-actor') || 'plataforma'
}

/**
 * El token de confirmación.
 *
 * Se firma con la herramienta y sus argumentos adentro, así que sólo sirve
 * para ejecutar exactamente lo que se mostró: cambiar el texto del mensaje
 * después de que lo aprobaron invalida el token. Vive cinco minutos.
 */
function macDe(tool: string, args: unknown, vence: number): string {
  return createHmac('sha256', process.env.ENCRYPTION_KEY ?? '')
    .update(`${tool}:${JSON.stringify(args)}:${vence}`)
    .digest('base64url')
    .slice(0, 24)
}

function firmarConfirmacion(tool: string, args: unknown): string {
  const vence = Date.now() + 5 * 60_000
  return `${vence}.${macDe(tool, args, vence)}`
}

function confirmacionValida(token: string, tool: string, args: unknown): boolean {
  const [venceRaw, mac] = (token ?? '').split('.')
  const vence = Number(venceRaw)
  if (!Number.isFinite(vence) || vence < Date.now()) return false
  // Se recalcula con el vencimiento que vino en el token: si alguien lo toca,
  // la firma deja de cerrar.
  const esperado = Buffer.from(macDe(tool, args, vence))
  const recibido = Buffer.from(mac ?? '')
  if (esperado.length !== recibido.length) return false
  return timingSafeEqual(esperado, recibido)
}

/**
 * Los argumentos, sin lo que identifica a un comprador.
 *
 * `por_que_no_salio` recibe un teléfono y `mensaje_enviar` un texto que le llega
 * a una persona: guardarlos tal cual mete PII del cliente en una tabla de
 * plataforma que después se lee desde /admin. Se conserva la forma —qué campos
 * se usaron— porque eso es lo que hace auditable la llamada.
 */
const CAMPOS_PII = new Set(['telefono', 'phone', 'texto', 'text', 'email'])

function sinPii(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    out[k] = CAMPOS_PII.has(k) ? '[oculto]' : v
  }
  return out
}

async function anotar(args: {
  actor: string
  tool: string
  toolArgs: Record<string, unknown>
  risk: string
  ok: boolean
  summary: string
}) {
  try {
    await supabaseAdmin()
      .from('platform_audit_log')
      .insert({
        workspace_id: (args.toolArgs.workspace_id as string) ?? null,
        actor: args.actor,
        tool: args.tool,
        args: sinPii(args.toolArgs),
        risk: args.risk,
        ok: args.ok,
        summary: args.summary.slice(0, 500),
      })
  } catch {
    /* el registro no puede tumbar la operación */
  }
}

function comoTexto(valor: unknown): string {
  return typeof valor === 'string' ? valor : JSON.stringify(valor, null, 1)
}

/**
 * El resumen que queda guardado, sin arrastrar datos del comprador.
 *
 * Una herramienta de LECTURA devuelve justo lo que no puede vivir en una tabla
 * de plataforma: `por_que_no_salio` trae nombre y teléfono del contacto, y eso
 * terminaba entero dentro de `platform_audit_log.summary` — visible después
 * desde /admin, que es solo-metadatos por diseño. Para las lecturas alcanza con
 * el tamaño de lo que se devolvió: la pregunta que contesta la auditoría es
 * "quién miró qué", no "qué decía".
 *
 * Las que escriben sí guardan su resumen: son pocas, no devuelven fichas de
 * clientes, y ahí el detalle es justamente lo que uno vuelve a leer.
 */
function resumenSeguro(tool: McpTool, salida: unknown): string {
  if (tool.risk !== 'lectura') return comoTexto(salida).slice(0, 300)
  const n = Array.isArray(salida)
    ? salida.length
    : salida && typeof salida === 'object'
      ? Object.keys(salida).length
      : 1
  return `ok · ${n} resultado(s)`
}

/**
 * Techo de llamadas por actor.
 *
 * Las rutas de `/admin` ya se limitan (120/min por email) y esta puerta no,
 * aunque de este lado están las herramientas que ESCRIBEN: sin techo, una clave
 * de plataforma filtrada permite mandar mensajes a clientes reales en bucle.
 */
const MCP_RATE = { limit: 60, windowMs: 60_000 }

export async function POST(request: Request) {
  const actor = autorizado(request)
  if (!actor) {
    return rpcError(null, -32001, 'clave de plataforma inválida o ausente')
  }

  const rl = await limitByKey(`mcp:${actor}`, MCP_RATE)
  if (!rl.success) {
    return rpcError(null, -32005, 'demasiadas llamadas: probá de nuevo en un minuto')
  }

  let body: RpcRequest
  try {
    body = (await request.json()) as RpcRequest
  } catch {
    return rpcError(null, -32700, 'JSON inválido')
  }

  switch (body.method) {
    case 'initialize':
      return rpcOk(body.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'riverz', version: '1' },
      })

    case 'notifications/initialized':
    case 'ping':
      return rpcOk(body.id, {})

    case 'tools/list':
      return rpcOk(body.id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          // El riesgo va en la descripción para que el agente sepa, antes de
          // llamar, cuáles van a pedirle confirmación.
          description:
            t.risk === 'irreversible'
              ? `${t.description} [pide confirmación]`
              : t.description,
          inputSchema: {
            ...t.schema,
            properties: {
              ...t.schema.properties,
              ...(t.risk === 'irreversible'
                ? {
                    confirm_token: {
                      type: 'string',
                      description:
                        'Token que devuelve la primera llamada. Sin él sólo se muestra qué haría.',
                    },
                  }
                : {}),
            },
          },
        })),
      })

    case 'tools/call': {
      const nombre = String(body.params?.name ?? '')
      const tool: McpTool | undefined = findTool(nombre)
      if (!tool) return rpcError(body.id, -32602, `no existe la herramienta ${nombre}`)

      const argsCrudos = (body.params?.arguments ?? {}) as Record<string, unknown>
      const { confirm_token: token, ...args } = argsCrudos

      // Lo irreversible se muestra antes de hacerse.
      if (tool.risk === 'irreversible') {
        if (!token || !confirmacionValida(String(token), tool.name, args)) {
          const detalle = tool.preview ? await tool.preview(args) : comoTexto(args)
          await anotar({
            actor,
            tool: tool.name,
            toolArgs: args,
            risk: tool.risk,
            ok: true,
            summary: 'se mostró el plan, sin ejecutar',
          })
          return rpcOk(body.id, {
            content: [
              {
                type: 'text',
                text:
                  `Esto NO se ejecutó todavía.\n\n${detalle}\n\n` +
                  `Para hacerlo, volvé a llamar la herramienta con confirm_token: ` +
                  `${firmarConfirmacion(tool.name, args)}`,
              },
            ],
          })
        }
      }

      try {
        const salida = await tool.run(args)
        await anotar({
          actor,
          tool: tool.name,
          toolArgs: args,
          risk: tool.risk,
          ok: true,
          summary: resumenSeguro(tool, salida),
        })
        return rpcOk(body.id, {
          content: [{ type: 'text', text: comoTexto(salida) }],
        })
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err)
        await anotar({
          actor,
          tool: tool.name,
          toolArgs: args,
          risk: tool.risk,
          ok: false,
          summary: motivo,
        })
        return rpcOk(body.id, {
          content: [{ type: 'text', text: `Falló: ${motivo}` }],
          isError: true,
        })
      }
    }

    default:
      return rpcError(body.id, -32601, `método no soportado: ${body.method}`)
  }
}
