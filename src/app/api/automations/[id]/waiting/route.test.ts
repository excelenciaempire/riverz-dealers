import { beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({session:vi.fn(),rpc:vi.fn(),filters:[] as unknown[][],found:true,error:false,locale:'es' as 'es'|'en'}))
vi.mock('@/lib/inbox/server-context',()=>({inboxSession:()=>state.session()}))
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>state.locale}))
import { GET } from './route'
const id='11111111-1111-4111-8111-111111111111',step='22222222-2222-4222-8222-222222222222'
const request=(key=id)=>GET(new Request(`https://riverz.co/api/automations/${key}/waiting`),{params:Promise.resolve({id:key})})
beforeEach(()=>{
 state.filters=[];state.found=true;state.error=false;state.locale='es';state.session.mockReset();state.rpc.mockReset()
 const q={select:()=>q,eq:(...args:unknown[])=>{state.filters.push(args);return q},is:()=>q,maybeSingle:async()=>({data:state.found?{id}:null,error:state.error?new Error('private_database_details'):null})}
 state.session.mockResolvedValue({db:{from:()=>q,rpc:state.rpc},workspaceId:'trusted-workspace',userId:'trusted-actor'})
 state.rpc.mockResolvedValue({data:{counts:{[step]:1201},total:1201},error:null})
})
describe('scoped waiting count API',()=>{
 it.each([401,403])('checks session and membership before RPC (%i)',async status=>{
  state.session.mockResolvedValue({response:Response.json({error:'denied'},{status})})
  expect((await request()).status).toBe(status);expect(state.rpc).not.toHaveBeenCalled()
 })
 it('returns the existing response from the complete server aggregation',async()=>{
  const response=await request('11111111')
  expect(response.status).toBe(200);expect(await response.json()).toEqual({counts:{[step]:1201},total:1201})
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(state.filters).toContainEqual(['workspace_id','trusted-workspace']);expect(state.filters).toContainEqual(['short_id','11111111'])
  expect(state.rpc).toHaveBeenCalledWith('automation_waiting_counts',{p_workspace_id:'trusted-workspace',p_automation_id:id,p_actor_id:'trusted-actor'})
 })
 it('rejects unavailable or invalid IDs before RPC',async()=>{
  expect((await request('invalid')).status).toBe(404)
  state.found=false;expect((await request()).status).toBe(404);expect(state.rpc).not.toHaveBeenCalled()
 })
 it('rejects membership revoked between resolution and the SQL read',async()=>{
  state.rpc.mockResolvedValue({data:null,error:{message:'automation_waiting_not_found'}})
  expect((await request()).status).toBe(404)
 })
 it.each(['es','en'] as const)('localizes database failures without private details in %s',async locale=>{
  state.locale=locale;state.error=true
  const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
  const response=await request(),body=await response.json()
  expect(response.status).toBe(500);expect(body.error).toBe(locale==='es'?'No se pudieron cargar las esperas pendientes.':'Pending waits could not be loaded.')
  expect(JSON.stringify(body)).not.toContain('private_database_details');spy.mockRestore()
 })
 it.each([{counts:{[step]:-1},total:-1},{counts:{[step]:1},total:2},{counts:null,total:0},{counts:{bad:1},total:1}])('fails closed on malformed aggregated data %j',async data=>{
  const spy=vi.spyOn(console,'error').mockImplementation(()=>{});state.rpc.mockResolvedValue({data,error:null})
  expect((await request()).status).toBe(500);spy.mockRestore()
 })
})
