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
 * Cliente falso con la forma exacta que encadena la consulta real:
 * from().select().gte().lt().order().order().range(). Devuelve las filas
 * en la primera página y vacío después, que es lo que corta el paginado.
 */
function fakeDb(rows: Row[]) {
  let served = false
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.gte = chain
  builder.lt = chain
  builder.order = chain
  builder.range = () => {
    const data = served ? [] : rows
    served = true
    return Promise.resolve({ data, error: null })
  }
  return { from: () => builder } as never
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
