import { describe, expect, it } from 'vitest'
import {
  ESPERA_MAXIMA_SEGUNDOS,
  esperaParaEsteTurno,
} from './ritmo-de-escritura'

/**
 * Cuanto esperar a que la persona termine de escribir.
 *
 * Hay gente que manda una idea en cinco lineas. El agente ya agrupaba rafagas
 * con una espera fija, y en promedio funciona: en 30 dias de produccion, en
 * WhatsApp, solo 2 de 38 mensajes del cliente llegaron dentro de los 15 s
 * posteriores a nuestra respuesta.
 *
 * Pero el promedio no consuela a quien escribe mas lento: de 366 pares de
 * mensajes seguidos del mismo cliente, el 19% tiene entre 15 y 30 segundos de
 * separacion, y a esa persona la cortamos SIEMPRE.
 */

const T0 = Date.parse('2026-08-30T12:00:00Z')

/** Mensajes del mas nuevo al mas viejo, como los devuelve la consulta. */
function db(filas: Array<{ id: string; quien: string; haceSeg: number }>) {
  return {
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.order = () => q
      q.limit = async () => ({
        data: filas.map((f) => ({
          id: f.id,
          sender_type: f.quien,
          created_at: new Date(T0 - f.haceSeg * 1000).toISOString(),
        })),
        error: null,
      })
      return q
    },
  } as never
}

describe('la espera se ajusta a quien escribe', () => {
  it('quien escribe cada 25 s no queda cortado', async () => {
    // El caso que la espera fija de 15 s pierde siempre.
    const r = await esperaParaEsteTurno(
      db([
        { id: 'm4', quien: 'customer', haceSeg: 0 },
        { id: 'm3', quien: 'customer', haceSeg: 25 },
        { id: 'm2', quien: 'customer', haceSeg: 50 },
        { id: 'm1', quien: 'customer', haceSeg: 76 },
      ]),
      'c1',
      'm4',
      15,
    )
    expect(r.motivo).toBe('ritmo_propio')
    expect(r.espera).toBeGreaterThan(15)
  })

  it('quien escribe rapido no espera de mas', async () => {
    // Lo configurado es un PISO, no una sugerencia: nunca se baja.
    const r = await esperaParaEsteTurno(
      db([
        { id: 'm3', quien: 'customer', haceSeg: 0 },
        { id: 'm2', quien: 'customer', haceSeg: 3 },
        { id: 'm1', quien: 'customer', haceSeg: 7 },
      ]),
      'c1',
      'm3',
      15,
    )
    expect(r.espera).toBe(15)
  })

  it('una sola linea no espera de mas', async () => {
    // Recien arranca a escribir: no hay rafaga. Hacerle esperar el ritmo de
    // una conversacion vieja es el costo que este ajuste no puede pagar.
    const r = await esperaParaEsteTurno(
      db([
        { id: 'm3', quien: 'customer', haceSeg: 0 },
        { id: 'm2', quien: 'bot', haceSeg: 40 },
        { id: 'm1', quien: 'customer', haceSeg: 90 },
      ]),
      'c1',
      'm3',
      15,
    )
    expect(r.motivo).toBe('no_esta_en_rafaga')
    expect(r.espera).toBe(15)
  })

  it('nunca pasa del techo', async () => {
    // Mas que esto no es "esta escribiendo", es "no contestan".
    const r = await esperaParaEsteTurno(
      db([
        { id: 'm4', quien: 'customer', haceSeg: 0 },
        { id: 'm3', quien: 'customer', haceSeg: 100 },
        { id: 'm2', quien: 'customer', haceSeg: 200 },
        { id: 'm1', quien: 'customer', haceSeg: 300 },
      ]),
      'c1',
      'm4',
      15,
    )
    expect(r.espera).toBeLessThanOrEqual(ESPERA_MAXIMA_SEGUNDOS)
  })

  it('sin historial usa lo configurado', async () => {
    const r = await esperaParaEsteTurno(
      db([
        { id: 'm2', quien: 'customer', haceSeg: 0 },
        { id: 'm1', quien: 'customer', haceSeg: 10 },
      ]),
      'c1',
      'm2',
      15,
    )
    expect(r.motivo).toBe('sin_datos')
    expect(r.espera).toBe(15)
  })

  it('una consulta rota no deja al cliente esperando', async () => {
    const roto = {
      from: () => {
        throw new Error('sin conexion')
      },
    } as never
    const r = await esperaParaEsteTurno(roto, 'c1', 'm1', 15)
    expect(r.espera).toBe(15)
  })

  it('un hueco de una hora no le define el ritmo a nadie', async () => {
    // Se fue a almorzar y volvio. Eso no es seguir escribiendo.
    const r = await esperaParaEsteTurno(
      db([
        { id: 'm4', quien: 'customer', haceSeg: 0 },
        { id: 'm3', quien: 'customer', haceSeg: 5 },
        { id: 'm2', quien: 'customer', haceSeg: 11 },
        { id: 'm1', quien: 'customer', haceSeg: 3600 },
      ]),
      'c1',
      'm4',
      15,
    )
    expect(r.espera).toBe(15)
  })
})
