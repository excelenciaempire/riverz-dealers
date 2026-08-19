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

/** Un paso, listo para dibujar. Sin ids ni configuración cruda. */
export interface PasoArtefacto {
  tipo: string
  /** Una línea que dice qué hace, en castellano. */
  resumen: string
  si?: PasoArtefacto[]
  no?: PasoArtefacto[]
}

export type Artefacto =
  | {
      kind: 'automatizacion'
      nombre: string
      /** Cuándo se dispara, en palabras. */
      cuando: string
      pasos: PasoArtefacto[]
    }
  | {
      kind: 'agente'
      nombre: string
      rol: string
      /** Lo que puede hacer, ya traducido a frases. */
      puede: string[]
      /** Lo que deriva a una persona. */
      escala: string[]
    }

/** ¿Esto es un artefacto que la pantalla sabe dibujar? */
export function esArtefacto(v: unknown): v is Artefacto {
  if (!v || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  return k === 'automatizacion' || k === 'agente'
}
