import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// La puerta y la caja se simulan: acá se prueba el cliente, no la billetera.
const puerta = vi.hoisted(() => ({ puede: true }))
const caja = vi.hoisted(() => ({
  reservas: [] as Array<{ proveedor: string; maxUsd: number }>,
  liquidaciones: [] as Array<{ proveedor: string; usd: number; detalle: Record<string, unknown> }>,
  cancelaciones: 0,
}))
vi.mock('@/lib/wallet/puerta', () => ({
  puedeUsarIa: async () => puerta.puede,
}))
vi.mock('@/lib/wallet/operacion', () => ({
  reservar: async (_ctx: unknown, proveedor: string, maxUsd: number) => {
    caja.reservas.push({ proveedor, maxUsd })
    return 'op-1'
  },
  liquidar: async (
    _ctx: unknown,
    _id: string,
    proveedor: string,
    usd: number,
    detalle: Record<string, unknown>,
  ) => {
    caja.liquidaciones.push({ proveedor, usd, detalle })
  },
  cancelar: async () => {
    caja.cancelaciones += 1
  },
}))

import { hayJev, preguntarJev, reiniciarFusibleJev } from './jev'

const db = {} as never

function respuesta(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('preguntarJev', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    // `clearMocks` no vacía la cola de `mockResolvedValueOnce`: un test que
    // no consumió la suya se la dejaba al siguiente.
    fetchMock.mockReset()
    reiniciarFusibleJev()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-key')
    caja.reservas.length = 0
    caja.liquidaciones.length = 0
    caja.cancelaciones = 0
    puerta.puede = true
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sin llave no existe: nadie paga y nadie llama', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(hayJev()).toBe(false)
    const r = await preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      state: 'hola',
      questions: { x: { type: 'noul', instructions: '¿Saluda?' } },
    })
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(caja.reservas).toHaveLength(0)
  })

  it('sin saldo no se pregunta', async () => {
    puerta.puede = false
    const r = await preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      state: 'hola',
      questions: { x: { type: 'noul', instructions: '¿Saluda?' } },
    })
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('manda el estado y las preguntas, cobra la entrada y devuelve tipado', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta({
        model: 'jev-1.13.0',
        answers: {
          saluda: { type: 'noul', noul: 0.97 },
          tema: {
            type: 'choice',
            choice: 'saludo',
            probabilities: { saludo: 0.9, compra: 0.1 },
            confidence: 0.85,
          },
        },
        usage: { input_tokens: 1000, output_tokens: 20 },
      }),
    )
    const r = await preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      detalle: { para: 'prueba' },
      state: { mensaje: 'hola!' },
      questions: {
        saluda: { type: 'noul', instructions: '¿`mensaje` saluda?' },
        tema: {
          type: 'choice',
          instructions: '¿De qué habla `mensaje`?',
          criteria: { saludo: null, compra: 'Quiere comprar' },
        },
      },
    })
    expect(r).not.toBeNull()
    expect(r!.answers.saluda.noul).toBe(0.97)
    expect(r!.answers.tema.choice).toBe('saludo')
    expect(r!.answers.tema.probabilities.compra).toBe(0.1)
    expect(r!.model).toBe('jev-1.13.0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ts-test-key')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('jev-latest')
    expect(body.state).toEqual({ mensaje: 'hola!' })
    expect(Object.keys(body.questions)).toEqual(['saluda', 'tema'])

    // Se cobra sólo la entrada: 1000 tokens a $0,042 por millón.
    expect(caja.reservas).toEqual([expect.objectContaining({ proveedor: 'typesafe' })])
    expect(caja.liquidaciones).toHaveLength(1)
    expect(caja.liquidaciones[0].proveedor).toBe('typesafe')
    expect(caja.liquidaciones[0].usd).toBeCloseTo(0.000042, 9)
    expect(caja.liquidaciones[0].detalle).toMatchObject({ modelo: 'jev-1.13.0', preguntas: 2 })
  })

  it('ninguna clave viaja en el estado', async () => {
    fetchMock.mockResolvedValueOnce(
      respuesta({ model: 'jev-1.13.0', answers: { x: { type: 'noul', noul: 0.1 } }, usage: { input_tokens: 10, output_tokens: 0 } }),
    )
    await preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      state: { nota: 'la api_key: "abc123secret" quedó en una nota' },
      questions: { x: { type: 'noul', instructions: '¿?' } },
    })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.state.nota).not.toContain('abc123secret')
  })

  it('un 4xx cancela la reserva y devuelve null', async () => {
    fetchMock.mockResolvedValueOnce(respuesta({ error: 'bad' }, 422))
    const r = await preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      state: 'x',
      questions: { x: { type: 'noul', instructions: '¿?' } },
    })
    expect(r).toBeNull()
    expect(caja.cancelaciones).toBe(1)
    expect(caja.liquidaciones).toHaveLength(0)
  })

  it('reintenta una vez ante 429 y respeta retry-after', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(respuesta({ error: 'rate' }, 429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(
        respuesta({ model: 'jev-1.13.0', answers: { x: { type: 'noul', noul: 0.5 } }, usage: { input_tokens: 10, output_tokens: 0 } }),
      )
    const p = preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      state: 'x',
      questions: { x: { type: 'noul', instructions: '¿?' } },
    })
    await vi.advanceTimersByTimeAsync(2000)
    const r = await p
    vi.useRealTimers()
    expect(r?.answers.x.noul).toBe(0.5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('un error de red devuelve null sin tirar la reserva', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    const r = await preguntarJev({
      db,
      workspaceId: 'w1',
      concepto: 'ia_clasificacion',
      state: 'x',
      questions: { x: { type: 'noul', instructions: '¿?' } },
    })
    expect(r).toBeNull()
    expect(caja.cancelaciones).toBe(0)
  })

  describe('el fusible', () => {
    const pregunta = () =>
      preguntarJev({
        db,
        workspaceId: 'w1',
        concepto: 'ia_clasificacion',
        state: 'x',
        questions: { x: { type: 'noul', instructions: '¿?' } },
      })

    it('una caída lo abre: durante dos minutos Jev no existe y nadie espera un timeout', async () => {
      vi.useFakeTimers()
      fetchMock.mockRejectedValueOnce(new Error('timeout'))
      expect(await pregunta()).toBeNull()
      expect(hayJev()).toBe(false)
      // La siguiente pregunta ni llama a la red.
      expect(await pregunta()).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      // Pasado el rato, se prueba de nuevo.
      vi.advanceTimersByTime(2 * 60_000 + 1)
      expect(hayJev()).toBe(true)
      fetchMock.mockResolvedValueOnce(
        respuesta({ model: 'jev-1.13.0', answers: { x: { type: 'noul', noul: 0.4 } }, usage: { input_tokens: 5, output_tokens: 0 } }),
      )
      expect((await pregunta())?.answers.x.noul).toBe(0.4)
      vi.useRealTimers()
    })

    it('un 5xx o una llave inválida también lo abren', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ error: 'down' }, 503))
      expect(await pregunta()).toBeNull()
      expect(hayJev()).toBe(false)
      reiniciarFusibleJev()
      fetchMock.mockResolvedValueOnce(respuesta({ error: 'bad key' }, 401))
      expect(await pregunta()).toBeNull()
      expect(hayJev()).toBe(false)
    })

    it('una pregunta mal armada (422) es un bug del llamador, no una caída', async () => {
      fetchMock.mockResolvedValueOnce(respuesta({ error: 'bad question' }, 422))
      expect(await pregunta()).toBeNull()
      expect(hayJev()).toBe(true)
    })
  })
})
