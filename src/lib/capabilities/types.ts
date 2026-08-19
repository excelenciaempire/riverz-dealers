/**
 * Lo que Riverz sabe hacer sobre una cuenta, en un solo lugar.
 *
 * Antes esto vivía dos veces: la pantalla lo calculaba de una forma y el MCP
 * lo volvía a escribir de otra. No es un problema estético — las dos versiones
 * se contradecían. El panel contaba los mensajes salientes con `neq customer`
 * y paginando; el MCP contaba sólo `agent|bot` y sin paginar. El mismo comercio
 * el mismo día veía dos cifras y ninguna era "la" cifra.
 *
 * Una capacidad es una operación completa sobre UNA cuenta: recibe el contexto
 * (con quién la pide y sobre qué workspace) y los argumentos, y devuelve datos.
 * No es un CRUD de tablas: es "cómo viene la cuenta", "por qué no le llegó el
 * mensaje", "prendé esta automatización".
 *
 * Quién las consume:
 *   - el MCP (`src/lib/mcp/registry.ts`), como adaptador sobre HTTP;
 *   - el Riverz Operator, directo, sin pasar por HTTP;
 *   - las pantallas nuevas, cuando necesitan lo mismo que el agente.
 *
 * El riesgo es la misma escala que ya usaba el MCP, y decide quién ejecuta:
 *
 *   lectura       — no cambia nada. Se ejecuta sola.
 *   reversible    — cambia algo que se deshace llamando de nuevo.
 *   irreversible  — le llega a una persona o no se puede deshacer. Nunca se
 *                   ejecuta sin que alguien la confirme mirando el `preview`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Locale } from '@/lib/i18n/config'
import type { Artefacto } from '@/lib/operator/artifacts'

export type Risk = 'lectura' | 'reversible' | 'irreversible'

/** Quién está pidiendo esto. Va a la auditoría. */
export interface CapabilityActor {
  type: 'mcp' | 'operator' | 'ui' | 'cron'
  /** Usuario, llave o proceso concreto, cuando se sabe. */
  id?: string | null
}

/**
 * El alcance viaja en el contexto y NO en los argumentos, a propósito.
 *
 * Cuando la cuenta es un argumento más, alcanza con que un modelo escriba otro
 * uuid para leer datos ajenos. Acá el `workspace_id` lo pone quien construye el
 * contexto —el servidor MCP desde la llave, la sesión desde la cookie— y la
 * capacidad no tiene forma de cambiarlo.
 */
export interface CapabilityContext {
  /** Cliente con llave de servicio: el recorte por cuenta lo hace cada capacidad. */
  db: SupabaseClient
  workspaceId: string
  actor: CapabilityActor
  /**
   * Idioma del comercio, para lo que se guarda y después se le muestra (el
   * nombre de una automatización creada desde una receta, por ejemplo). No
   * afecta lo que lee el modelo, que siempre es español.
   */
  locale?: Locale
}

/** JSON Schema plano: lo entienden igual el MCP y las tools de Anthropic. */
export interface CapabilitySchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface Capability<A = Record<string, unknown>, R = unknown> {
  /** Clave estable, con dominio: `metricas.resumen`, `automatizaciones.activar`. */
  key: string
  /** En español: es lo que lee el modelo. */
  description: string
  /** Para la documentación pública. */
  descriptionEn: string
  risk: Risk
  /**
   * ¿Esto deja algo APAGADO?
   *
   * `risk` contesta "¿se puede deshacer?" y gobierna la confirmación del MCP.
   * Esta pregunta es otra: "¿el resultado alcanza a alguien?". Una
   * automatización creada en pausa y un agente en borrador no le llegan a
   * ningún cliente, no salen a Meta y no mueven dinero — se pueden borrar y no
   * pasó nada. Prender esa misma automatización sí alcanza a gente.
   *
   * Es lo que permite que el modo automático construya sin preguntar y siga
   * pidiendo un click para lo que se publica. Y es la línea que sostiene la
   * defensa contra instrucciones escondidas en mensajes de clientes: lo peor
   * que consigue un ataque es dejar cosas apagadas que alguien va a ver.
   *
   * Depende de los argumentos cuando hace falta: pausar es inerte, prender no.
   * Ausente = NO inerte. Ante la duda, se propone.
   */
  inerte?: boolean | ((args: A) => boolean)
  /**
   * Sin `workspace_id`: ese va en el contexto. El adaptador MCP se lo agrega
   * al schema que publica hacia afuera.
   */
  schema: CapabilitySchema
  run(ctx: CapabilityContext, args: A): Promise<R>
  /** Qué se le muestra a una persona antes de ejecutar. Obligatorio si es irreversible. */
  preview?(ctx: CapabilityContext, args: A): Promise<string>
  /**
   * Lo mismo que el `preview`, pero dibujable.
   *
   * Se calcula desde los ARGUMENTOS, así que una propuesta puede mostrar el
   * árbol de la automatización antes de que nadie apruebe. `result` llega sólo
   * cuando ya se ejecutó, para lo que no se sabe de antemano (un id, un nombre
   * que puso el servidor).
   *
   * Lo escribe el servidor y no el modelo: es la misma regla que el preview.
   */
  artifact?(ctx: CapabilityContext, args: A, result?: R): Artefacto | null
}

/** Capacidad con argumentos sueltos, que es como llegan desde un modelo. */
export type AnyCapability = Capability<Record<string, unknown>, unknown>
