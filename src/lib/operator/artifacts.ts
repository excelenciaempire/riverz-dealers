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
      /** Cuándo se dispara, en palabras. Respaldo de `disparador`. */
      cuando: string
      /**
       * El activador, tal como lo guarda el motor (`shopify_order_created`…).
       *
       * Con esto el lienzo del chat pinta la MISMA tarjeta que el editor —el
       * logo de la tienda que dispara y el nombre del activador— en vez de la
       * frase del modelo con el logo de Shopify fijo. Opcional: los artefactos
       * ya guardados en conversaciones viejas no lo traen y caen en `cuando`.
       */
      disparador?: string
      /** El filtro de tiendas del activador, para nombrar la que dispara. */
      plataformas?: string[]
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
  /**
   * Una lista, dibujada.
   *
   * Es la forma más común de todas: la mitad de las lecturas de Riverz
   * devuelven filas —pedidos, productos, contactos, conversaciones, llamadas,
   * comentarios—. Sin esto, "mostrame los últimos diez pedidos" contestaba un
   * párrafo y el panel quedaba vacío.
   *
   * Las columnas las elige el servidor, no el modelo: una tabla con las trece
   * columnas de la base no se lee, y dejar que el modelo elija cuáles importan
   * es dejar que cada vez sean otras.
   */
  | {
      kind: 'tabla'
      titulo: string
      columnas: { clave: string; titulo: string; alineado?: 'izq' | 'der' }[]
      /** Cada fila ya en texto: el formato de fecha y de plata se hace en el servidor. */
      filas: Record<string, string>[]
      /** Cuántas hay en total, cuando se mostró sólo una parte. */
      total?: number
      /** Qué decir cuando no hay ninguna. Sin esto una tabla vacía no dice nada. */
      vacio?: string
    }
  /**
   * Números grandes, y la serie si la hay.
   *
   * Para métricas, atribución, saldo y plan. El `delta` es contra el período
   * anterior y viene ya calculado y en texto («+12 %»), por lo mismo que las
   * filas de la tabla.
   */
  | {
      kind: 'cifras'
      titulo: string
      /** El período o el recorte, en palabras. */
      bajada?: string
      tiles: {
        etiqueta: string
        valor: string
        delta?: string
        tono?: 'bueno' | 'malo' | 'neutro'
      }[]
      /** Una serie chica para dibujar barras. Vacía o ausente = sin gráfico. */
      serie?: { etiqueta: string; valor: number }[]
    }
  /**
   * La ficha de UNA cosa: un contacto, un producto, un agente, una plantilla.
   *
   * No reemplaza a la pantalla de siempre —de ahí el enlace del encabezado del
   * banco—; alcanza con lo que hace falta para seguir la conversación sin
   * cambiar de pestaña.
   */
  | {
      kind: 'ficha'
      titulo: string
      subtitulo?: string
      /** Etiquetas cortas: estado, canal, etiquetas del contacto. */
      chips?: string[]
      campos: { etiqueta: string; valor: string }[]
      nota?: string
    }
  /**
   * Un ida y vuelta, como se leyó.
   *
   * Mensajes de una conversación, borradores esperando, la transcripción de una
   * llamada, un comentario con su respuesta. Que el Operador diga «el cliente
   * está molesto» no es lo mismo que ver lo que escribió.
   */
  | {
      kind: 'conversacion'
      titulo: string
      /** whatsapp, instagram, email, telefono… Decide el color de la burbuja. */
      canal?: string
      mensajes: {
        de: 'cliente' | 'negocio' | 'nota'
        texto: string
        /** Ya formateado en el idioma del comercio. */
        cuando?: string
      }[]
    }
  /**
   * Cómo viene cada cosa: verde, amarillo, rojo o apagado.
   *
   * Salud de la operación, integraciones, diagnóstico de un mensaje que no
   * llegó, huecos de la bandeja. Un párrafo con seis estados adentro se lee
   * dos veces; seis renglones con su punto, ninguna.
   */
  | {
      kind: 'tablero'
      titulo: string
      filas: {
        que: string
        estado: 'ok' | 'atencion' | 'roto' | 'apagado'
        detalle?: string
      }[]
    }
  /**
   * Un pedido con sus renglones y su total.
   *
   * Es un recibo y no una tabla: lo que se está mirando antes de aprobar un
   * `pedidos.crear` es si los artículos y la plata están bien, y eso se lee
   * distinto de una lista.
   */
  | {
      kind: 'pedido'
      /** El número del pedido, cuando ya existe. */
      nombre?: string
      cliente?: string
      items: { que: string; cantidad: number; precio: string }[]
      total: string
      envio?: string
      estado?: string
      /** El enlace de pago, cuando lo hay. Se muestra, no se abre solo. */
      enlace?: string
      base?: BaseArtefacto
    }
  /**
   * Lo que va a pasar, cuando no hay una forma mejor de dibujarlo.
   *
   * Es el respaldo de toda escritura sin dibujo propio: renombrar, invitar,
   * desconectar, etiquetar, asignar, cerrar, moderar, prender. No es un
   * comodín perezoso — el `preview` ya dice la frase, y lo que agrega esto es
   * el antes y el después uno al lado del otro, que es lo que hace falta para
   * aprobar mirando.
   *
   * `aviso` es para lo que no vuelve: un mensaje enviado, una llamada hecha.
   */
  | {
      kind: 'cambio'
      titulo: string
      /** Qué se hace, en una línea. */
      que: string
      /** A cuánta gente o a cuántas cosas alcanza, en palabras. */
      alcance?: string
      campos?: { etiqueta: string; antes?: string; despues: string }[]
      aviso?: string
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
  'tabla',
  'cifras',
  'ficha',
  'conversacion',
  'tablero',
  'pedido',
  'cambio',
] as const satisfies readonly KindArtefacto[]

const CONOCIDOS: ReadonlySet<string> = new Set(KINDS_ARTEFACTO)

/** ¿Esto es un artefacto que la pantalla sabe dibujar? */
export function esArtefacto(v: unknown): v is Artefacto {
  if (!v || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  return typeof k === 'string' && CONOCIDOS.has(k)
}
