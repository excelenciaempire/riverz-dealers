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
  /** Authenticated key issuer; never a caller-controlled label or tool argument. */
  userId?: string | null
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
  /** Optional account-specific recipe; general capabilities omit this restriction. */
  workspaceIds?: readonly string[]
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
  /**
   * Lo que devolvió una LECTURA, dibujado.
   *
   * No es `artifact`. Aquél se calcula desde los ARGUMENTOS porque tiene que
   * verse ANTES de ejecutar —es lo que se aprueba—, pasa por el diff y queda
   * guardado en `operator_actions`. Acá ya se ejecutó y no hay nada que
   * aprobar: se dibuja el resultado, y punto.
   *
   * Existe porque el panel del Operador dibujaba sólo lo que se construía. Una
   * cuenta entera de lecturas —métricas, pedidos, contactos, conversaciones,
   * llamadas, integraciones— contestaba un párrafo y dejaba el panel vacío, que
   * es la mitad de lo que se le pide al Operador todos los días.
   *
   * Lo escribe el SERVIDOR, igual que el `preview` y que el artefacto: lo que
   * se muestra tiene que ser lo que de verdad se leyó, no lo que el modelo diga
   * que leyó.
   *
   * Devolver `null` es válido y significa "esto no se dibuja": una lectura que
   * el modelo usa para decidir y que a una persona no le dice nada.
   */
  vista?(ctx: CapabilityContext, args: A, result: R): Artefacto | null
  /**
   * Cómo está la cosa HOY, antes de aplicar estos argumentos.
   *
   * Existe sólo para el diff. "Actualizá el carrito abandonado" es un pedido de
   * cambio, y dibujar el árbol resultante no sirve: quien mira ya conocía esa
   * automatización y necesita ver qué se movió. Con esto, el artefacto viaja
   * marcado — lo que estaba atenuado, lo nuevo encendido, lo que se va tachado.
   *
   * Opcional a propósito: sin él no hay diff y se dibuja todo plano, que es lo
   * correcto para una creación. Lo declaran sólo las capacidades que editan
   * algo que ya existía.
   */
  artifactBefore?(ctx: CapabilityContext, args: A): Promise<Artefacto | null>
  /**
   * Cómo se vuelve atrás, para lo que se puede volver atrás.
   *
   * Aprobar era definitivo: el único recurso frente a algo que salió mal era
   * pedirle al chat que armara lo contrario y confiar en que lo armara bien.
   * Sobre una automatización recién creada eso significa dictar un borrado; y
   * si el modelo se equivoca de id, borra otra.
   *
   * Recibe el `result` que quedó guardado en `operator_actions`, que es donde
   * está el id de lo que se creó. Devuelve, en castellano, qué deshizo.
   *
   * **Sólo lo que de verdad se deshace.** Nada irreversible lo declara: un
   * mensaje enviado, una plantilla en Meta o una llamada hecha no vuelven,
   * y ofrecer un botón que diga lo contrario sería mentir. Ausente = no se
   * puede deshacer, que es el caso por defecto.
   */
  deshacer?(ctx: CapabilityContext, args: A, result: R): Promise<string>
}

/** Capacidad con argumentos sueltos, que es como llegan desde un modelo. */
export type AnyCapability = Capability<Record<string, unknown>, unknown>
