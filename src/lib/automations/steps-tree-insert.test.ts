import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertSteps } from './steps-tree'

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert }) }),
}))

describe('saving template steps', () => {
  beforeEach(() => insert.mockResolvedValue({ error: null }))

  it('assigns distinct UUIDs to empty preview ids and preserves branch references', async () => {
    await insertSteps('automation', [{
      id: '', step_type: 'condition', step_config: {},
      branches: { yes: [{ id: '', step_type: 'add_tag', step_config: { tag_id: 'tag' } }] },
    }, { id: '', step_type: 'send_template', step_config: { template_name: 'nuevo_pedido' } }])
    const rows = insert.mock.calls[0][0]
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((row: { id: string }) => row.id)).size).toBe(3)
    for (const row of rows) expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(rows[1]).toMatchObject({ parent_step_id: rows[0].id, branch: 'yes', position: 0 })
    expect(rows[2]).toMatchObject({ parent_step_id: null, position: 1 })
  })

  it('preserves saved ids used by waiting executions and A/B results', async () => {
    const id = 'fe1d8fd5-ff5e-4f51-b407-18223040939f'
    await insertSteps('automation', [{ id, step_type: 'wait', step_config: { hours: 1 } }])
    expect(insert.mock.calls[0][0][0].id).toBe(id)
  })

  it('returns the database failure to the caller', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'insert failed' } })
    expect(await insertSteps('automation', [{ step_type: 'wait', step_config: {} }])).toBe('insert failed')
  })
})
