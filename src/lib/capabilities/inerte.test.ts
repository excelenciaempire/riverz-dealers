import { describe, it, expect } from 'vitest'

import { ALL_CAPABILITIES, esInerte, getCapability } from './registry'

/**
 * La línea entre lo que el Operador construye solo y lo que pide permiso.
 *
 * Es la prueba más importante de la capa. En modo automático, todo lo `inerte`
 * se ejecuta sin que nadie lo mire — y el Operador lee mensajes escritos por
 * clientes del comercio, donde alguien puede esconder instrucciones. La defensa
 * entera se apoya en que nada marcado inerte alcance a una persona, salga a
 * Meta o mueva dinero.
 *
 * Marcar algo inerte por error no rompe un test de otra cosa: rompe éste, o no
 * rompe nada y se entera un cliente.
 */

/** Lo que sí puede construirse solo, con su motivo. */
const INERTES: Record<string, string> = {
  'automatizaciones.crear': 'nace pausada',
  'automatizaciones.crear_desde_receta': 'nace pausada y sin plantilla',
  'plantillas.crear_borrador': 'guarda texto local; no sale a Meta ni a clientes',
  'agentes.crear_borrador': 'nace pausado, no le contesta a nadie',
  'segmentos.crear': 'guarda un criterio; no prende ni manda nada',
  'segmentos.editar': 'cambia un criterio guardado; sigue sin mandar nada',
  'etiquetas.crear': 'una etiqueta vacía no tiene a nadie adentro',
  'campanas.crear': 'borrador: guarda a quién y con qué, y no manda nada',
  'comentarios.crear_regla': 'nace apagada',
  'agentes.crear_regla': 'nace apagada: no cambia ninguna respuesta hasta prenderla',
  'prospeccion.crear_campana': 'borrador: ni siquiera resuelve la audiencia',
  'ajustes.renombrar': 'lo ve el equipo en su barra lateral y nadie más',
  'bandeja.crear_atajo': 'una respuesta guardada; no sale hasta que alguien la use',
  'contactos.anotar': 'una nota interna: la lee el equipo, nunca el cliente',
}

/**
 * Lo que NO es inerte aunque lo parezca, y por qué.
 *
 * Son las que más tentación dan de marcar, y las que más caro salen. El
 * criterio que las deja afuera es el mismo para todas: su efecto depende del
 * estado de la cuenta, y `inerte` es una función de los ARGUMENTOS. Editar una
 * automatización pausada no le llega a nadie; editar la misma automatización
 * prendida cambia lo que se le manda a un cliente en el próximo evento, y desde
 * los argumentos no hay forma de saber cuál de las dos es.
 */
const NO_INERTES_A_PROPOSITO: Record<string, string> = {
  'automatizaciones.editar': 'si está prendida, cambia lo que se manda ahora mismo',
  // Sale a Meta al aprobarse: el nombre queda tomado para siempre.
  'plantillas.crear': 'sale a Meta y quema el nombre',
  // Estuvo del otro lado, con el argumento de que «cambia un tiempo, no manda
  // nada nuevo». Es cierto que no agrega un mensaje, y también que bajar una
  // espera de 21 días a una hora manda HOY los que iban a salir en tres
  // semanas. Cae exactamente bajo el criterio de este bloque, y la capacidad
  // ancha que puede hacer lo mismo nunca fue inerte.
  'automatizaciones.editar_espera': 'si está prendida, adelanta lo que ya está en cola',
  'flujos.editar': 'si está publicado, cambia lo que ve el cliente en la próxima conversación',
  'agentes.editar': 'si está activo, cambia cómo contesta en el próximo mensaje',
  'productos.editar': 'los agentes repiten esto ante un cliente en cuanto se guarda',
  'ajustes.zona_horaria': 'mueve cuándo dispara todo lo que ya está corriendo',
  'conversaciones.ia': 'prenderla pone a contestar sola una conversación abierta',
  'agentes.activar_regla': 'prenderla cambia lo que la IA contesta en el próximo mensaje',
  'comentarios.configurar': 'cambia cómo se le contesta a un cliente en el próximo comentario',
  'bandeja.decidir_devolucion': 'aprobar una devolución le reintegra la plata a alguien',
  'automatizaciones.cancelar_espera': 'ese cliente deja de recibir el mensaje que iba a recibir',
  'productos.responder_hueco': 'el agente repite esto ante un cliente en cuanto se guarda',
  // Ocultar no manda nada, pero SÍ lo nota quien escribió el comentario:
  // lo ve tachado bajo la publicación y se lee como censura.
  'comentarios.moderar': 'sacar algo de la vista del público lo nota quien lo escribió',
  'conversaciones.aprobar_borrador': 'manda el mensaje que la IA dejó esperando',
}

describe('qué puede construirse sin preguntar', () => {
  it('sólo lo declarado, y nada más', () => {
    const marcadas = ALL_CAPABILITIES.filter(
      (c) => c.risk !== 'lectura' && esInerte(c, {}),
    ).map((c) => c.key)
    expect(marcadas.sort()).toEqual(Object.keys(INERTES).sort())
  })

  it('lo que depende del estado de la cuenta NO se marca inerte', () => {
    // `inerte` es una función de los argumentos y se evalúa sin tocar la base.
    // Cualquier cosa cuyo daño dependa de si algo está prendido no se puede
    // decidir ahí, así que se propone.
    for (const [key, motivo] of Object.entries(NO_INERTES_A_PROPOSITO)) {
      const cap = ALL_CAPABILITIES.find((c) => c.key === key)
      if (!cap) continue
      expect(esInerte(cap, {}), `${key}: ${motivo}`).toBe(false)
    }
  })

  it('toda lectura es inerte: no cambia nada por definición', () => {
    for (const c of ALL_CAPABILITIES.filter((x) => x.risk === 'lectura')) {
      expect(esInerte(c, {}), c.key).toBe(true)
    }
  })

  it('prender NO es inerte; pausar sí', () => {
    // La misma capacidad y dos cosas distintas: prender una automatización la
    // pone a escribirle a clientes con cada evento.
    const auto = getCapability('automatizaciones.activar')
    expect(esInerte(auto, { activa: true })).toBe(false)
    expect(esInerte(auto, { activa: false })).toBe(true)

    const agente = getCapability('agentes.activar')
    expect(esInerte(agente, { activo: true })).toBe(false)
    expect(esInerte(agente, { activo: false })).toBe(true)
  })

  it('lo que le llega a una persona o mueve dinero nunca es inerte', () => {
    expect(esInerte(getCapability('mensajes.enviar'), {})).toBe(false)
    // Aprobar puede marcar un pedido como pagado en Shopify.
    expect(esInerte(getCapability('aprobaciones.decidir'), { aprobar: true })).toBe(false)
    expect(esInerte(getCapability('aprobaciones.decidir'), { aprobar: false })).toBe(false)
  })

  it('etiquetar a poca gente se hace; a mucha se pregunta', () => {
    // `tag_added` ES un disparador de automatizaciones. Hoy nada lo dispara al
    // escribir en `contact_tags`, pero el día que alguien lo conecte, etiquetar
    // cuatro mil contactos sería mandarles cuatro mil mensajes. Por eso la línea
    // es la escala y no la operación.
    const etq = getCapability('contactos.etiquetar')
    expect(esInerte(etq, { etiqueta: 'vip', contactos: ['a', 'b'] })).toBe(true)
    expect(
      esInerte(etq, {
        etiqueta: 'vip',
        contactos: Array.from({ length: 26 }, (_, i) => String(i)),
      }),
    ).toBe(false)
    // Por criterio no se sabe a cuántos alcanza hasta resolverlo: se pregunta.
    expect(esInerte(etq, { etiqueta: 'vip', reglas: [{ type: 'shopify' }] })).toBe(false)
    expect(esInerte(etq, { etiqueta: 'vip', segmento_id: 'x' })).toBe(false)
  })

  it('sin declaración, se propone', () => {
    // El default tiene que ser el seguro: una capacidad nueva que se olvide de
    // declararse pasa por aprobación, no al revés.
    const inventada = { key: 'x.y', risk: 'reversible' as const }
    expect(esInerte(inventada as never, {})).toBe(false)
  })
})
