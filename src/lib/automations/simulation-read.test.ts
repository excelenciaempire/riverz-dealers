import { describe, expect, it, vi } from 'vitest'
import { readSimulationRows } from './simulation-read'
describe('complete bounded read-only automation previews', () => {
  it('reads beyond the default REST cap without losing later steps', async () => {
    const data = Array.from({ length: 1201 }, (_, id) => ({ id }))
    const page = vi.fn(async (from: number, to: number) => ({ data: data.slice(from, to + 1), error: null }))
    expect(await readSimulationRows(page)).toEqual(data)
    expect(page).toHaveBeenCalledTimes(3)
  })
  it('does not misreport a failed read as an empty automation list', async () => {
    await expect(readSimulationRows(async () => ({ data: null, error: { message: 'private_database_error' } }))).rejects.toThrow('automation_simulation_unavailable')
    await expect(readSimulationRows(async () => ({ data: null, error: null }))).rejects.toThrow('automation_simulation_unavailable')
  })
  it('rejects the whole preview rather than truncating over its bound', async () => {
    await expect(readSimulationRows(async () => ({ data: Array(500).fill({ id: 1 }), error: null }), 1000)).rejects.toThrow('automation_simulation_too_large')
  })
  it('does not return a partial result when a later page fails', async () => {
    await expect(readSimulationRows(async from => from === 0 ? { data: Array(500).fill({ id: 1 }), error: null } : { data: null, error: new Error('offline') })).rejects.toThrow('automation_simulation_unavailable')
  })
})
