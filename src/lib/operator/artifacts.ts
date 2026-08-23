/**
 * Lo que se ve, además de lo que se lee.
 *
 * Cuando el Operador arma una automatización, el texto dice "creé una
 * automatización de tres pasos" y eso no alcanza para saber si es la que
 * pediste. Un artefacto es la misma cosa dibujada: el árbol con sus esperas y
 * sus ramas, la plantilla como la va a ver el cliente en WhatsApp.
 *
 * Se calcula en el SERVIDOR y no lo escribe el modelo. Es la misma regla que
 * el `preview`: lo que se muestra tiene que describir lo que realmente se va a
 * hacer, no lo que el modelo dice que va a hacer.
 *
 * Y se puede calcular desde los argumentos, sin haber ejecutado nada — por eso
 * una propuesta ya muestra el árbol antes de que nadie apruebe.
 */

/**
 * Qué le pasó a esta parte respecto de lo que había antes.
 *
 * Existe porque redibujar el árbol no sirve para un pedido de cambio. Si
 * alguien dice "actualizá el carrito abandonado", ver el árbol nuevo no dice
 * nada: hay que ver qué se movió. Lo que estaba, atenuado; lo nuevo, encendido;
 * lo que se va, tachado.
 *
 * Ausente significa `igual`. Una creación no marca nada, porque marcar todo
 * como nuevo es lo mismo que no marcar nada y ensucia el dibujo.
 */
export type Cambio = 'igual' | 'nuevo' | 'editado' | 'quitado'

/** Un paso, listo para dibujar. Sin ids ni configuración cruda. */
export interface PasoArtefacto {
  tipo: string
  /** Una línea que dice qué hace, en castellano. */
  resumen: string
  si?: PasoArtefacto[]
  no?: PasoArtefacto[]
  cambio?: Cambio
  /** Lo que decía antes. Sólo cuando `cambio === 'editado'`. */
  antes?: string
}

/** Sobre qué se está trabajando, cuando se edita algo que ya existía. */
export interface BaseArtefacto {
  id: string
  nombre: string
}

export type Artefacto =
  | {
      kind: 'automatizacion'
      nombre: string
      /** Cuándo se dispara, en palabras. */
      cuando: string
      pasos: PasoArtefacto[]
      base?: BaseArtefacto
    }
  | {
      kind: 'agente'
      nombre: string
      rol: string
      /** Lo que puede hacer, ya traducido a frases. */
      puede: string[]
      /** Lo que deriva a una persona. */
      escala: string[]
      base?: BaseArtefacto
    }
  | {
      kind: 'plantilla'
      nombre: string
      categoria: string
      idioma: string
      cuerpo: string
      encabezado?: string
      pie?: string
      botones?: { texto: string; tipo: string }[]
      estado?: 'borrador' | 'en_revision' | 'aprobada' | 'rechazada'
      base?: BaseArtefacto
    }
  | {
      kind: 'segmento'
      nombre: string
      /** A cuánta gente alcanza, cuando se pudo calcular. */
      alcance?: number
      reglas: { campo: string; op: string; valor: string; cambio?: Cambio }[]
      base?: BaseArtefacto
    }
  | {
      kind: 'campana'
      nombre: string
      plantilla: string
      destinatarios: number
      /** Cuándo sale, en palabras. */
      cuando: string
      base?: BaseArtefacto
    }
  | {
      /**
       * Una regla de comentario a mensaje privado.
       *
       * Es la única pieza que le escribe a una persona, y encima puede publicar
       * bajo su comentario donde lo lee cualquiera. Contarla en una línea era
       * pedir que se apruebe un texto que no se leyó entero.
       */
      kind: 'regla'
      nombre: string
      /** En qué red escucha. */
      red: string
      /** Qué la dispara, en palabras. */
      cuando: string
      /** El mensaje privado, que lee sólo quien comentó. */
      privado: string
      /** Lo que se publica bajo el comentario. Vacío = no se responde en público. */
      publico: string[]
      boton?: { texto: string; enlace: string }
      base?: BaseArtefacto
    }
  | {
      kind: 'flujo'
      nombre: string
      nodos: { clave: string; tipo: string; resumen: string; cambio?: Cambio }[]
      base?: BaseArtefacto
    }

export type KindArtefacto = Artefacto['kind']

/**
 * Los tipos que la pantalla sabe dibujar.
 *
 * Se declara como conjunto y no como una cadena de `||` porque agregar un tipo
 * a la unión y olvidarse de esta línea da un artefacto que existe, viaja, se
 * guarda y no se dibuja nunca. Hay una prueba que exige que los dos coincidan.
 */
export const KINDS_ARTEFACTO = [
  'automatizacion',
  'regla',
  'agente',
  'plantilla',
  'segmento',
  'campana',
  'flujo',
] as const satisfies readonly KindArtefacto[]

const CONOCIDOS: ReadonlySet<string> = new Set(KINDS_ARTEFACTO)

/** ¿Esto es un artefacto que la pantalla sabe dibujar? */
export function esArtefacto(v: unknown): v is Artefacto {
  if (!v || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  return typeof k === 'string' && CONOCIDOS.has(k)
}
