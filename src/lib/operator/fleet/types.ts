/**
 * El equipo que opera la cuenta.
 *
 * El Operador dejó de ser un agente con veinticinco herramientas mezcladas y
 * pasó a ser un orquestador con especialistas. El motivo no es estético: con
 * todo el catálogo en una sola caja, el modelo elige mal seguido, la
 * descripción de cada herramienta compite con las otras veinticuatro por su
 * atención, y no hay forma de darle a nadie instrucciones de dominio sin
 * escribirlas para todos.
 *
 * Un subagente tiene su recorte del catálogo, sus instrucciones y su propio
 * mini loop. El orquestador se queda con las lecturas —para contestar una
 * pregunta simple sin delegar— y dos herramientas de equipo.
 *
 * Ojo con el nombre: esta flota es INTERNA y opera Riverz. La otra flota, la de
 * `src/lib/ai/roles.ts`, son los agentes con rol que le contestan a los
 * clientes del comercio. No se tocan entre sí.
 */
import type { Artefacto } from '../artifacts'

export const SUBAGENT_IDS = [
  'automatizaciones',
  'flujos',
  'plantillas',
  'campanas',
  'bandeja',
  'contactos',
  'productos',
  'comentarios',
  'voz',
  'agentes',
  'prospeccion',
  'pedidos',
  'integraciones',
  'ajustes',
] as const

export type SubagentId = (typeof SUBAGENT_IDS)[number]

export function esSubagentId(v: unknown): v is SubagentId {
  return typeof v === 'string' && (SUBAGENT_IDS as readonly string[]).includes(v)
}

/**
 * La clave i18n con el nombre de un especialista.
 *
 * Está acá y no en el roster porque la pantalla lo necesita y el roster importa
 * el catálogo entero: por un nombre de catorce letras se arrastraban las setenta
 * y dos capacidades al bundle del navegador. El roster declara la misma clave en
 * su `nombreKey`, y una prueba verifica que no se separen.
 */
export function nombreDeSubagente(id: SubagentId): string {
  return `operation.sub${id[0].toUpperCase()}${id.slice(1)}`
}

/** Quién hizo cada llamada al modelo. El orquestador también cuenta. */
export type Quien = SubagentId | 'orquestador'

export interface SubagentSpec {
  id: SubagentId
  /** Clave i18n del namespace `operation`: es el nombre que se ve en la mesa. */
  nombreKey: string
  /**
   * Qué hace y qué NO hace, en dos frases.
   *
   * Es lo único que lee el orquestador para repartir, así que la frase negativa
   * vale tanto como la positiva: sin ella, el de ventas intenta resolver una
   * devolución y el de postventa intenta vender. Misma lección que
   * `ROLE_BEHAVIOR` en `src/lib/ai/roles.ts`.
   */
  alcance: string
  /**
   * Su recorte del catálogo. Cada entrada es una clave exacta
   * (`contactos.buscar`) o un prefijo terminado en punto (`automatizaciones.`).
   */
  capacidades: string[]
  /**
   * `constructor` piensa antes de escribir; `mecanico` ejecuta un encargo
   * acotado. La diferencia son modelo y esfuerzo, y se resuelve en `runner.ts`:
   * el spec dice qué clase de trabajo hace, no con qué modelo.
   */
  tier: 'constructor' | 'mecanico'
  /** Vueltas propias. Nada que ver con las del orquestador. */
  maxIters: number
  /** Instrucciones del dominio. En español, fuera de i18n, como `prompt.ts`. */
  instrucciones: string
  /**
   * A quién le puede encargar algo, y sólo a ésos.
   *
   * Profundidad uno: el subagente al que le piden NO recibe esta herramienta,
   * así que un pedido no puede pedir. Eso vuelve imposible el ciclo por
   * construcción, sin detector en tiempo de ejecución.
   */
  puedePedirle: SubagentId[]
}

/**
 * Lo que un paso le deja al siguiente.
 *
 * `refs` lo calcula el SERVIDOR desde el resultado de la capacidad, nunca el
 * modelo. Es la misma regla que el `preview` y el artefacto, y acá importa más:
 * es lo que permite que el subagente de automatizaciones use el nombre exacto
 * de la plantilla que acaba de crear el de plantillas, en vez de inventarlo.
 */
export interface Hecho {
  de: SubagentId
  /** Qué pasó, en una línea. */
  resumen: string
  /** Datos duros para el paso siguiente: `{ plantilla: 'carrito_v1' }`. */
  refs?: Record<string, string>
}

/** Lo que recibe un subagente al arrancar. */
export interface Encargo {
  texto: string
  /** Sólo los hechos de sus dependencias, recortados. */
  hechos: Hecho[]
}

/** Cómo le fue a un subagente. */
export interface ResultadoSubagente {
  agente: SubagentId
  ok: boolean
  /** Para el orquestador y para el pizarrón. */
  resumen: string
  refs?: Record<string, string>
  propuestas: number
  construidas: number
  artefactos: Artefacto[]
  error?: string
}
