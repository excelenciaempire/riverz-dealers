import { ensureTag } from '@/lib/contacts/tags'
import type { supabaseAdmin } from './admin-client'
import type { BuilderStepInput } from './steps-tree'
import type { ValidationIssue } from './validate'

/**
 * Cambia los nombres por ids reales del workspace, en todos lados.
 *
 * `add_tag` sólo entiende `tag_id`, y una receta no puede traer el id de una
 * etiqueta de un workspace que todavía no existe. Sin esto, el rescate de
 * carrito llega con DOS selectores de etiqueta vacíos e indistinguibles entre
 * sí, y no se puede activar hasta que alguien les invente nombre a las dos.
 *
 * Corre en el guardado —no en la instalación— porque el camino vivo de la
 * galería no pasa por ningún endpoint de instalación: la tarjeta abre una
 * vista previa en el constructor y lo que se guarda es un árbol común y
 * corriente. El `tag_name` viaja dentro de `step_config`, que nadie toca de
 * punta a punta.
 *
 * **La regla: se crea lo que vas a PONER, nunca lo que vas a PREGUNTAR.**
 * Etiquetar a alguien con una etiqueta nueva es legítimo. Preguntar "¿tiene la
 * etiqueta X?" por una que no existe es una rama muerta: nadie la tiene, la
 * respuesta va a ser siempre que no, y crearla en silencio esconde que el
 * nombre estaba mal escrito. Ahí se devuelve un problema con la lista de las
 * que sí existen, y el modelo corrige en la misma vuelta.
 *
 * Sólo rellena huecos: un id ya elegido no se pisa nunca.
 */
export async function resolverEtiquetas(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  steps: BuilderStepInput[],
  cache: Map<string, string> = new Map(),
): Promise<BuilderStepInput[]> {
  const r = await resolverReferencias(admin, workspaceId, { pasos: steps }, cache)
  return r.pasos
}

export interface EntradaReferencias {
  pasos: BuilderStepInput[]
  /** La config del disparador, que también puede traer un nombre de etiqueta. */
  triggerConfig?: Record<string, unknown>
}

export interface SalidaReferencias {
  pasos: BuilderStepInput[]
  triggerConfig: Record<string, unknown>
  problemas: ValidationIssue[]
}

/**
 * Todo lo que viaja por nombre, convertido a lo que el motor entiende.
 *
 * Etiquetas de `add_tag`/`remove_tag`, etiquetas de una pregunta, grupos de una
 * pregunta, el agente de una llamada, y la etiqueta del disparador.
 */
export async function resolverReferencias(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  entrada: EntradaReferencias,
  cache: Map<string, string> = new Map(),
): Promise<SalidaReferencias> {
  const ctx: Ctx = { admin, workspaceId, cache, problemas: [], catalogo: {} }
  const pasos = await recorrer(entrada.pasos, ctx)
  const triggerConfig = await resolverDisparador(entrada.triggerConfig ?? {}, ctx)
  return { pasos, triggerConfig, problemas: ctx.problemas }
}

interface Ctx {
  admin: ReturnType<typeof supabaseAdmin>
  workspaceId: string
  cache: Map<string, string>
  problemas: ValidationIssue[]
  catalogo: { etiquetas?: Map<string, string>; grupos?: Map<string, string> }
}

async function recorrer(steps: BuilderStepInput[], ctx: Ctx): Promise<BuilderStepInput[]> {
  const out: BuilderStepInput[] = []
  for (const s of steps) {
    const cfg = { ...((s.step_config ?? {}) as Record<string, unknown>) }
    const nombre = typeof cfg.tag_name === 'string' ? cfg.tag_name.trim() : ''

    if (s.step_type === 'add_tag' || s.step_type === 'remove_tag') {
      if (nombre && !texto(cfg.tag_id)) {
        // Se crea: vas a etiquetar gente con ella.
        const id = await ensureTag(ctx.admin, ctx.workspaceId, nombre, { cache: ctx.cache })
        if (id) cfg.tag_id = id
      }
    }

    if (s.step_type === 'condition' && cfg.subject === 'tag_presence') {
      if (nombre && !esUuid(cfg.operand)) {
        const id = await buscarEtiqueta(ctx, nombre)
        if (id) cfg.operand = id
      }
    }

    if (s.step_type === 'condition' && cfg.subject === 'in_segment') {
      const grupo = typeof cfg.segment_name === 'string' ? cfg.segment_name.trim() : ''
      if (grupo && !esUuid(cfg.operand)) {
        const id = await buscarGrupo(ctx, grupo)
        if (id) cfg.operand = id
      }
    }

    if (s.step_type === 'voice_call') {
      const agente = typeof cfg.agent_name === 'string' ? cfg.agent_name.trim() : ''
      if (agente && !texto(cfg.agent_id)) {
        const id = await buscarAgenteDeVoz(ctx, agente)
        if (id) cfg.agent_id = id
      }
    }

    const paso: BuilderStepInput = { ...s, step_config: cfg }
    out.push(
      s.branches
        ? {
            ...paso,
            branches: {
              yes: await recorrer(s.branches.yes ?? [], ctx),
              no: await recorrer(s.branches.no ?? [], ctx),
            },
          }
        : paso,
    )
  }
  return out
}

/**
 * La etiqueta de un disparador `tag_added`, que vive fuera de los pasos.
 *
 * No se crea, por lo mismo que en una pregunta: una etiqueta recién creada no
 * se la puso nadie, así que la automatización no dispararía nunca.
 */
async function resolverDisparador(
  config: Record<string, unknown>,
  ctx: Ctx,
): Promise<Record<string, unknown>> {
  const nombre = typeof config.tag_name === 'string' ? config.tag_name.trim() : ''
  if (!nombre || texto(config.tag_id)) return config
  const id = await buscarEtiqueta(ctx, nombre)
  return id ? { ...config, tag_id: id } : config
}

async function buscarEtiqueta(ctx: Ctx, nombre: string): Promise<string | null> {
  if (!ctx.catalogo.etiquetas) {
    const { data } = await ctx.admin
      .from('tags')
      .select('id, name')
      .eq('workspace_id', ctx.workspaceId)
      .limit(500)
    ctx.catalogo.etiquetas = new Map(
      ((data ?? []) as { id: string; name: string | null }[]).map((t) => [
        (t.name ?? '').trim().toLowerCase(),
        t.id,
      ]),
    )
  }
  const id = ctx.catalogo.etiquetas.get(nombre.trim().toLowerCase())
  if (id) return id
  ctx.problemas.push({
    path: 'etiqueta',
    message: `no existe la etiqueta «${nombre}» en esta cuenta. Preguntar por una que nadie tiene da siempre que no. Las que hay: ${listar(ctx.catalogo.etiquetas)}`,
  })
  return null
}

async function buscarGrupo(ctx: Ctx, nombre: string): Promise<string | null> {
  if (!ctx.catalogo.grupos) {
    const { data } = await ctx.admin
      .from('contact_segments')
      .select('id, name')
      .eq('workspace_id', ctx.workspaceId)
      .limit(200)
    ctx.catalogo.grupos = new Map(
      ((data ?? []) as { id: string; name: string | null }[]).map((g) => [
        (g.name ?? '').trim().toLowerCase(),
        g.id,
      ]),
    )
  }
  const id = ctx.catalogo.grupos.get(nombre.trim().toLowerCase())
  if (id) return id
  ctx.problemas.push({
    path: 'grupo',
    message: `no existe el grupo «${nombre}» en esta cuenta. Los que hay: ${listar(ctx.catalogo.grupos)}`,
  })
  return null
}

async function buscarAgenteDeVoz(ctx: Ctx, nombre: string): Promise<string | null> {
  const { data } = await ctx.admin
    .from('ai_agents')
    .select('id, name')
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .eq('voice_enabled', true)
    .limit(50)
  const filas = (data ?? []) as { id: string; name: string | null }[]
  const buscado = nombre.trim().toLowerCase()
  const exacto = filas.find((f) => (f.name ?? '').trim().toLowerCase() === buscado)
  if (exacto) return exacto.id
  const parecido = filas.find((f) => (f.name ?? '').toLowerCase().includes(buscado))
  if (parecido) return parecido.id
  ctx.problemas.push({
    path: 'agente_voz',
    message: `no hay ningún agente de voz que se llame «${nombre}». Los que hay: ${filas.map((f) => f.name).filter(Boolean).join(', ') || 'ninguno'}`,
  })
  return null
}

function listar(m: Map<string, string> | undefined): string {
  if (!m || m.size === 0) return 'ninguna'
  return [...m.keys()].slice(0, 20).join(', ')
}

function texto(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function esUuid(v: unknown): boolean {
  return typeof v === 'string' && UUID_RE.test(v)
}
