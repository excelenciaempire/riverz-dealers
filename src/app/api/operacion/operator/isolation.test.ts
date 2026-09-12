import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: {id:'signed-in-owner'} as {id:string}|null,
  from: vi.fn(), resolve: vi.fn(async ()=>'own-workspace'), run: vi.fn(),
}))
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user}})}})}))
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:()=>({from:state.from})}))
vi.mock('@/lib/workspaces/resolve',()=>({resolveWorkspaceIdForUser:state.resolve}))
vi.mock('@/lib/admin/feature-flags',()=>({getFeatureFlags:async()=>({}),isRiverz2:()=>true,isOperatorFleet:()=>true}))
vi.mock('@/lib/csrf',()=>({csrfGuard:async()=>null}))
vi.mock('@/lib/rate-limit',()=>({limitByKey:async()=>({success:true})}))
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>'en'}))
vi.mock('@/lib/wallet/puerta',()=>({puertaDeIa:async()=>({puede:true})}))
vi.mock('@/lib/operator/loop',()=>({runOperator:state.run}))

import { GET, POST } from './route'

beforeEach(()=>{
  vi.clearAllMocks(); state.user={id:'signed-in-owner'}
  state.from.mockImplementation((table: string)=>{
    let rows = table==='operator_threads' ? [{id:'foreign-thread',workspace_id:'other-workspace'}] : []
    const q = {
      select:()=>q,
      eq:(key:string,value:unknown)=>{rows=rows.filter(r=>r[key as keyof typeof r]===value);return q},
      maybeSingle:async()=>({data:rows[0]??null,error:null}),
      insert:()=>{throw new Error('must_not_create_anything')},
    }
    return q
  })
})

it('rejects a foreign conversation despite forged workspace query and header',async()=>{
  const response=await GET(new Request('https://riverz.co/api/operacion/operator?thread=foreign-thread&workspace_id=other-workspace',{headers:{'x-workspace-id':'other-workspace'}}))
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({error:'The conversation is not available in this workspace.'})
  expect(state.resolve).toHaveBeenCalledWith(expect.anything(),'signed-in-owner')
})
it('does not start the model or create a conversation when POST names another workspace thread',async()=>{
  const response=await POST(new Request('https://riverz.co/api/operacion/operator',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:'Read other store',thread:'foreign-thread',workspace_id:'other-workspace'})}))
  expect(response.status).toBe(404)
  expect(state.run).not.toHaveBeenCalled()
})
it('does not resolve an account for an anonymous request',async()=>{
  state.user=null
  const response=await GET(new Request('https://riverz.co/api/operacion/operator'))
  expect(response.status).toBe(404)
  expect(state.resolve).not.toHaveBeenCalled()
  expect(state.from).not.toHaveBeenCalled()
})
