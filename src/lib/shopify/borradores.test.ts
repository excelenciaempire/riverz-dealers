import { describe,expect,it } from 'vitest'
import { isReplacementDraft,replacementDraftTag,claveDeBorrador } from './borradores'
describe('replacement draft recovery exclusion',() => {
  const id='11111111-1111-4111-8111-111111111111'
  it('recognizes initial markers in both REST and GraphQL representations',() => {
    for (const tags of ['other, riverz_replacement ',['riverz_replacement'],[replacementDraftTag(id)],replacementDraftTag(id).toUpperCase()]) expect(isReplacementDraft(tags)).toBe(true)
  })
  it('does not exclude ordinary draft orders or loosely matching tags',() => {
    for (const tags of [null,undefined,['ordinary'],[25],{ tags:'riverz_replacement' },'not_riverz_replacement','riverz_replacement_invalid','riverz_replacement_extra']) expect(isReplacementDraft(tags)).toBe(false)
    expect(claveDeBorrador(100)).toBe('draft_100')
    expect(() => replacementDraftTag('foreign/provider')).toThrow('invalid_replacement_operation')
  })
})
