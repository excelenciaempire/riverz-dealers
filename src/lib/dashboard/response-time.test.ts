import { describe, it, expect } from 'vitest'
import { loadResponseTime } from './queries'
import type { DateRange } from './date-utils'

/**
 * La gráfica de tiempo de respuesta ofrece dos lecturas que salen de la
 * MISMA pasada sobre los mensajes. Es fácil que se desincronicen al tocar
 * el emparejamiento, y el síntoma —un promedio levemente distinto— no se
 * nota mirando la pantalla. De ahí estas pruebas.
 */

interface Row {
  conversation_id: string
  sender_type: string
  created_at: string
  content_type: string | null
}

/**
 * Cliente falso con la forma exacta que encadenan las consultas reales:
 * from().select().gte().lt()[.order().order()].range(). Devuelve las filas
 * en la primera página y vacío después, que es lo que corta el paginado.
 *
 * `messages` trae los mensajes; `conversations` trae las que se ABRIERON en
 * la ventana (lo que decide si un intercambio cuenta como primera respuesta).
 * Por defecto se consideran abiertas todas las del set de mensajes, que es el
 * caso normal; `openedIds` permite simular un hilo viejo.
 */
function fakeDb(rows: Row[], openedIds?: string[]) {
  const opened = (openedIds ?? [...new Set(rows.map((r) => r.conversation_id))]).map(
    (id) => ({ id }),
  )
  const table = (data: unknown[]) => {
    let served = false
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.select = chain
    builder.gte = chain
    builder.lt = chain
    builder.order = chain
    builder.range = () => {
      const page = served ? [] : data
      served = true
      return Promise.resolve({ data: page, error: null })
    }
    return builder
  }
  const messages = table(rows)
  const conversations = table(opened)
  return {
    from: (name: string) => (name === 'conversations' ? conversations : messages),
  } as never
}

const at = (iso: string) => new Date(iso)

/** Ventana de un día, con el día previo como período de comparación. */
const RANGE: DateRange = {
  start: at('2026-03-10T00:00:00Z'),
  end: at('2026-03-11T00:00:00Z'),
}
const PREV: DateRange = {
  start: at('2026-03-09T00:00:00Z'),
  end: at('2026-03-10T00:00:00Z'),
}

function msg(
  conversation_id: string,
  sender_type: string,
  created_at: string,
  content_type: string | null = 'text',
): Row {
  return { conversation_id, sender_type, created_at, content_type }
}

describe('loadResponseTime', () => {
  it('separa la primera respuesta del resto de los turnos', async () => {
    // Una conversación con dos turnos: respondemos en 10 minutos la
    // primera vez y en 50 la segunda.
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-10T10:00:00Z'),
      msg('c1', 'agent', '2026-03-10T10:10:00Z'),
      msg('c1', 'customer', '2026-03-10T11:00:00Z'),
      msg('c1', 'agent', '2026-03-10T11:50:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    // "Primera" solo mira el turno de apertura.
    expect(report.first.thisPeriodAvg).toBe(10)
    // "Todas" promedia los dos turnos: (10 + 50) / 2.
    expect(report.all.thisPeriodAvg).toBe(30)
  })

  it('cuenta el primer turno de cada conversación, no solo el del primer hilo', async () => {
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-10T10:00:00Z'),
      msg('c1', 'agent', '2026-03-10T10:20:00Z'),
      msg('c2', 'customer', '2026-03-10T12:00:00Z'),
      msg('c2', 'bot', '2026-03-10T12:40:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    // Dos conversaciones, dos primeras respuestas: (20 + 40) / 2.
    expect(report.first.thisPeriodAvg).toBe(30)
    expect(report.all.thisPeriodAvg).toBe(30)
  })

  it('no cuenta una plantilla como respuesta en ninguna de las dos lecturas', async () => {
    // Un envío masivo cae en el hilo antes de que alguien conteste de
    // verdad. Si contara, fabricaría un tiempo de respuesta de 5 minutos.
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-10T10:00:00Z'),
      msg('c1', 'bot', '2026-03-10T10:05:00Z', 'template'),
      msg('c1', 'agent', '2026-03-10T10:30:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    expect(report.first.thisPeriodAvg).toBe(30)
    expect(report.all.thisPeriodAvg).toBe(30)
  })

  it('un cliente que escribe varias veces seguidas cuenta una sola vez', async () => {
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-10T10:00:00Z'),
      msg('c1', 'customer', '2026-03-10T10:05:00Z'),
      msg('c1', 'customer', '2026-03-10T10:09:00Z'),
      msg('c1', 'agent', '2026-03-10T10:20:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    // Se mide desde el PRIMER mensaje de la ráfaga: 20 minutos, no 11.
    expect(report.first.thisPeriodAvg).toBe(20)
    expect(report.all.thisPeriodAvg).toBe(20)
  })

  it('no suma el silencio: si el cliente vuelve tras un día, el reloj arranca de nuevo', async () => {
    // Quedó un mensaje sin contestar el día 9. El cliente vuelve el 10 y le
    // respondemos en 2 minutos. Contestamos al mensaje NUEVO: el promedio es
    // 2 minutos, no las 24 horas de silencio que hubo en el medio.
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-09T09:00:00Z'),
      msg('c1', 'customer', '2026-03-10T10:00:00Z'),
      msg('c1', 'agent', '2026-03-10T10:02:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    expect(report.first.thisPeriodAvg).toBe(2)
    expect(report.all.thisPeriodAvg).toBe(2)
    // Y el silencio no se cuela como una espera enorme en el período anterior.
    expect(report.first.prevPeriodAvg).toBeNull()
  })

  it('una ráfaga larga sin contestar sí acumula la espera real', async () => {
    // Acá el cliente insiste cada pocas horas y nunca lo dejamos solo más de
    // un día: la espera es genuina y tiene que contarse entera.
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-10T00:00:00Z'),
      msg('c1', 'customer', '2026-03-10T06:00:00Z'),
      msg('c1', 'customer', '2026-03-10T12:00:00Z'),
      msg('c1', 'agent', '2026-03-10T18:00:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    expect(report.first.thisPeriodAvg).toBe(18 * 60)
  })

  it('un hilo viejo que escribe hoy no fabrica una "primera respuesta"', async () => {
    // c2 se abrió antes de la ventana: lo de hoy es un turno más, no la
    // apertura. Antes aportaba una primera respuesta nueva cada período.
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-10T10:00:00Z'),
      msg('c1', 'agent', '2026-03-10T10:10:00Z'),
      msg('c2', 'customer', '2026-03-10T11:00:00Z'),
      msg('c2', 'agent', '2026-03-10T12:00:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows, ['c1']), 'UTC', RANGE, PREV)

    expect(report.first.thisPeriodAvg).toBe(10)
    // "Todas" sigue viendo los dos turnos: (10 + 60) / 2.
    expect(report.all.thisPeriodAvg).toBe(35)
  })

  it('atribuye al período anterior lo que cae fuera del rango', async () => {
    const rows: Row[] = [
      msg('c1', 'customer', '2026-03-09T10:00:00Z'),
      msg('c1', 'agent', '2026-03-09T11:00:00Z'),
      msg('c2', 'customer', '2026-03-10T10:00:00Z'),
      msg('c2', 'agent', '2026-03-10T10:15:00Z'),
    ]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    expect(report.first.thisPeriodAvg).toBe(15)
    expect(report.first.prevPeriodAvg).toBe(60)
  })

  it('sin respuestas devuelve nulo en vez de cero', async () => {
    const rows: Row[] = [msg('c1', 'customer', '2026-03-10T10:00:00Z')]

    const report = await loadResponseTime(fakeDb(rows), 'UTC', RANGE, PREV)

    // Cero minutos y "nunca contestamos" son cosas distintas: mostrar 0
    // haría parecer que la atención es instantánea.
    expect(report.first.thisPeriodAvg).toBeNull()
    expect(report.all.thisPeriodAvg).toBeNull()
  })
})
