import { describe, expect, it } from 'vitest'
import { caseGapAnswerInput } from './case-gap-answers'
const input={ id:'77777777-7777-4777-8777-777777777777',gap_id:'55555555-5555-4555-8555-555555555555',expected_revision:0,answer:' Only this case ' }
describe('case-only human answers',() => {
 it('requires a version and durable receipt, preserving text within the bound',() => {
  expect(caseGapAnswerInput.parse(input)).toEqual({ ...input,answer:'Only this case' })
 })
 it.each([{ ...input,answer:'a'.repeat(2001) },{ ...input,answer:' ' },{ ...input,expected_revision:-1 },{ ...input,expected_revision:1.5 },{ ...input,id:'forged' },{ ...input,workspace_id:'caller-selected' },{ ...input,scope:'global' },{ ...input,expected_revision:undefined }])('rejects invalid or caller-expanded scope (%j)',value => {
  expect(caseGapAnswerInput.safeParse(value).success).toBe(false)
 })
})
