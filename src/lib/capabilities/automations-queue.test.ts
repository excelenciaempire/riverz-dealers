/* eslint-disable @typescript-eslint/no-explicit-any -- Stateful Supabase double. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AUTOMATION_CAPABILITIES } from './automations'
import type { CapabilityContext } from './types'

let rows: any[], filters: any[], writes: any[], loseClaim: boolean, countAvailable: boolean
const cap = (key: string) => AUTOMATION_CAPABILITIES.find(value => value.key === key)!
function context(locale: 'es' | 'en' = 'es'): CapabilityContext {
  const db = { from(table: string) {
    const conditions: Array<(row: any) => boolean> = []
    let value: any = null, single = false, maximum = Infinity
    const q: any = {
      select: () => q,
      eq: (key: string, v: unknown) => { filters.push([table, key, v]); conditions.push(row => row[key] === v); return q },
      order: () => q, limit: (n: number) => { maximum = n; return q },
      update: (v: any) => { value = v; return q },
      maybeSingle: () => { single = true; return q },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        if (value && loseClaim) rows[0].status = 'running'
        const found = rows.filter(row => conditions.every(test => test(row)))
        if (value) { writes.push({ table, value, count: found.length }); found.forEach(row => Object.assign(row, value)) }
        return { data: single ? found[0] ?? null : found.slice(0, maximum), count: countAvailable ? found.length : null, error: null }
      }).then(resolve, reject),
    }
    return q
  } } as unknown as SupabaseClient
  return { db, workspaceId: 'w', actor: { type: 'operator', id: 'user' }, locale }
}
beforeEach(() => {
  rows = [{ id: 'wait', workspace_id: 'w', status: 'pending', run_at: '2026-10-01T04:00:00Z', contacts: { name: 'Ana', phone: '573000000000' }, automations: { name: 'Reminder', is_active: true, activation_state: 'active' } }]
  filters = []; writes = []; loseClaim = false; countAvailable = true
})

describe('pending queue agrees with the real pause gate', () => {
  it('separates the full pending total from the bounded response rows', async () => {
    rows = Array.from({ length: 41 }, (_, index) => ({ ...rows[0], id: `wait-${index}` }))
    const result = await cap('automatizaciones.en_cola').run(context(), { limite: 2 }) as any
    expect(result.esperando).toBe(41); expect(result.mostradas).toBe(2); expect(result.en_cola).toHaveLength(2); expect(result.hay_mas).toBe(true)
  })
  it('does not invent a full total if the query cannot provide one', async () => {
    countAvailable = false
    const result = await cap('automatizaciones.en_cola').run(context(), {}) as any
    expect(result.esperando).toBeNull(); expect(result.hay_mas).toBeNull(); expect(result.mostradas).toBe(1)
  })
  it.each(['es', 'en'] as const)('explains preserved waits and already-started sends in %s', async locale => {
    const ctx = context(locale)
    const preview = await cap('automatizaciones.activar').preview!(ctx, { automation_id: 'auto', activa: false })
    const artifact = cap('automatizaciones.activar').artifact!(ctx, { activa: false }, null)
    expect(preview).toContain(locale === 'es' ? 'esperas pendientes' : 'pending waits')
    expect(JSON.stringify(artifact)).toContain(locale === 'es' ? 'continúan al reactivar' : 'continue when reactivated')
    expect(JSON.stringify(artifact)).not.toContain(locale === 'es' ? 'sale igual' : 'still goes out')
    expect(writes).toEqual([])
  })
  it.each([{ is_active: false }, { activation_state: 'armed' }, { deleted_at: '2026-09-30T00:00:00Z' }])('does not promise an outgoing date for unavailable automation %j', async patch => {
    Object.assign(rows[0].automations, patch)
    const ctx = context(), result = await cap('automatizaciones.en_cola').run(ctx, {}) as any
    expect(result.en_cola[0].automatizacion_activa).toBe(false)
    const artifact = cap('automatizaciones.en_cola').vista!(ctx, {}, result)
    expect(JSON.stringify(artifact)).toContain(patch.is_active === false ? 'En espera por pausa' : 'activation_state' in patch ? 'Pendiente de activación' : 'Automatización no disponible')
    expect(JSON.stringify(artifact)).not.toContain('04:00')
    expect(filters).toContainEqual(['automation_pending_executions', 'workspace_id', 'w'])
  })
  it('cancels only the scoped pending row and confirms the actual update', async () => {
    rows.push({ ...rows[0], id: 'foreign', workspace_id: 'other' })
    const result = await cap('automatizaciones.cancelar_espera').run(context(), { espera_id: 'wait' })
    expect(result).toMatchObject({ cancelada: true })
    expect(rows.map(row => row.status)).toEqual(['cancelled', 'pending'])
    expect(writes[0].count).toBe(1)
  })
  it.each(['es', 'en'] as const)('does not report cancellation if a worker claimed it first (%s)', async locale => {
    loseClaim = true
    await expect(cap('automatizaciones.cancelar_espera').run(context(locale), { espera_id: 'wait' })).rejects.toThrow(locale === 'es' ? 'ya no está pendiente' : 'no longer pending')
    expect(rows[0].status).toBe('running')
    expect(writes[0].count).toBe(0)
  })
  it.each(['es', 'en'] as const)('previews only a pending permanent cancellation in %s', async locale => {
    const ctx = context(locale)
    expect(await cap('automatizaciones.cancelar_espera').preview!(ctx, { espera_id: 'wait' })).toContain(locale === 'es' ? 'permanentemente' : 'permanently')
    rows[0].status = 'running'
    await expect(cap('automatizaciones.cancelar_espera').preview!(ctx, { espera_id: 'wait' })).rejects.toThrow(locale === 'es' ? 'ya no está pendiente' : 'no longer pending')
    expect(writes).toEqual([])
  })
})
