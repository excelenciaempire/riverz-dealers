import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = vi.hoisted(() => ({
  puerta: { puede: true, motivo: null as string | null, saldoCentavos: 0 },
  motorApagado: false,
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
vi.mock('@/lib/workspaces/motor', () => ({
  motorApagado: async () => estado.motorApagado,
}))

import { aiTestGuard } from './rate-limit'

/**
 * Probar durante la instalación.
 *
 * Una cuenta configurada por Riverz queda sin pagar hasta que el comercio
 * aprueba, y aprobar exige probar. Con el motor apagado nada sale hacia
 * afuera, así que la prueba pasa; con el motor encendido, o sin saldo, no.
 */
describe('aiTestGuard', () => {
  beforeEach(() => {
    estado.puerta = { puede: true, motivo: null, saldoCentavos: 0 }
    estado.motorApagado = false
    estado.cupo = true
  })

  it('deja pasar a la cuenta que puede usar la IA', async () => {
    expect(await aiTestGuard('w')).toBeNull()
  })

  it('deja probar a la instalación que todavía no pagó si el motor está apagado', async () => {
    estado.puerta = { puede: false, motivo: 'sin_pagar', saldoCentavos: 0 }
    estado.motorApagado = true
    expect(await aiTestGuard('w')).toBeNull()
  })

  it('frena a la cuenta sin pagar con el motor encendido', async () => {
    estado.puerta = { puede: false, motivo: 'sin_pagar', saldoCentavos: 0 }
    const res = await aiTestGuard('w')
    expect(res?.status).toBe(402)
    expect(await res?.json()).toMatchObject({ error: 'sin_pagar' })
  })

  it('frena al que se quedó sin saldo aunque el motor esté apagado', async () => {
    estado.puerta = { puede: false, motivo: 'sin_saldo', saldoCentavos: 0 }
    estado.motorApagado = true
    expect((await aiTestGuard('w'))?.status).toBe(402)
  })

  it('respeta el cupo por minutos', async () => {
    estado.cupo = false
    expect((await aiTestGuard('w'))?.status).toBe(429)
  })
})
