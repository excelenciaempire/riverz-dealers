import { describe, expect, it } from 'vitest'
import { shouldAnnounceTrackingNumber } from './tracking-notice'

describe('tracking notice', () => {
  it('announces a guide as soon as it becomes available', () => {
    expect(shouldAnnounceTrackingNumber('240061839733', null)).toBe(true)
  })

  it('does not repeat the guide when fulfillment changes later', () => {
    expect(
      shouldAnnounceTrackingNumber('240061839733', '240061839733'),
    ).toBe(false)
  })

  it('waits while there is no guide', () => {
    expect(shouldAnnounceTrackingNumber('', null)).toBe(false)
  })
})
