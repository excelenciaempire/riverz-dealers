import { beforeEach,describe,expect,it,vi } from 'vitest';
import { translate } from '@/lib/i18n/translate';
const m=vi.hoisted(()=>({locale:'es' as 'es'|'en',auth:vi.fn(),rpc:vi.fn(),from:vi.fn(),csrf:vi.fn(),eq:vi.fn(),blocked:false,missing:false}));
vi.mock('@/lib/i18n/server',()=>({getLocale:async()=>m.locale}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:m.auth},rpc:m.rpc,from:m.from})}));
vi.mock('@/lib/csrf',()=>({csrfGuard:m.csrf}));
import { GET,PUT } from './route';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222';
const context={params:Promise.resolve({id})};
const req=(value:unknown)=>new Request('https://riverz.co/api/contacts/'+id+'/union',{method:'PUT',body:JSON.stringify(value)});
beforeEach(()=>{
  vi.clearAllMocks();m.locale='es';m.blocked=false;m.missing=false;m.csrf.mockResolvedValue(null);m.auth.mockResolvedValue({data:{user:{id}}});
  const q={select:()=>q,eq:(...args:unknown[])=>{m.eq(...args);return q;},or:()=>q,neq:()=>q,maybeSingle:async()=>({data:m.missing?null:{id,workspace_id:ws,unified_contact_id:null,union_bloqueada:m.blocked}}),then:(resolve:(value:unknown)=>void)=>resolve({data:[]})};
  m.from.mockReturnValue(q);m.rpc.mockImplementation(async(_name:string,args:{p_separate:boolean})=>{m.blocked=args.p_separate;return{data:m.blocked,error:null};});
});
describe('Authenticated contact separation',()=>{
  it('rejects CSRF before touching session or data',async()=>{
    m.csrf.mockResolvedValueOnce(new Response(null,{status:403}));expect((await PUT(req({separar:true}),context)).status).toBe(403);expect(m.auth).not.toHaveBeenCalled();
  });
  it('keeps both sibling reads explicitly scoped to the contact business',async()=>{
    expect((await GET(new Request('https://riverz.co'),context)).status).toBe(200);expect(m.eq).toHaveBeenCalledWith('workspace_id',ws);
  });
  it.each([true,false])('uses a single authenticated transaction for separation=%s',async separar=>{
    const response=await PUT(req({separar}),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({bloqueada:separar,hermanos:[]});
    expect(m.rpc).toHaveBeenCalledExactlyOnceWith('set_contact_unification_block',{p_workspace_id:ws,p_contact_id:id,p_separate:separar});expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([{separar:'true'},{separar:true,workspace_id:ws},{separar:true,actor_id:id},null])('rejects malformed or client-selected scope',async body=>{
    expect((await PUT(req(body),context)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
  });
  it('does not mutate a missing or foreign RLS-scoped contact',async()=>{
    m.missing=true;expect((await PUT(req({separar:true}),context)).status).toBe(404);expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each(['es','en'] as const)('localizes private errors without exposing database details in %s',async locale=>{
    m.locale=locale;m.rpc.mockResolvedValueOnce({data:null,error:{message:'password private SQL'}});
    const response=await PUT(req({separar:true}),context);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:translate(locale,'contacts.unionFailed')});
  });
  it('does not claim completion after a transaction refuses or returns an unconfirmed outcome',async()=>{
    m.rpc.mockResolvedValueOnce({data:null,error:{message:'subscription_read_only'}}).mockResolvedValueOnce({data:false,error:null});
    expect((await PUT(req({separar:true}),context)).status).toBe(403);expect((await PUT(req({separar:true}),context)).status).toBe(503);
  });
});
