import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  puerta: { puede: true, motivo: null as string | null, saldoCentavos: 0 },
  cupo: true,
}))

vi.mock('@/lib/rate-limit', () => ({
  limitByKey: async () => ({ success: estado.cupo }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/wallet/puerta', () => ({
  exigirSaldo: async () => null,
  puertaDeIa: async () => estado.puerta,
}))

import { aiTestGuard } from './rate-limit'

/**
 * Probar antes de pagar el link: la prueba no envía nada y la cubre Riverz.
 * Sin saldo o con la suscripción vencida se sigue frenando.
 */
describe('aiTestGuard', () => {
  beforeEach(() => {
    estado.puerta = { puede: true, motivo: null, saldoCentavos: 0 }
    estado.cupo = true
  })

  it('deja pasar a la cuenta que puede usar la IA', async () => {
    expect(await aiTestGuard('w')).toBeNull()
  })

  it('deja probar a la cuenta que todavía no pagó su link', async () => {
    estado.puerta = { puede: false, motivo: 'sin_pagar', saldoCentavos: 0 }
    expect(await aiTestGuard('w')).toBeNull()
  })

  it('frena al que se quedó sin saldo', async () => {
    estado.puerta = { puede: false, motivo: 'sin_saldo', saldoCentavos: 0 }
    const res = await aiTestGuard('w')
    expect(res?.status).toBe(402)
    expect(await res?.json()).toMatchObject({ error: 'sin_saldo' })
  })

  it('frena a la suscripción vencida', async () => {
    estado.puerta = { puede: false, motivo: 'suscripcion_vencida', saldoCentavos: 0 }
    expect((await aiTestGuard('w'))?.status).toBe(402)
  })

  it('respeta el cupo por minutos', async () => {
    estado.cupo = false
    expect((await aiTestGuard('w'))?.status).toBe(429)
  })
})
