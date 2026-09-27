import { describe, expect, it } from 'vitest'
import { afirmaLoQueNoSabe, esCriticaPublica, mereceRespuesta } from './merece-respuesta'
import { recortarSalida as recortar } from '@/lib/ai/salida'

describe('mereceRespuesta', () => {
  it('atiende consultas comerciales breves aunque no tengan signos', () => {
    for (const texto of ['Original', 'Originales?', 'Son originales', 'Auténticos', 'Genuine?', 'Are they authentic', 'Talla', 'Stock', 'Envío']) {
      expect(mereceRespuesta(texto)).toBe('pregunta')
    }
    for (const texto of ['Qué original tu anuncio', '😍', '@maria mira', 'Hola', 'jajaja']) {
      expect(mereceRespuesta(texto)).toBeNull()
    }
  })
  it('atiende las críticas que quedaron sin respuesta el 2026-08-28', () => {
    // Los seis comentarios reales de ese día bajo el mismo post. Ninguno
    // quiere comprar, así que el filtro "solo compradores" los descartaba.
    //
    // Los tres salen como 'legal' y no como 'duda' a propósito: hablan de una
    // aprobación, de rostros hechos con IA y de juicios. Puestas a redactar,
    // esas tres preguntas le sacaron al agente un "no tenemos aprobación
    // ANMAT" y un "los testimonios son reales" — afirmaciones que no puede
    // sostener y que quedan publicadas. 'legal' es la instrucción que le
    // prohíbe afirmar Y negar.
    expect(
      mereceRespuesta(
        'Muchos posteos con IA . No confío. Historias defenestrando otros productos. Podrán mostrar aprobación de ANMAT? GRACIAS',
      ),
    ).toBe('legal')
    expect(mereceRespuesta('Qué manera de hacer publicidades falsas mezclando rostros….')).toBe('legal')
    expect(mereceRespuesta('Se van a comer algunos juicios por hablar mal de otras marcas!!!')).toBe('legal')
  })

  it('una duda de marca sin arista legal sigue siendo duda', () => {
    expect(mereceRespuesta('no confío en esta marca, parece un fraude')).toBe('duda')
  })

  it('reconoce la IA escrita como la escribe la gente', () => {
    // "Basta de tanta IA en publicidades" se colaba: la lista buscaba
    // "hecho con ia" y nadie escribe así. Sin el motivo, el agente contestó
    // "La voz del video es real, no es de máquina" — justo lo que no puede
    // afirmar.
    expect(mereceRespuesta('Basta de tanta IA en publicidades. Hace que creamos menos!!!')).toBe('legal')
    expect(mereceRespuesta('eso está hecho con inteligencia artificial')).toBe('legal')
    // Y no se dispara con palabras que llevan esas letras adentro.
    expect(mereceRespuesta('me encanta, lo uso a diario en toda la familia')).toBeNull()
  })

  it('reconoce un reclamo de post-venta', () => {
    expect(mereceRespuesta('compré hace tres semanas y no me llegó nada')).toBe('reclamo')
    expect(mereceRespuesta('quiero la devolución, nadie contesta')).toBe('reclamo')
  })

  it('reconoce una pregunta concreta', () => {
    expect(mereceRespuesta('¿sirve para piel sensible?')).toBe('pregunta')
    expect(mereceRespuesta('Donde lo consigo en venezuela?')).toBe('pregunta')
  })

  it('deja pasar el halago y la hostilidad sin contenido', () => {
    // Contestar "basta" no ayuda a nadie y sube el hilo a la vista de todos.
    expect(mereceRespuesta('Dejen de mentir, bastaaaa')).toBeNull()
    expect(mereceRespuesta('me encanta 😍')).toBeNull()
    expect(mereceRespuesta('yo')).toBeNull()
    // "que lindo" empieza como pregunta pero no pregunta nada.
    expect(mereceRespuesta('que lindo el producto')).toBeNull()
  })
})

describe('recortar', () => {
  it('no parte una palabra por la mitad', () => {
    // Lo que se publicó de verdad: "…que qui…" debajo de la foto.
    const salida = recortar('¿Hay algo del serum que quieras saber o te interesa probarlo?', 40)
    expect(salida.endsWith('…')).toBe(true)
    expect(salida).not.toContain('qui…')
    expect(salida.replace('…', '').trim().split(' ').pop()).not.toBe('qui')
  })

  it('prefiere terminar en una frase completa', () => {
    expect(recortar('Sí, sirve para el cuello. También para el escote y el rostro.', 30)).toBe(
      'Sí, sirve para el cuello.',
    )
  })

  it('deja intacto lo que ya entra', () => {
    expect(recortar('Sí, sirve.', 120)).toBe('Sí, sirve.')
  })
})

describe('afirmaLoQueNoSabe', () => {
  it('caza lo que el modelo escribió de verdad y no debía publicar', () => {
    // Textos reales de la prueba contra producción del 2026-08-28.
    expect(afirmaLoQueNoSabe('La idea es mostrar mujeres reales contándolo con sus palabras, no una máquina hablando.')).toBe(true)
    expect(afirmaLoQueNoSabe('No es mentira, el efecto es real con uso continuo.')).toBe(true)
    expect(afirmaLoQueNoSabe('No mezclamos nada, las fotos y testimonios son reales de clientas que lo usaron.')).toBe(true)
    expect(afirmaLoQueNoSabe('Y no tenemos aprobación ANMAT, es un cosmético, no un medicamento.')).toBe(true)
    expect(afirmaLoQueNoSabe('No usamos IA para mostrar resultados, son testimonios reales.')).toBe(true)
  })

  it('deja pasar una respuesta normal', () => {
    expect(afirmaLoQueNoSabe('Sí, sirve para cuello, rostro y escote. Te dejo el link: https://pilarargentina.store/products/serum-pilar')).toBe(false)
    expect(afirmaLoQueNoSabe('Ese dato lo confirmo y te lo paso.')).toBe(false)
    expect(afirmaLoQueNoSabe('Gracias por comentarlo, lo tomo en cuenta.')).toBe(false)
    expect(afirmaLoQueNoSabe('El serum vale $39.990 la unidad.')).toBe(false)
  })
})

describe('nombrar un registro no es criticar', () => {
  // El 2026-08-29 alguien comento "Esta aprobado" —confirmando que el producto
  // SI tiene aprobacion, o sea defendiendo a la marca— y la IA lo oculto por
  // critica, porque "aprobado" estaba en la misma lista que "publicidades
  // falsas". Censurar a quien te defiende es el peor falso positivo posible.
  for (const t of [
    'Esta aprobado',
    'Si tiene ANMAT, lo consulte',
    'Tiene certificado, lo vi en la web',
    'Esta habilitado por el ministerio',
  ]) {
    it(`no oculta: ${t}`, () => {
      expect(esCriticaPublica(t)).toBe(false)
    })
  }

  it('pero la acusacion sigue siendo critica', () => {
    expect(esCriticaPublica('Que manera de hacer publicidades falsas')).toBe(true)
    expect(esCriticaPublica('Les van a meter una demanda por esto')).toBe(true)
  })

  it('y el tema legal se sigue contestando con cuidado', () => {
    expect(mereceRespuesta('Esta aprobado por ANMAT?')).toBe('legal')
  })
})
