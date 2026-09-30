import { describe,expect,it,vi } from 'vitest'
import { runWithTools } from './tools'
import { withTurnEvidence } from './turn-evidence'
import type Anthropic from '@anthropic-ai/sdk'
const response=(content:unknown[],stop_reason='end_turn') => ({ content,stop_reason,usage:{ input_tokens:1,output_tokens:1 } })
describe('tool loop observations with unchanged dispatch permissions',() => {
 it('records blocked requests and reported tool errors without saving model arguments',async() => {
  const create=vi.fn().mockResolvedValueOnce(response([
    { type:'tool_use',id:'blocked',name:'create_order',input:{ api_key:'private-key' } },
    { type:'tool_use',id:'allowed',name:'unknown_tool',input:{ email:'private@example.com' } },
  ],'tool_use')).mockResolvedValueOnce(response([{ type:'text',text:'No action completed.' }]))
  const client={ messages:{ create } } as unknown as Anthropic
  let json=''
  await withTurnEvidence(async() => {
    const result=await runWithTools(client,{ model:'test',max_tokens:100,system:'Test',messages:[{ role:'user',content:'Help' }],tools:[{ name:'unknown_tool',description:'Test only',input_schema:{ type:'object',properties:{} } }],shopify:null })
    expect(result.text).toBe('No action completed.');expect(result.herramientas).toEqual(['unknown_tool'])
  },async state => { json=JSON.stringify(state.evidence) })
  const evidence=JSON.parse(json);expect(evidence.tools).toEqual([{ name:'create_order',kind:'local',status:'blocked',sequence:1 },{ name:'unknown_tool',kind:'local',status:'reported_error',sequence:2 }])
  expect(json).not.toContain('private-key');expect(json).not.toContain('private@example.com');expect(create).toHaveBeenCalledTimes(2)
 })
 it('records hosted invocations without claiming an observed business completion',async() => {
  const create=vi.fn().mockResolvedValue(response([{ type:'server_tool_use',id:'hosted',name:'web_search',input:{ query:'Private query' } },{ type:'text',text:'Reply' }]))
  await withTurnEvidence(async() => {
    await runWithTools({ messages:{ create } } as unknown as Anthropic,{ model:'test',max_tokens:100,system:'Test',messages:[{ role:'user',content:'Help' }],tools:[],shopify:null })
  },async state => { expect(state.evidence.tools).toEqual([{ name:'web_search',kind:'hosted',status:'started',sequence:1 }]);expect(JSON.stringify(state.evidence)).not.toContain('Private query') })
 })
})
