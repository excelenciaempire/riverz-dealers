import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),guard:vi.fn(),load:vi.fn(),member:vi.fn(),save:vi.fn(),eq:vi.fn(),db:{from:vi.fn()}}));
vi.mock('@/lib/workspaces/cuenta-de-sesion',()=>({cuentaDeSesion:m.session}));
vi.mock('@/lib/csrf',()=>({csrfGuard:m.guard}));
vi.mock('@/lib/api/errors',()=>({serverError:()=>Response.json({error:'unavailable'},{status:500})}));
vi.mock('@/lib/ai/email-policy',async original=>({...await original<typeof import('@/lib/ai/email-policy')>(),loadEmailPolicy:m.load}));
import {GET,POST} from './route';
import {DEFAULT_EMAIL_POLICY} from '@/lib/ai/email-policy';
beforeEach(()=>{
 vi.resetAllMocks();m.guard.mockResolvedValue(null);m.member.mockResolvedValue({data:{role:'owner'},error:null});m.save.mockResolvedValue({error:null});
 const q={select:vi.fn().mockReturnThis(),eq:m.eq,maybeSingle:m.member,upsert:m.save};m.eq.mockReturnValue(q);m.db.from.mockReturnValue(q);
 m.session.mockResolvedValue({admin:m.db,workspaceId:'own',userId:'user',locale:'es'});m.load.mockResolvedValue(DEFAULT_EMAIL_POLICY);
});
const request=(body:unknown)=>new Request('https://riverz.co/api/workspace/email-policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
it('loads the authenticated workspace with no cache',async()=>{
 const r=await GET();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(m.load).toHaveBeenCalledWith(m.db,'own');
});
it('never trusts a tenant id sent in the body',async()=>{
 expect((await POST(request({...DEFAULT_EMAIL_POLICY,workspace_id:'another'}))).status).toBe(200);
 expect(m.save).toHaveBeenCalledWith(expect.objectContaining({workspace_id:'own'}),{onConflict:'workspace_id'});
});
it('rejects staff writes and malformed phone numbers',async()=>{
 m.member.mockResolvedValueOnce({data:{role:'agent'},error:null});
 expect((await POST(request(DEFAULT_EMAIL_POLICY))).status).toBe(403);expect(m.save).not.toHaveBeenCalled();
 expect((await POST(request({...DEFAULT_EMAIL_POLICY,whatsapp_number:'https://wrong.test'}))).status).toBe(400);
});
it('requires a session and CSRF before touching configuration',async()=>{
 m.guard.mockResolvedValueOnce(Response.json({error:'csrf'},{status:403}));expect((await POST(request(DEFAULT_EMAIL_POLICY))).status).toBe(403);expect(m.session).not.toHaveBeenCalled();
 m.session.mockResolvedValueOnce({error:Response.json({error:'auth'},{status:401})});expect((await GET()).status).toBe(401);expect(m.load).not.toHaveBeenCalled();
});
