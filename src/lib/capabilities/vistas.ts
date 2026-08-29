/**
 * Cómo una capacidad dibuja lo que leyó.
 *
 * El panel del Operador sabía dibujar sólo lo que se CONSTRUÍA. Pero la mitad
 * de lo que se le pide es mirar —cómo vienen las ventas, qué pedidos hay, qué
 * dijo este cliente, por qué no salió aquel mensaje— y eso contestaba un
 * párrafo y dejaba el lienzo vacío.
 *
 * Acá viven los constructores. Existen por dos razones y ninguna es estética:
 *
 *  1. **Un solo lugar para el formato.** Ciento diez capacidades formateando
 *     fechas y plata cada una a su manera es la misma clase de error que ya
 *     produjo dos cifras distintas para "mensajes salientes" (ver `types.ts`).
 *  2. **El idioma.** Los encabezados de una tabla los lee una PERSONA, así que
 *     salen de `translate(locale, …)` y nunca de un literal. Es distinto de lo
 *     que devuelve `run()`, que lo lee el modelo y siempre va en español.
 *
 * Los valores llegan a la pantalla ya en texto, a propósito: si la fila viaja
 * como número, el navegador la formatea con SU idioma y su zona horaria, y una
 * fecha de pedido se corría un día según quién mirara.
 */
import type { Locale } from '@/lib/i18n/config'
import { translate } from '@/lib/i18n/translate'
import type { Artefacto } from '@/lib/operator/artifacts'
import type { CapabilityContext } from './types'

/** Cuántas filas entran en una tabla del panel antes de volverse ilegible. */
export const TOPE_FILAS = 25

export function loc(ctx: CapabilityContext): Locale {
  return ctx.locale ?? 'es'
}

/** Una etiqueta del catálogo, para lo que va a leer una persona. */
export function tt(ctx: CapabilityContext, key: string): string {
  return translate(loc(ctx), key)
}

// ── Formato ─────────────────────────────────────────────────────────────────

/**
 * Plata, en la moneda que vino.
 *
 * Sin moneda no se inventa una: se muestra el número pelado. Poner "$" sobre
 * una cifra en reales es peor que no poner nada.
 */
export function plata(ctx: CapabilityContext, valor: unknown, moneda?: string | null): string {
  const n = Number(valor)
  if (!Number.isFinite(n)) return '—'
  try {
    if (moneda) {
      return new Intl.NumberFormat(loc(ctx), {
        style: 'currency',
        currency: moneda,
        maximumFractionDigits: 2,
      }).format(n)
    }
  } catch {
    // Una moneda que Intl no conoce no puede tumbar la vista.
  }
  return new Intl.NumberFormat(loc(ctx), { maximumFractionDigits: 2 }).format(n)
}

export function numero(ctx: CapabilityContext, valor: unknown): string {
  const n = Number(valor)
  return Number.isFinite(n) ? new Intl.NumberFormat(loc(ctx)).format(n) : '—'
}

/**
 * Una fecha, corta y en la zona del comercio.
 *
 * La zona viaja como argumento y no se saca de acá: quien la sabe es la
 * capacidad, que ya la pidió para hacer su consulta. Sin ella, un pedido de las
 * 22 h se muestra al día siguiente.
 */
export function fecha(ctx: CapabilityContext, valor: unknown, tz?: string): string {
  if (typeof valor !== 'string' && !(valor instanceof Date)) return '—'
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(loc(ctx), {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** Un texto largo, recortado para que entre en una celda. */
export function corto(valor: unknown, largo = 60): string {
  const s = typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor)
  if (!s) return '—'
  return s.length > largo ? `${s.slice(0, largo - 1)}…` : s
}

// ── Constructores ───────────────────────────────────────────────────────────

export interface ColumnaVista {
  clave: string
  /** La clave del catálogo, no el texto: acá no se escriben literales. */
  titulo: string
  alineado?: 'izq' | 'der'
}

/**
 * Una tabla, ya recortada.
 *
 * El tope no es cosmético. El modelo pide "los pedidos" y vuelven doscientos:
 * doscientas filas en un panel de 380 píxeles no son más información, son
 * ninguna. Se muestran las primeras y el encabezado dice cuántas hay.
 */
export function tabla(opts: {
  titulo: string
  columnas: ColumnaVista[]
  filas: Record<string, string>[]
  total?: number
  vacio?: string
}): Artefacto {
  const filas = opts.filas.slice(0, TOPE_FILAS)
  return {
    kind: 'tabla',
    titulo: opts.titulo,
    columnas: opts.columnas,
    filas,
    total: opts.total ?? opts.filas.length,
    vacio: opts.vacio,
  }
}

/**
 * Un número y el del período anterior, con el signo ya resuelto.
 *
 * `mejorEsMas` existe porque no todo lo que sube está bien: los mensajes
 * salientes que crecen son buena noticia y el tiempo de respuesta que crece no.
 * Sin esto, pintar el delta de verde era acertar la mitad de las veces.
 */
export function tile(
  ctx: CapabilityContext,
  etiqueta: string,
  actual: number,
  anterior?: number,
  mejorEsMas = true,
): { etiqueta: string; valor: string; delta?: string; tono?: 'bueno' | 'malo' | 'neutro' } {
  const base = { etiqueta, valor: numero(ctx, actual) }
  if (anterior === undefined || anterior === null) return base
  const dif = actual - anterior
  if (dif === 0 || anterior === 0) {
    return { ...base, delta: anterior === 0 ? undefined : '0 %', tono: 'neutro' }
  }
  const pct = Math.round((dif / Math.abs(anterior)) * 100)
  const subio = dif > 0
  return {
    ...base,
    delta: `${subio ? '+' : ''}${pct} %`,
    tono: subio === mejorEsMas ? 'bueno' : 'malo',
  }
}

export function cifras(opts: {
  titulo: string
  bajada?: string
  tiles: { etiqueta: string; valor: string; delta?: string; tono?: 'bueno' | 'malo' | 'neutro' }[]
  serie?: { etiqueta: string; valor: number }[]
}): Artefacto {
  return { kind: 'cifras', ...opts }
}

export function ficha(opts: {
  titulo: string
  subtitulo?: string
  chips?: string[]
  campos: { etiqueta: string; valor: string }[]
  nota?: string
}): Artefacto {
  // Un campo vacío ocupa un renglón para no decir nada. Se cae acá y no en cada
  // capacidad, que es donde se olvidaba.
  return { ...opts, kind: 'ficha', campos: opts.campos.filter((c) => c.valor && c.valor !== '—') }
}

export function tablero(opts: {
  titulo: string
  filas: { que: string; estado: 'ok' | 'atencion' | 'roto' | 'apagado'; detalle?: string }[]
}): Artefacto {
  return { kind: 'tablero', ...opts }
}

export function conversacion(opts: {
  titulo: string
  canal?: string
  mensajes: { de: 'cliente' | 'negocio' | 'nota'; texto: string; cuando?: string }[]
}): Artefacto {
  // Los últimos, no los primeros: lo que hace falta para seguir el hilo es
  // cómo viene terminando, no cómo empezó hace tres semanas.
  return { kind: 'conversacion', ...opts, mensajes: opts.mensajes.slice(-30) }
}

/**
 * Lo que va a pasar, con el antes al lado del después.
 *
 * Es el respaldo de toda escritura sin una forma mejor. No reemplaza al
 * `preview` —aquél es la frase que se lee— sino que la acompaña con el detalle
 * que una frase no puede llevar sin volverse un párrafo.
 */
export function cambio(opts: {
  titulo: string
  que: string
  alcance?: string
  campos?: { etiqueta: string; antes?: string; despues: string }[]
  aviso?: string
  base?: { id: string; nombre: string }
}): Artefacto {
  return { kind: 'cambio', ...opts }
}

/** Lo que devolvió una lectura, como lista, venga como venga. */
export function filasDe(result: unknown, ...campos: string[]): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (!result || typeof result !== 'object') return []
  const o = result as Record<string, unknown>
  for (const c of campos) {
    if (Array.isArray(o[c])) return o[c] as Record<string, unknown>[]
  }
  return []
}

/**
 * Una lista, venga como venga.
 *
 * Con `campo`, además, no toca el resultado: `r.pedidos` sobre un `null` tira
 * antes de llegar acá. Y una consulta que falló devuelve `null` donde debería
 * haber un arreglo, así que el `.map` de la vista tira igual. Eso NO se ve como
 * un error —`vistaDe` lo traga— sino como un panel vacío, indistinguible de
 * "no había nada". Con esto la vista se dibuja igual y dice "no hay filas",
 * que es la diferencia entre informar y callarse.
 */
export function lista<T>(v: unknown, campo?: string): T[] {
  const x =
    campo === undefined
      ? v
      : v && typeof v === 'object'
        ? (v as Record<string, unknown>)[campo]
        : undefined
  return Array.isArray(x) ? (x as T[]) : []
}

/**
 * ¿El resultado tiene forma de resultado?
 *
 * Las vistas que leen campos anidados —`r.periodo.dias`— revientan con `null`,
 * con un arreglo y con un objeto al que le falta la mitad. Devolver `null` acá
 * es la respuesta correcta: no hay nada que dibujar y no se dibuja nada.
 */
export function tieneCampos(v: unknown, ...campos: string[]): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return campos.every((c) => o[c] != null)
}
