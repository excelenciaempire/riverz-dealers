import { supabaseAdmin } from '@/lib/automations/admin-client'
import { SCHEDULED_JOBS, isStale } from '@/lib/cron/schedule'
import { desdeCapacidad, type McpTool } from './tool'
import { MERCHANT_TOOLS } from './merchant-tools'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'

export type { McpTool, McpCaller, Risk } from './tool'

/**
 * Las herramientas que la operación expone a un agente.
 *
 * No son un CRUD de tablas: son las preguntas y las acciones que uno
 * realmente necesita cuando algo no salió. "¿Por qué no le llegó el mensaje a
 * esta persona?" es una herramienta; "SELECT sobre messages" no.
 *
 * Casi ninguna se implementa acá. Lo que sabe hacer Riverz sobre una cuenta
 * vive en `src/lib/capabilities`, y este archivo publica esas capacidades por
 * el protocolo. La diferencia no es de estilo: cuando la lógica estaba acá
 * adentro, la misma pregunta tenía dos respuestas —una la calculaba la pantalla
 * y otra el MCP— y no coincidían. Ahora el agente y el panel leen lo mismo.
 *
 * Quedan escritas a mano las dos que NO son sobre una cuenta: listar las
 * cuentas y el estado de los trabajos programados. Esas hablan de la
 * plataforma, y la capa de capacidades opera siempre sobre un solo comercio.
 *
 * Cada una declara su riesgo, y de eso depende si se ejecuta sola:
 *
 *   lectura       — no cambia nada, se ejecuta siempre.
 *   reversible    — cambia algo que se puede deshacer (prender, pausar,
 *                   correr un cron). Se ejecuta sola.
 *   irreversible  — le llega a una persona, o no se puede deshacer. NO se
 *                   ejecuta: devuelve qué haría y espera confirmación.
 */

const db = () => supabaseAdmin()

export const MCP_TOOLS: McpTool[] = [
  {
    name: 'cuentas_listar',
    description:
      'Lista las cuentas (workspaces) vivas con su nombre, cuántos contactos y canales tienen, y cuántas automatizaciones activas. Es el punto de entrada: el workspace_id que devuelve se usa en todas las demás. Con una clave de comercio devuelve sólo la suya.',
    descriptionEn:
      'Lists the live accounts (workspaces) with their name, how many contacts and channels they have, and how many automations are active. It is the entry point: the workspace_id it returns is used by every other tool. With a merchant key it returns only its own.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    async run(args) {
      // Esta no pasa por la capa de capacidades justamente porque puede hablar
      // de VARIAS cuentas: es la única que existe antes de saber cuál.
      //
      // Con una llave de comercio el servidor ya inyectó su workspace_id, así
      // que la lista se recorta a esa cuenta. Sin ese recorte, la herramienta
      // de "punto de entrada" sería, para un comercio, la lista completa de
      // clientes de Riverz.
      let q = db()
        .from('workspaces')
        .select('id, name, created_at')
        .is('deleted_at', null)
        .order('created_at')
      if (args.workspace_id) q = q.eq('id', String(args.workspace_id))
      const { data } = await q
      const cuentas = (data ?? []) as { id: string; name: string; created_at: string }[]
      return Promise.all(
        cuentas.map(async (w) => {
          const [contactos, canales, autos] = await Promise.all([
            db().from('contacts').select('id', { count: 'exact', head: true }).eq('workspace_id', w.id),
            db()
              .from('channel_connections')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', w.id)
              .eq('status', 'connected'),
            db()
              .from('automations')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', w.id)
              .eq('is_active', true)
              .is('deleted_at', null),
          ])
          return {
            workspace_id: w.id,
            nombre: w.name,
            contactos: contactos.count ?? 0,
            canales_conectados: canales.count ?? 0,
            automatizaciones_activas: autos.count ?? 0,
          }
        }),
      )
    },
  },

  desdeCapacidad('operacion_estado', 'operacion.estado'),
  desdeCapacidad('por_que_no_salio', 'mensajes.diagnostico'),
  desdeCapacidad('automatizacion_activar', 'automatizaciones.activar'),
  desdeCapacidad('automatizacion_editar_espera', 'automatizaciones.editar_espera'),

  {
    name: 'cron_estado',
    description:
      'Los trabajos programados de la plataforma: nombre, frecuencia y cómo terminó la última corrida de cada uno.',
    descriptionEn:
      'The platform scheduled jobs: name, frequency and how the last run of each one ended.',
    risk: 'lectura',
    platformOnly: true,
    schema: { type: 'object', properties: {} },
    async run() {
      // El mismo RPC que mira el panel, y no un reduce propio sobre una ventana
      // de 24 h: así la respuesta del agente y la pantalla no se contradicen, y
      // los trabajos diarios no desaparecen por quedar fuera de la ventana.
      const { data } = await db().rpc('admin_cron_health')
      const ultima = new Map<string, unknown>()
      for (const r of (data ?? []) as { name: string }[]) {
        ultima.set(r.name, r)
      }
      return SCHEDULED_JOBS.map((j) => ({
        nombre: j.name,
        frecuencia: j.schedule,
        disparado_por: j.parent ?? 'reloj',
        atrasado: isStale(j.schedule, (ultima.get(j.name) as { started_at?: string } | undefined)?.started_at ?? null),
        ultima_corrida: ultima.get(j.name) ?? null,
      }))
    },
  },

  desdeCapacidad('aprobacion_decidir', 'aprobaciones.decidir'),
  desdeCapacidad('mensaje_enviar', 'mensajes.enviar'),
  ...(SHOW_RIVERZ_IMPROVEMENTS ? [
    desdeCapacidad('http_acciones_listar', 'integraciones.http_catalogo'),
    desdeCapacidad('http_accion_consultar', 'integraciones.http_consultar'),
    desdeCapacidad('http_accion_ejecutar', 'integraciones.http_ejecutar'),
  ] : []),
]

/**
 * Todo lo que expone el servidor: las de operación (arriba, pensadas para el
 * equipo) más las del comercio. Van en archivos separados porque contestan
 * preguntas distintas, y juntas en una sola lista porque para el agente del otro
 * lado son una sola caja de herramientas.
 */
export const ALL_TOOLS: McpTool[] = [...MCP_TOOLS, ...MERCHANT_TOOLS]

export function findTool(name: string): McpTool | undefined {
  return ALL_TOOLS.find((t) => t.name === name)
}
