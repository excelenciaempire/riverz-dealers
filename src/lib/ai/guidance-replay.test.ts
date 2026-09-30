import { describe,expect,it } from 'vitest'
import { guidanceReplayInput,guidanceReplayResult } from './guidance-replay'
const id='11111111-1111-4111-8111-111111111111',input={ conversation_id:id,live_revision:1,draft_revision:0 }
const result={ applies:true,reply:'Please confirm your order reference.',summary:'The rule requests missing evidence.',conflicts:[] }
describe('bounded public rule tests',() => {
 it('accepts only persisted case and rule references, never messages or credentials',() => {
  expect(guidanceReplayInput(input)).toEqual(input)
  for (const invalid of [null,[],{ ...input,workspace_id:id },{ ...input,text:'Invented customer request' },{ ...input,draft_revision:-1 },{ ...input,live_revision:1.2 },{ ...input,conversation_id:'https://example.com' }]) expect(guidanceReplayInput(invalid)).toBeNull()
 })
 it('requires strict JSON with bounded public observations and no private reasoning',() => {
  expect(guidanceReplayResult(JSON.stringify(result),[])).toEqual(result)
  for (const invalid of ['```json\n'+JSON.stringify(result)+'\n```',JSON.stringify({ ...result,reasoning:'private' }),JSON.stringify({ ...result,reply:'x'.repeat(4001) }),JSON.stringify({ ...result,applies:'yes' }),JSON.stringify({ ...result,summary:'' })]) expect(guidanceReplayResult(invalid,[])).toBeNull()
 })
 it('accepts conflicts only for known peer rules, without duplicates or extra fields',() => {
  const conflict={ rule_id:id,reason:'The delivery ranges differ.' }
  expect(guidanceReplayResult(JSON.stringify({ ...result,conflicts:[conflict] }),[id])?.conflicts).toEqual([conflict])
  expect(guidanceReplayResult(JSON.stringify({ ...result,conflicts:[conflict] }),[])).toBeNull()
  expect(guidanceReplayResult(JSON.stringify({ ...result,conflicts:[conflict,conflict] }),[id])).toBeNull()
  expect(guidanceReplayResult(JSON.stringify({ ...result,conflicts:[{ ...conflict,tool:'refund' }] }),[id])).toBeNull()
 })
})
