import { describe, expect, it } from 'vitest'
import { fromServerSteps, toApiSteps } from './automation-builder'

describe('template preview save payload', () => {
  it('does not send empty database ids from template seeds', () => {
    const nodes = [
      { id: '', step_type: 'send_template', step_config: { template_name: 'nuevo_pedido' } },
      { id: '', step_type: 'add_tag', step_config: { tag_id: 'tag' } },
    ]
    const steps = fromServerSteps(nodes)
    const payload = JSON.parse(JSON.stringify(toApiSteps(steps)))
    expect(payload).toHaveLength(2)
    expect(payload.every((step: { id?: string }) => !('id' in step))).toBe(true)
    expect(payload[0].step_config.template_name).toBe('nuevo_pedido')
  })

  it('keeps existing step ids on a saved automation', () => {
    const id = 'fe1d8fd5-ff5e-4f51-b407-18223040939f'
    const nodes = [{ id, step_type: 'wait', step_config: { hours: 1 } }]
    const steps = fromServerSteps(nodes)
    expect(toApiSteps(steps)[0].id).toBe(id)
  })
})
