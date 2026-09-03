/**
 * Cómo se edita una automatización que YA existe.
 *
 * Hasta acá lo único que se podía cambiar desde el chat era cuánto dura una
 * espera. "Cambiale el texto del segundo mensaje" no tenía herramienta, y la
 * salida fácil —que el modelo devuelva el árbol nuevo entero— es la peor de
 * todas: reescribe pasos que nadie pidió tocar, y lo que el modelo no sabe
 * describir (una llamada de voz, un webhook, una asignación a un agente) se
 * cae del árbol sin que nadie se entere.
 *
 * Así que se edita por patches, espejo de `src/lib/flows/ai-patches.ts`. De ahí
 * se copian las tres cosas que lo hacen seguro:
 *
 *   - el universo de operaciones es cerrado y con enums: no hay JSON libre que
 *     interpretar;
 *   - un type guard estricto descarta lo que venga mal formado ANTES de tocar
 *     la base;
 *   - el ENSAYO: los patches se aplican a una copia, se revalida contra la
 *     misma puerta que la activación, y sólo se escribe si no aparecieron
 *     errores NUEVOS. Escribir sin ensayar es exactamente cómo se deja una
 *     automatización imposible de prender sin que nadie lo note hasta el día
 *     que la quiere prender.
 *
 * Y una que en flujos no hace falta: acá se patcha el árbol REAL de la base,
 * con sus `id`s adentro. Reinsertar con el mismo id es lo que hace que una
 * corrida dormida en una espera vuelva a su paso al despertar (el porqué está
 * en `replaceSteps`), y patchear el árbol crudo en vez de reconstruirlo desde
 * el vocabulario del modelo es lo que hace que los pasos que ese vocabulario no
 * cubre sigan ahí después de la edición.
 */
import {
  AI_PASO_SCHEMA,
  AI_TRIGGERS,
  artefactoDePlan,
  pasoDesdeIA,
  resumirPaso,
  simularResolucion,
  type AiPaso,
} from './ai-steps'
import { datoDeCfg } from './condition-config'
import { DATA_POINTS } from './data-points'
import { activationIssues } from './activation'
import type { BuilderStepInput } from './steps-tree'
import type { ValidationIssue } from './validate'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { AutomationTriggerType } from '@/types'

export type UnidadEspera = 'seconds' | 'minutes' | 'hours' | 'days'

const UNIDADES: UnidadEspera[] = ['seconds', 'minutes', 'hours', 'days']

/** Cuántos patches entran en una sola edición. */
const TOPE_PATCHES = 20

// ---------------------------------------------------------------------------
// Las operaciones
// ---------------------------------------------------------------------------

/**
 * Cómo se nombra un paso: por posición, no por id.
 *
 * Los ids son uuids y un modelo que los transcribe se equivoca; la posición es
 * lo que la persona ve en la pantalla y lo que dice en el chat ("el segundo
 * mensaje"). Empieza en 1 por la misma razón.
 *
 *   `2`      → el segundo paso del tronco.
 *   `2.si.1` → el primero de la rama del sí de ese segundo paso.
 *
 * `automatizaciones.ver` devuelve la ruta ya calculada de cada paso, así que el
 * modelo la copia en vez de contarla.
 */
export type PatchAutomatizacion =
  | { op: 'renombrar'; nombre: string }
  | { op: 'cambiar_disparador'; disparador: string; dias?: number }
  | { op: 'cambiar_texto'; paso: string; texto: string }
  | { op: 'cambiar_espera'; paso: string; cantidad: number; unidad: UnidadEspera }
  | { op: 'agregar_paso'; nuevo: AiPaso; donde?: string }
  | { op: 'quitar_paso'; paso: string }

/** Una ruta a un paso que existe. Sin ceros: las posiciones empiezan en 1. */
const RUTA_PASO = /^[1-9]\d*(\.(si|no)\.[1-9]\d*)*$/
/** Lo mismo, pero admitiendo terminar en una rama: ahí se agrega al final. */
const RUTA_DESTINO = /^[1-9]\d*(\.(si|no)\.[1-9]\d*)*(\.(si|no))?$/

export const PATCHES_SCHEMA = {
  type: 'array',
  description:
    'Los cambios, en orden. Cada uno se aplica sobre cómo quedó el anterior: si vas a quitar varios pasos, empezá por el de más abajo o las posiciones se corren.',
  items: {
    type: 'object',
    oneOf: [
      {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['renombrar'] },
          nombre: { type: 'string' },
        },
        required: ['op', 'nombre'],
      },
      {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['cambiar_disparador'] },
          disparador: { type: 'string', enum: AI_TRIGGERS.map((x) => x.value) },
          dias: {
            type: 'number',
            description:
              'Sólo para customer_inactive (días sin comprar) y post_delivery_feedback (días desde la entrega). Sin esto, esos dos disparadores quedan sin poder prenderse.',
          },
        },
        required: ['op', 'disparador'],
      },
      {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['cambiar_texto'] },
          paso: { type: 'string', description: 'Ruta del paso, p. ej. "2" o "2.si.1".' },
          texto: { type: 'string', description: 'El texto nuevo. Admite {{nombre}}.' },
        },
        required: ['op', 'paso', 'texto'],
      },
      {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['cambiar_espera'] },
          paso: { type: 'string' },
          cantidad: { type: 'number' },
          unidad: { type: 'string', enum: [...UNIDADES] },
        },
        required: ['op', 'paso', 'cantidad', 'unidad'],
      },
      {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['agregar_paso'] },
          nuevo: AI_PASO_SCHEMA,
          donde: {
            type: 'string',
            description:
              'Dónde queda el paso nuevo. "3" lo mete en la tercera posición y corre el resto hacia abajo; "2.si" lo agrega al final de la rama del sí del paso 2. Sin esto va al final.',
          },
        },
        required: ['op', 'nuevo'],
      },
      {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['quitar_paso'] },
          paso: {
            type: 'string',
            description: 'Ruta del paso. Si es una condición, se lleva sus dos ramas.',
          },
        },
        required: ['op', 'paso'],
      },
    ],
  },
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function esTexto(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0
}

function esNumero(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

/**
 * Estricto a propósito, como el de flujos.
 *
 * Un patch mal formado se descarta acá y no llega nunca a la simulación: una
 * ruta con formato raro haría que `ubicar` devolviera cualquier cosa, y un
 * `op` inventado se aplicaría como "no hacer nada" — el peor resultado
 * posible, porque el modelo diría que cambió algo y la automatización quedaría
 * igual.
 */
export function esPatch(x: unknown): x is PatchAutomatizacion {
  if (!esObjeto(x)) return false
  switch (x.op) {
    case 'renombrar':
      return esTexto(x.nombre)
    case 'cambiar_disparador':
      return (
        typeof x.disparador === 'string' &&
        AI_TRIGGERS.some((t) => t.value === x.disparador) &&
        (x.dias === undefined || esNumero(x.dias))
      )
    case 'cambiar_texto':
      return esTexto(x.paso) && RUTA_PASO.test(x.paso) && esTexto(x.texto)
    case 'cambiar_espera':
      return (
        esTexto(x.paso) &&
        RUTA_PASO.test(x.paso) &&
        esNumero(x.cantidad) &&
        typeof x.unidad === 'string' &&
        UNIDADES.includes(x.unidad as UnidadEspera)
      )
    case 'agregar_paso':
      return (
        esObjeto(x.nuevo) &&
        typeof x.nuevo.tipo === 'string' &&
        (x.donde === undefined || (esTexto(x.donde) && RUTA_DESTINO.test(x.donde)))
      )
    case 'quitar_paso':
      return esTexto(x.paso) && RUTA_PASO.test(x.paso)
    default:
      return false
  }
}

/** Separa los que se entienden de los que no, sin tirar. */
export function leerPatches(valor: unknown): {
  patches: PatchAutomatizacion[]
  descartados: number
} {
  if (!Array.isArray(valor)) return { patches: [], descartados: 0 }
  const patches = valor.filter(esPatch)
  return { patches, descartados: valor.length - patches.length }
}

// ---------------------------------------------------------------------------
// El árbol, en una copia
// ---------------------------------------------------------------------------

export interface AutomatizacionSnapshot {
  nombre: string
  disparador: string
  triggerConfig: Record<string, unknown>
  pasos: BuilderStepInput[]
}

function clonarPasos(pasos: BuilderStepInput[]): BuilderStepInput[] {
  return pasos.map((p) => ({
    ...p,
    step_config: { ...(p.step_config ?? {}) },
    ...(p.branches
      ? {
          branches: {
            yes: clonarPasos(p.branches.yes ?? []),
            no: clonarPasos(p.branches.no ?? []),
          },
        }
      : {}),
  }))
}

interface Sitio {
  /** La lista que contiene al paso (el tronco o una rama). */
  lista: BuilderStepInput[]
  /** Su posición dentro de esa lista. -1 = "al final", para agregar. */
  indice: number
}

/**
 * Sigue una ruta hasta la lista donde vive el paso.
 *
 * Crea las ramas vacías que le falten a una condición al pasar por ellas: una
 * condición guardada sin rama del no tiene `branches` incompleto, y sin esto
 * agregar el primer paso de esa rama fallaba con "no existe esa ruta" cuando la
 * ruta era perfectamente legítima.
 */
function ubicar(pasos: BuilderStepInput[], ruta: string): Sitio | null {
  let lista = pasos
  let indice = -1
  for (const seg of ruta.split('.')) {
    if (seg === 'si' || seg === 'no') {
      const padre = indice >= 0 ? lista[indice] : undefined
      if (!padre || padre.step_type !== 'condition') return null
      const ramas = (padre.branches ??= { yes: [], no: [] })
      const rama = seg === 'si' ? 'yes' : 'no'
      lista = ramas[rama] ??= []
      indice = -1
    } else {
      const n = Number(seg)
      if (!Number.isInteger(n) || n < 1) return null
      indice = n - 1
    }
  }
  return { lista, indice }
}

/** Como `ubicar`, pero exigiendo que el paso exista de verdad. */
function ubicarPaso(pasos: BuilderStepInput[], ruta: string): Sitio | null {
  const sitio = ubicar(pasos, ruta)
  if (!sitio || sitio.indice < 0 || sitio.indice >= sitio.lista.length) return null
  return sitio
}

// ---------------------------------------------------------------------------
// Aplicar
// ---------------------------------------------------------------------------

const CONFIG_POR_DISPARADOR: Record<string, string> = {
  customer_inactive: 'days_threshold',
  post_delivery_feedback: 'days_after',
}

function enPalabras(cantidad: unknown, unidad: unknown): string {
  const n = Number(cantidad)
  const u =
    unidad === 'minutes'
      ? n === 1
        ? 'minuto'
        : 'minutos'
      : unidad === 'hours'
        ? n === 1
          ? 'hora'
          : 'horas'
        : n === 1
          ? 'día'
          : 'días'
  return `${n} ${u}`
}

function queHace(paso: BuilderStepInput): string {
  return resumirPaso(aIA(paso)).resumen
}

export interface Aplicacion {
  despues: AutomatizacionSnapshot
  /** Lo que no se pudo aplicar: una ruta que no existe, un paso de otro tipo. */
  problemas: ValidationIssue[]
  /** Una línea por cambio, en castellano, para el preview. */
  resumen: string[]
}

/**
 * Aplica los patches a una copia, en orden.
 *
 * En orden y sobre el resultado del anterior, igual que el lienzo: es la única
 * semántica que se puede explicar en una frase. Lo caro es que las posiciones
 * se corren, y por eso el schema le avisa al modelo que para quitar varios
 * empiece por el último.
 *
 * Un problema NO frena a los que siguen: se juntan todos para poder devolverle
 * al modelo la lista entera y que corrija de una vez. Quien llama tiene que
 * mirar `problemas` antes de escribir nada — aplicar la mitad de una edición es
 * peor que no aplicar ninguna.
 */
export function aplicarPatches(
  antes: AutomatizacionSnapshot,
  patches: PatchAutomatizacion[],
): Aplicacion {
  const despues: AutomatizacionSnapshot = {
    ...antes,
    triggerConfig: { ...antes.triggerConfig },
    pasos: clonarPasos(antes.pasos),
  }
  const problemas: ValidationIssue[] = []
  const resumen: string[] = []

  patches.forEach((p, i) => {
    const path = `patches[${i}]`
    switch (p.op) {
      case 'renombrar': {
        resumen.push(`pasaría a llamarse «${p.nombre.trim()}»`)
        despues.nombre = p.nombre.trim()
        break
      }

      case 'cambiar_disparador': {
        const cuando = AI_TRIGGERS.find((t) => t.value === p.disparador)?.que ?? p.disparador
        // La configuración vieja se descarta: `days_threshold` de un disparador
        // por inactividad no significa nada en uno de Shopify, y arrastrarlo
        // deja basura que después nadie sabe de dónde salió.
        const campo = CONFIG_POR_DISPARADOR[p.disparador]
        despues.disparador = p.disparador
        despues.triggerConfig =
          campo && esNumero(p.dias) ? { [campo]: p.dias } : {}
        resumen.push(
          `se dispararía cuando ${cuando}${
            campo && esNumero(p.dias) ? `, a los ${enPalabras(p.dias, 'days')}` : ''
          }`,
        )
        break
      }

      case 'cambiar_texto': {
        const sitio = ubicarPaso(despues.pasos, p.paso)
        if (!sitio) {
          problemas.push({ path, message: `no existe el paso ${p.paso}` })
          break
        }
        const paso = sitio.lista[sitio.indice]
        if (paso.step_type !== 'send_message') {
          // Cambiar el "texto" de una plantilla no existe: el cuerpo lo fija la
          // plantilla aprobada en Meta y acá sólo se guarda su nombre. Dejarlo
          // pasar habría escrito un `text` que el motor ignora, y el comercio
          // habría jurado que cambió el mensaje.
          problemas.push({
            path,
            message:
              paso.step_type === 'send_template'
                ? `el paso ${p.paso} manda una plantilla: el texto lo define la plantilla aprobada, no la automatización`
                : `el paso ${p.paso} no es un mensaje (es ${paso.step_type})`,
          })
          break
        }
        resumen.push(`el paso ${p.paso} pasaría a decir «${recortar(p.texto)}»`)
        paso.step_config = { ...paso.step_config, text: p.texto }
        break
      }

      case 'cambiar_espera': {
        const sitio = ubicarPaso(despues.pasos, p.paso)
        if (!sitio) {
          problemas.push({ path, message: `no existe el paso ${p.paso}` })
          break
        }
        const paso = sitio.lista[sitio.indice]
        if (paso.step_type !== 'wait') {
          problemas.push({
            path,
            message: `el paso ${p.paso} no es una espera (es ${paso.step_type})`,
          })
          break
        }
        const cfg = paso.step_config ?? {}
        resumen.push(
          `la espera del paso ${p.paso} pasaría de ${enPalabras(cfg.amount, cfg.unit)} a ${enPalabras(p.cantidad, p.unidad)}`,
        )
        paso.step_config = { ...cfg, amount: p.cantidad, unit: p.unidad }
        break
      }

      case 'agregar_paso': {
        // El traductor devuelve QUÉ falló, no `null` a secas: el mensaje
        // genérico de antes ("falta el texto, la plantilla, la espera o el
        // sujeto") no le decía al modelo cuál de las cuatro era, y sobre una
        // condición mal escrita no decía nada útil.
        const { paso: nuevo, problemas: suyos } = pasoDesdeIA(p.nuevo, {
          disparador: antes.disparador as AutomationTriggerType,
        })
        if (!nuevo) {
          for (const q of suyos) problemas.push({ path, message: q.message })
          if (suyos.length === 0) {
            problemas.push({ path, message: `el paso nuevo venía incompleto (${p.nuevo.tipo})` })
          }
          break
        }
        const sitio = p.donde ? ubicar(despues.pasos, p.donde) : { lista: despues.pasos, indice: -1 }
        if (!sitio || sitio.indice > sitio.lista.length) {
          problemas.push({ path, message: `no existe la posición ${p.donde}` })
          break
        }
        const en = sitio.indice < 0 ? sitio.lista.length : sitio.indice
        sitio.lista.splice(en, 0, nuevo)
        resumen.push(
          `se agregaría «${queHace(nuevo)}»${p.donde ? ` en la posición ${p.donde}` : ' al final'}`,
        )
        break
      }

      case 'quitar_paso': {
        const sitio = ubicarPaso(despues.pasos, p.paso)
        if (!sitio) {
          problemas.push({ path, message: `no existe el paso ${p.paso}` })
          break
        }
        const [fuera] = sitio.lista.splice(sitio.indice, 1)
        const ramas =
          (fuera.branches?.yes?.length ?? 0) + (fuera.branches?.no?.length ?? 0)
        resumen.push(
          `se quitaría el paso ${p.paso} («${queHace(fuera)}»)${
            ramas > 0 ? ` y los ${ramas} paso(s) de sus ramas` : ''
          }`,
        )
        break
      }
    }
  })

  return { despues, problemas, resumen }
}

function recortar(s: string, n = 70): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

// ---------------------------------------------------------------------------
// El ensayo
// ---------------------------------------------------------------------------

export interface Ensayo extends Aplicacion {
  antes: AutomatizacionSnapshot
  /**
   * Lo que se rompería y hoy no está roto. Vacío = se puede escribir.
   *
   * Los errores que YA tenía no cuentan: una automatización recién instalada
   * desde una receta viene con la plantilla en blanco a propósito, y si eso
   * frenara la edición no habría forma de completarla desde el chat.
   */
  erroresNuevos: ValidationIssue[]
}

function problemasDeActivacion(s: AutomatizacionSnapshot): ValidationIssue[] {
  return activationIssues({
    triggerType: s.disparador,
    triggerConfig: s.triggerConfig,
    steps: simularResolucion(s.pasos),
  })
  // Los nombres que todavía no se convirtieron en id se completan con uno de
  // mentira antes de validar. Antes esto se resolvía filtrando los problemas
  // cuya ruta terminaba en `.tag_id`, y esa lista de sufijos se desactualiza
  // sola en cuanto aparece una referencia más — y de paso escondía un hueco
  // vacío que NO tenía un nombre detrás, que sí es un error de verdad.
}

/**
 * Compara por mensaje y no por ruta, a propósito.
 *
 * Las rutas son posicionales (`steps[1].template_name`), así que agregar un
 * paso arriba corre TODAS las de abajo y un error viejo se vería como nuevo:
 * completar una automatización a medio armar se habría vuelto imposible. Contar
 * cuántas veces aparece cada mensaje sobrevive a que los pasos se muevan, que
 * es justo lo que hacen los patches.
 */
function erroresNuevos(
  antes: ValidationIssue[],
  despues: ValidationIssue[],
): ValidationIssue[] {
  const saldo = new Map<string, number>()
  for (const i of antes) saldo.set(i.message, (saldo.get(i.message) ?? 0) + 1)
  const nuevos: ValidationIssue[] = []
  for (const i of despues) {
    const quedan = saldo.get(i.message) ?? 0
    if (quedan > 0) saldo.set(i.message, quedan - 1)
    else nuevos.push(i)
  }
  return nuevos
}

/**
 * Aplicar a una copia, revalidar, y recién ahí decir si se puede.
 *
 * Es la pieza que justifica todo lo demás. Sin esto, "sacale el último paso" a
 * una automatización de un solo paso la deja activa y sin nada que hacer, o
 * "cambiá el disparador a clientes inactivos" la deja sin el umbral de días —
 * en los dos casos la automatización sigue prendida y no vuelve a correr nunca,
 * que es la falla más cara: no avisa.
 */
export function ensayarPatches(
  antes: AutomatizacionSnapshot,
  patches: PatchAutomatizacion[],
): Ensayo {
  if (patches.length > TOPE_PATCHES) {
    return {
      antes,
      despues: antes,
      resumen: [],
      erroresNuevos: [],
      problemas: [
        {
          path: 'patches',
          message: `son demasiados cambios de una vez (${patches.length}, el tope es ${TOPE_PATCHES})`,
        },
      ],
    }
  }

  const aplicacion = aplicarPatches(antes, patches)

  // Con la edición rota no se revalida: el árbol a medio aplicar inventaría
  // errores encima de los problemas que ya se van a devolver.
  if (aplicacion.problemas.length > 0) return { antes, ...aplicacion, erroresNuevos: [] }

  return {
    antes,
    ...aplicacion,
    erroresNuevos: erroresNuevos(
      problemasDeActivacion(antes),
      problemasDeActivacion(aplicacion.despues),
    ),
  }
}

// ---------------------------------------------------------------------------
// Cómo se lee un árbol guardado
// ---------------------------------------------------------------------------

/**
 * El camino de vuelta: de lo que hay en la base al vocabulario del modelo.
 *
 * Sólo para MIRAR — dibujar el árbol y contarlo en una línea. Nunca para
 * guardar: los tipos de paso que este vocabulario no cubre volverían como
 * `{ tipo }` pelado y se perderían.
 *
 * `nombresEtiqueta` existe porque en la base un `add_tag` guarda el uuid de la
 * etiqueta, y "Etiqueta «7f3a…»" no le dice nada a nadie.
 */
export function aIA(
  paso: BuilderStepInput,
  nombresEtiqueta?: Map<string, string>,
): AiPaso {
  const c = (paso.step_config ?? {}) as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined)
  switch (paso.step_type) {
    case 'send_message':
      return { tipo: 'send_message', texto: texto(c.text) }
    case 'send_template':
      return { tipo: 'send_template', plantilla: texto(c.template_name) }
    case 'wait':
      return {
        tipo: 'wait',
        cantidad: typeof c.amount === 'number' ? c.amount : undefined,
        unidad: texto(c.unit),
      }
    case 'add_tag':
    case 'remove_tag':
      return {
        tipo: paso.step_type,
        etiqueta:
          texto(c.tag_name) ??
          (typeof c.tag_id === 'string' ? nombresEtiqueta?.get(c.tag_id) ?? c.tag_id : undefined),
      }
    case 'condition': {
      // De vuelta al DATO, que es el vocabulario del lienzo y el del chat. Sin
      // esto el árbol se dibujaba como "¿contact_field last_offer_units?", que
      // no le dice nada a quien está por aprobarlo.
      const subject = texto(c.subject)
      const operand = texto(c.operand)
      const dato = datoDeCfg(subject, operand, DATA_POINTS)
      const esEtiqueta = subject === 'tag_presence'
      const esGrupo = subject === 'in_segment'
      return {
        tipo: 'condition',
        dato,
        comparador: texto(c.op),
        valor: texto(c.value),
        valor2: texto(c.value2),
        ...(esEtiqueta
          ? {
              etiqueta:
                texto(c.tag_name) ?? (operand ? nombresEtiqueta?.get(operand) ?? operand : undefined),
            }
          : {}),
        ...(esGrupo ? { grupo: texto(c.segment_name) ?? operand } : {}),
        ...(subject === 'purchased' || subject === 'messaged' || subject === 'rejected_open'
          ? { ventana: operand }
          : {}),
        si: (paso.branches?.yes ?? []).map((p) => aIA(p, nombresEtiqueta)),
        no: (paso.branches?.no ?? []).map((p) => aIA(p, nombresEtiqueta)),
      }
    }
    case 'assign_conversation':
      return { tipo: 'assign_conversation' }
    case 'update_contact_field':
      return { tipo: 'update_contact_field', campo: texto(c.field), valor: texto(c.value) }
    case 'send_webhook':
      return { tipo: 'send_webhook', url: texto(c.url) }
    case 'voice_call':
      return { tipo: 'voice_call', agente_voz: texto(c.agent_name) }
    default:
      return { tipo: paso.step_type }
  }
}

/** La automatización dibujada, desde lo que hay guardado. */
export function artefactoDeSnapshot(
  snapshot: AutomatizacionSnapshot,
  opciones?: { id?: string; nombresEtiqueta?: Map<string, string> },
): Artefacto | null {
  const art = artefactoDePlan({
    nombre: snapshot.nombre,
    disparador: snapshot.disparador,
    pasos: snapshot.pasos.map((p) => aIA(p, opciones?.nombresEtiqueta)),
  })
  if (!art || art.kind !== 'automatizacion') return art
  // `base` es lo que le dice al panel que esto es una edición de algo que ya
  // existía y no una automatización nueva.
  return opciones?.id ? { ...art, base: { id: opciones.id, nombre: snapshot.nombre } } : art
}

export interface PasoConRuta {
  ruta: string
  tipo: string
  que: string
}

/**
 * Cada paso con la ruta que hay que escribir para tocarlo.
 *
 * Es lo que vuelve usable a todo esto: sin la ruta calculada por el servidor,
 * el modelo tiene que contar los pasos de un dibujo y elegir bien entre tronco
 * y rama, y ahí es donde edita el paso equivocado.
 */
export function listarRutas(
  pasos: BuilderStepInput[],
  nombresEtiqueta?: Map<string, string>,
  prefijo = '',
): PasoConRuta[] {
  const salida: PasoConRuta[] = []
  pasos.forEach((p, i) => {
    const ruta = `${prefijo}${i + 1}`
    const ia = aIA(p, nombresEtiqueta)
    salida.push({ ruta, tipo: p.step_type, que: resumirPaso(ia).resumen })
    if (p.step_type === 'condition') {
      salida.push(...listarRutas(p.branches?.yes ?? [], nombresEtiqueta, `${ruta}.si.`))
      salida.push(...listarRutas(p.branches?.no ?? [], nombresEtiqueta, `${ruta}.no.`))
    }
  })
  return salida
}
