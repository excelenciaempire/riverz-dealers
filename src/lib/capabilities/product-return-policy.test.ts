import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {CapabilityContext} from './types';
const f=vi.hoisted(()=>({enabled:true,read:vi.fn(),write:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/returns/product-policy',async original=>({...await original<typeof import('@/lib/returns/product-policy')>(),readProductReturnPolicy:f.read,writeProductReturnPolicy:f.write}));
import {PRODUCT_RETURN_POLICY_CAPABILITIES} from './product-return-policy';
const actor='11111111-1111-4111-8111-111111111111',workspaceId='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
const ctx={db:{},workspaceId,actor:{type:'operator',id:actor},locale:'es'} as CapabilityContext,args={product_id:product,change:{id,expected_revision:0,policy:{mode:'review',window_days:null,starts_at:'delivery',remedies:[],conditions:'Ask warehouse'}}};
const [read,write]=PRODUCT_RETURN_POLICY_CAPABILITIES;
// This test owns the registry gate for these two tools. Provider/engine graphs
// of unrelated capabilities have their own tests and are not registry fixtures.
beforeAll(()=>{
 const dependencies={agents:'AGENT',approvals:'APPROVAL',automations:'AUTOMATION',bandeja:'BANDEJA',broadcasts:'BROADCAST',comments:'COMMENT',contacts:'CONTACT',flows:'FLOW',health:'HEALTH',inbox:'INBOX',integrations:'INTEGRATION','http-actions':'HTTP_ACTION','return-logistics':'RETURN_LOGISTICS',messaging:'MESSAGING',metrics:'METRICS',orders:'ORDER',outbound:'OUTBOUND',products:'PRODUCT',prospecting:'PROSPECTING',rasmiaw:'RASMIAW',voice:'VOICE',workspace:'WORKSPACE',webchat:'WEBCHAT'};
 for(const [module,prefix] of Object.entries(dependencies))vi.doMock(`./${module}`,()=>({[`${prefix}_CAPABILITIES`]:[]}));
});
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.read.mockResolvedValue({snapshot:{product_id:product,revision:0,policy:null,changed_at:null},can_edit:true});f.write.mockResolvedValue({revision:1});});
describe('Shared product policy Operator/MCP adapters',()=>{
 it.each([false,true])('registers product policy tools only in comparison (%s)',async enabled=>{
  f.enabled=enabled;vi.resetModules();const {ALL_CAPABILITIES}=await import('./registry');const keys=new Set(ALL_CAPABILITIES.map(cap=>cap.key));for(const cap of PRODUCT_RETURN_POLICY_CAPABILITIES)expect(keys.has(cap.key)).toBe(enabled);
 },30000);
 it('requires a human-reviewed policy change and keeps reads separate',()=>{
  expect(write.risk).toBe('irreversible');expect(write.inerte).toBeUndefined();expect(read.risk).toBe('lectura');
 });
 it('uses the actual authenticated MCP issuer and rejects cron/token labels',async()=>{
  await write.run({...ctx,actor:{type:'mcp',id:'token-label',userId:actor}},args);expect(f.write).toHaveBeenCalledExactlyOnceWith(ctx.db,workspaceId,actor,product,args.change);
  await expect(write.run({...ctx,actor:{type:'mcp',id:actor}},args)).rejects.toThrow();await expect(write.run({...ctx,actor:{type:'cron',id:actor}},args)).rejects.toThrow();expect(f.write).toHaveBeenCalledTimes(1);
 });
 it('checks exact current version and editing authority in preview without applying a policy',async()=>{
  await write.preview!(ctx,args);expect(f.write).not.toHaveBeenCalled();f.read.mockResolvedValueOnce({snapshot:{revision:1},can_edit:true});await expect(write.preview!(ctx,args)).rejects.toThrow();f.read.mockResolvedValueOnce({snapshot:{revision:0},can_edit:false});await expect(write.preview!(ctx,args)).rejects.toThrow();expect(f.write).not.toHaveBeenCalled();
 });
 it('rejects direct calls outside comparison or with supplied authority fields',async()=>{
  f.enabled=false;await expect(read.run(ctx,{product_id:product})).rejects.toThrow();await expect(write.run(ctx,args)).rejects.toThrow();f.enabled=true;await expect(write.run(ctx,{...args,actor_id:actor})).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
 });
});
