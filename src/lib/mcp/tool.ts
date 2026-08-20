import { supabaseAdmin } from '@/lib/automations/admin-client'
import { findCapability, withWorkspaceArg } from '@/lib/capabilities/registry'

/**
 * La forma de una herramienta del protocolo, y el puente hacia las capacidades.
 *
 * Vive aparte de `registry.ts` porque las dos listas de herramientas —la de
 * operación y la del comercio— necesitan el puente, y si viviera en una de
 * ellas las dos se importarían en círculo.
 */

export type Risk = 'lectura' | 'reversible' | 'irreversible'

/** Quién está llamando, para que quede anotado en lo que se ejecute. */
export interface McpCaller {
  label: string
}

export interface McpTool {
  name: string
  /**
   * Qué capacidad publica, cuando publica una.
   *
   * El nombre público y la clave interna son distintos a propósito (el nombre
   * es un contrato con clientes ya configurados), así que sin esto no hay forma
   * de cruzar el catálogo contra sus consumidores — y una capacidad huérfana,
   * escrita y probada pero que no puede llamar nadie, pasa todos los tests.
   * Las dos herramientas escritas a mano no lo traen.
   */
  capabilityKey?: string
  description: string
  /**
   * La misma descripción en inglés, para la documentación pública.
   *
   * `description` es lo que viaja por el protocolo y sigue en español: es el
   * texto que lee el modelo del cliente, y cambiarlo según quién mira la página
   * web haría que la misma herramienta se llame distinto en dos lugares. Esto
   * es sólo para la página.
   */
  descriptionEn?: string
  risk: Risk
  schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  run: (args: Record<string, unknown>, caller?: McpCaller) => Promise<unknown>
  /** Qué se le muestra a la persona antes de ejecutar una irreversible. */
  preview?: (args: Record<string, unknown>, caller?: McpCaller) => Promise<string>
  /**
   * Sólo para la llave del equipo. Son las que hablan de la plataforma y no de
   * una cuenta: a un comercio no le sirven y le muestran fontanería ajena.
   */
  platformOnly?: boolean
}

export function workspaceDe(args: Record<string, unknown>): string {
  const v = String(args.workspace_id ?? '')
  if (!v) throw new Error('falta workspace_id: toda herramienta opera sobre una cuenta')
  return v
}

/**
 * Publica una capacidad como herramienta del protocolo.
 *
 * Lo único que agrega es `workspace_id`: adentro la cuenta viaja en el contexto
 * —donde un modelo no la puede cambiar— y acá afuera tiene que ser un argumento,
 * porque del otro lado puede haber una llave del equipo operando varias cuentas.
 * El servidor ya se encargó de que ese argumento sea el correcto antes de
 * llegar hasta acá (ver `alcance()` en la ruta).
 *
 * Corta al construirse, y no al llamarse, si la clave no existe: así una clave
 * mal escrita rompe el arranque y no una llamada de un cliente a las tres de la
 * mañana.
 */
export function desdeCapacidad(name: string, key: string): McpTool {
  const cap = findCapability(key)
  if (!cap) {
    throw new Error(`la herramienta ${name} apunta a una capacidad inexistente: ${key}`)
  }

  const contexto = (args: Record<string, unknown>, caller?: McpCaller) => ({
    db: supabaseAdmin(),
    workspaceId: workspaceDe(args),
    actor: { type: 'mcp' as const, id: caller?.label ?? null },
  })

  return {
    name,
    capabilityKey: key,
    description: cap.description,
    descriptionEn: cap.descriptionEn,
    risk: cap.risk,
    schema: withWorkspaceArg(cap.schema),
    run: (args, caller) => cap.run(contexto(args, caller), args),
    preview: cap.preview
      ? (args, caller) => cap.preview!(contexto(args, caller), args)
      : undefined,
  }
}
