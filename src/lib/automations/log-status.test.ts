import { describe, expect, it } from 'vitest'
import { settledLogStatus } from './log-status'

describe('whole-run status', () => {
  it('keeps a nested wait partial when the outer product/quantity conditions finish', () => {
    expect(settledLogStatus([{ status: 'success' }], 1, 'partial')).toBe('partial')
  })
  it('settles a resumed wait only after the last pending scope ends', () => {
    expect(settledLogStatus([{ status: 'success' }], 0, 'partial')).toBe('success')
    expect(settledLogStatus([{ status: 'success' }], 2, 'partial')).toBe('partial')
  })
  it('preserves nested send errors and missing-path failures after resume', () => {
    expect(settledLogStatus([{ status: 'failed' }], 0, 'partial')).toBe('failed')
    expect(settledLogStatus([], 0, 'failed')).toBe('failed')
    expect(settledLogStatus([{ status: 'failed' }], 1, 'success')).toBe('failed')
  })
  it('does not confuse an inbound cancellation with an error', () => {
    expect(settledLogStatus([{ status: 'skipped' }], 0, 'partial')).toBe('success')
  })
})
