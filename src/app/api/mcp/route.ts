import { NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { limitByKey } from '@/lib/rate-limit'
import { ALL_TOOLS, findTool, type McpTool } from '@/lib/mcp/registry'
import { resolveActor, rateKey, sameSecret, type McpActor } from '@/lib/mcp/tokens'
import { issuer } from '@/lib/mcp/oauth'

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
 *   * Entra sólo con una llave. No hay sesión de navegador ni usuario: es una
 *     puerta de servicio.
 *   * La llave DICE el alcance. La del equipo cruza cuentas —es la que contesta
 *     "a qué comercio se le rompió algo"— y la de un comercio opera sobre la
 *     suya y sobre ninguna otra. Con una llave de comercio, el `workspace_id`
 *     que venga en los argumentos no se obedece: o coincide o se rechaza.
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

/**
 * Quién llama: el equipo de Riverz o un comercio con su propia llave.
 *
 * La diferencia no es cosmética. Antes había una sola llave y el workspace
 * venía como ARGUMENTO de cada herramienta, o sea que lo elegía quien llamaba.
 * Eso servía sólo mientras la llave fuera del equipo: repartirla a un comercio
 * habría sido repartir todas las cuentas. Con una llave de comercio, el alcance
 * sale de la llave y el argumento deja de tener voz.
 */
async function autorizado(req: Request): Promise<McpActor | null> {
  const header = req.headers.get('authorization') ?? ''
  const presentado = header.replace(/^Bearer\s+/i, '').trim()
  if (!presentado) return null
  return resolveActor(supabaseAdmin(), presentado)
}

/**
 * El workspace sobre el que va a operar esta llamada.
 *
 * Para una llave de comercio es siempre el suyo. Si además mandó un
 * `workspace_id` distinto, se rechaza en vez de ignorarlo en silencio: un
 * agente que cree estar operando sobre otra cuenta tiene que enterarse de que
 * no, y no descubrirlo por los resultados.
 */
function alcance(
  actor: McpActor,
  args: Record<string, unknown>,
): { ok: true; args: Record<string, unknown> } | { ok: false; motivo: string } {
  if (actor.kind === 'platform') return { ok: true, args }

  const pedido = args.workspace_id ? String(args.workspace_id) : null
  if (pedido && pedido !== actor.workspaceId) {
    return {
      ok: false,
      motivo: 'esta clave sólo opera sobre su propia cuenta',
    }
  }
  return { ok: true, args: { ...args, workspace_id: actor.workspaceId } }
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
  return sameSecret(macDe(tool, args, vence), mac ?? '')
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
  actor: McpActor
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
        workspace_id:
          (args.toolArgs.workspace_id as string) ??
          (args.actor.kind === 'workspace' ? args.actor.workspaceId : null),
        actor: args.actor.label,
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

/**
 * Un intento rechazado también se anota.
 *
 * Es el que más dice de los tres: que una llave haya pedido otra cuenta, o
 * escribir sin poder hacerlo, no es ruido — es exactamente lo que uno busca
 * cuando revisa si una llave se filtró. Registrar sólo lo que salió bien deja
 * ese rastro afuera, que es como no tenerlo.
 */
async function rechazo(
  actor: McpActor,
  tool: McpTool,
  args: Record<string, unknown>,
  motivo: string,
): Promise<void> {
  await anotar({
    actor,
    tool: tool.name,
    toolArgs: args,
    risk: tool.risk,
    ok: false,
    summary: `rechazado: ${motivo}`,
  })
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
  return `ok · ${n}`
}

/**
 * La respuesta cuando no hay credencial.
 *
 * Es un 401 con `WWW-Authenticate` apuntando al documento que dice dónde pedir
 * permiso (RFC 9728). Ese encabezado es el que convierte "no tenés acceso" en
 * "andá acá a pedirlo": un conector que descubre servidores solo hace
 * exactamente esto — llama sin credencial, lee esta respuesta y arranca el
 * flujo. Sin el encabezado, la única vía sería pegar un token a mano.
 *
 * El cuerpo sigue siendo JSON-RPC para los clientes que no miran el status.
 */
function sinCredencial() {
  const res = rpcError(null, -32001, 'clave inválida o ausente')
  return new NextResponse(res.body, {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource"`,
    },
  })
}

/**
 * ¿Esta llave puede ver y usar esta herramienta?
 *
 * Dos cortes distintos. Uno es de quién: las que hablan de la plataforma y no
 * de una cuenta son del equipo. El otro es de qué puede hacer la llave: una de
 * sólo lectura no llega a nada que cambie algo, ni siquiera a lo que pide
 * confirmación — la confirmación protege de un error, no de una llave filtrada.
 */
function visible(tool: McpTool, actor: McpActor): boolean {
  if (tool.platformOnly && actor.kind !== 'platform') return false
  if (actor.scope === 'lectura' && tool.risk !== 'lectura') return false
  return true
}

/**
 * Versiones del protocolo que este servidor sabe hablar.
 *
 * Importa más de lo que parece. Se venía respondiendo `2024-11-05` fijo, que en
 * el spec es la revisión del transporte HTTP+SSE — dos endpoints y una conexión
 * abierta. Lo que hay acá es un POST y nada más, que es el transporte
 * "Streamable HTTP" de las revisiones siguientes. Un cliente estricto que lea
 * esa respuesta se queda esperando el canal de eventos que nunca abrimos.
 *
 * Se contesta con la versión que pidió el cliente cuando la conocemos, y con la
 * nuestra cuando no: es lo que dice el spec y es lo que hace que esto siga
 * funcionando con clientes más nuevos sin tocar el código otra vez.
 */
const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05']
const VERSION_PREFERIDA = VERSIONES[0]

function versionNegociada(pedida: unknown): string {
  const v = typeof pedida === 'string' ? pedida : ''
  return VERSIONES.includes(v) ? v : VERSION_PREFERIDA
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
  const actor = await autorizado(request)
  if (!actor) {
    return sinCredencial()
  }

  // Se limita por LLAVE. Antes la clave del limitador salía de la cabecera
  // `x-mcp-actor`, que la elige quien llama: bastaba con variarla en cada
  // pedido para que el techo no existiera.
  const rl = await limitByKey(rateKey(actor), MCP_RATE)
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
        protocolVersion: versionNegociada(body.params?.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: { name: 'riverz', version: '1' },
      })

    case 'notifications/initialized':
    case 'ping':
      return rpcOk(body.id, {})

    case 'tools/list':
      return rpcOk(body.id, {
        tools: ALL_TOOLS.filter((t) => visible(t, actor)).map((t) => ({
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
      const { confirm_token: token, ...crudos } = argsCrudos

      // No alcanza con esconderlas de `tools/list`: quien tenga el nombre puede
      // llamarlas igual.
      if (!visible(tool, actor)) {
        const motivo = tool.platformOnly
          ? `${nombre} es sólo del equipo de Riverz`
          : `esta clave es de sólo lectura y ${nombre} cambia cosas`
        await rechazo(actor, tool, crudos, motivo)
        return rpcError(body.id, -32003, motivo)
      }

      // El alcance ANTES que nada: una llave de comercio opera sobre su cuenta
      // y sobre ninguna otra, diga lo que diga el argumento.
      const scoped = alcance(actor, crudos)
      if (!scoped.ok) {
        await rechazo(actor, tool, crudos, scoped.motivo)
        return rpcError(body.id, -32003, scoped.motivo)
      }
      const args = scoped.args

      // Lo irreversible se muestra antes de hacerse.
      if (tool.risk === 'irreversible') {
        if (!token || !confirmacionValida(String(token), tool.name, args)) {
          let detalle: string
          try {
            detalle = tool.preview
              ? await tool.preview(args, { label: actor.label })
              : comoTexto(args)
          } catch (err) {
            // Una vista previa que no puede describir lo que haría es la forma
            // que tiene una capacidad de decir «esto no se puede»: le falta la
            // plantilla, el contacto no existe, la campaña ya salió. Sin esto,
            // el motivo salía como una excepción sin atrapar y del otro lado se
            // veía un error de servidor en vez de la explicación.
            const motivo = err instanceof Error ? err.message : String(err)
            await anotar({
              actor,
              tool: tool.name,
              toolArgs: args,
              risk: tool.risk,
              ok: false,
              summary: motivo,
            })
            return rpcError(body.id, -32000, motivo)
          }
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
        // La llave que ejecuta viaja hasta la capacidad: es lo que deja
        // registrado QUIÉN aprobó una decisión, y no sólo que se aprobó.
        const salida = await tool.run(args, { label: actor.label })
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
