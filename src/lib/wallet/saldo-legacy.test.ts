import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { leerBilletera } from './saldo'

function setup(createError: string | null = null) {
  const read = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({
    data: { workspace_id: 'legacy', saldo_centavos: 1234, reservado_centavos: 50, moneda: 'usd' }, error: null,
  })
  const upsert = vi.fn().mockResolvedValue({ error: createError ? { message: createError } : null })
  const chain = { select: () => chain, eq: () => chain, maybeSingle: read, upsert }
  return { db: { from: () => chain } as unknown as SupabaseClient, upsert, read }
}

describe('legacy wallet initialization', () => {
  it('does not reset funds when another request creates the wallet first', async () => {
    const { db, upsert } = setup()
    const wallet = await leerBilletera(db, 'legacy')
    expect(upsert).toHaveBeenCalledWith({ workspace_id: 'legacy' }, { onConflict: 'workspace_id', ignoreDuplicates: true })
    expect(wallet.saldoCentavos).toBe(1234)
    expect(wallet.reservadoCentavos).toBe(50)
  })

  it('reports initialization errors instead of inventing a zero balance', async () => {
    const { db, read } = setup('write failed')
    await expect(leerBilletera(db, 'legacy')).rejects.toThrow('write failed')
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('fails closed if the wallet still cannot be read', async () => {
    const { db, read } = setup()
    read.mockReset().mockResolvedValue({ data: null, error: null })
    await expect(leerBilletera(db, 'legacy')).rejects.toThrow('wallet_initialization_failed')
  })
})
