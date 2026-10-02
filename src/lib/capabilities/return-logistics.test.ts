import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {CapabilityContext} from './types';
const f=vi.hoisted(()=>({enabled:true,read:vi.fn(),write:vi.fn(),readRefund:vi.fn(),prepare:vi.fn()}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return f.enabled;}}));
vi.mock('@/lib/returns/logistics',async original=>({...await original<typeof import('@/lib/returns/logistics')>(),readReturnLogistics:f.read,recordReturnLogistics:f.write}));
vi.mock('@/lib/returns/refund-link',async original=>({...await original<typeof import('@/lib/returns/refund-link')>(),readReturnRefundContext:f.readRefund,prepareReturnRefund:f.prepare}));
import {RETURN_LOGISTICS_CAPABILITIES} from './return-logistics';
import {ReturnRefundError} from '@/lib/returns/refund-link';
const actor='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',event='44444444-4444-4444-8444-444444444444',stamp='2026-10-01T12:00:00.123456Z';
const ctx={db:{},workspaceId:ws,actor:{type:'operator',id:actor},locale:'es'} as CapabilityContext;
const evidence={case_id:id,entry:{id:event,kind:'guide',payload:{carrier:'Example',tracking_number:'42'},expected_updated_at:stamp}};
const proposal={case_id:id,proposal:{id:event,receipt_id:event,amount:25,reason:'Checked'}};
const get=(key:string)=>RETURN_LOGISTICS_CAPABILITIES.find(cap=>cap.key.endsWith(key))!;
beforeEach(()=>{vi.clearAllMocks();f.enabled=true;f.read.mockResolvedValue({case_id:id,status:'aprobada',updated_at:stamp,platform:null,events:[],next_cursor:null});f.write.mockResolvedValue({event_id:event});f.readRefund.mockResolvedValue({receipt:{id:event}});f.prepare.mockResolvedValue({operation_id:event,status:'preview'});});
describe('Shared Operator/MCP return evidence adapters',()=>{
 it.each([false,true])('publishes the new tools only in a comparison build (%s)',async enabled=>{
  f.enabled=enabled;vi.resetModules();const {ALL_CAPABILITIES}=await import('./registry');const keys=new Set(ALL_CAPABILITIES.map(cap=>cap.key));for(const capability of RETURN_LOGISTICS_CAPABILITIES)expect(keys.has(capability.key)).toBe(enabled);
 },120000);
 it('requires human confirmation for an attestation and leaves financial preparation inert',()=>{
  expect(get('registrar_evidencia_devolucion').risk).toBe('irreversible');expect(get('registrar_evidencia_devolucion').inerte).toBeUndefined();expect(get('preparar_reembolso_devolucion').inerte).toBe(true);expect(get('historial_devolucion').risk).toBe('lectura');
 });
 it('cannot be invoked directly outside comparison',async()=>{
  f.enabled=false;await expect(get('registrar_evidencia_devolucion').run(ctx,evidence)).rejects.toThrow();await expect(get('preparar_reembolso_devolucion').run(ctx,proposal)).rejects.toThrow();expect(f.write).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
 });
 it('uses the real MCP issuer rather than a token label or supplied actor',async()=>{
  const mcp={...ctx,actor:{type:'mcp' as const,id:'token-label',userId:actor}};await get('registrar_evidencia_devolucion').run(mcp,evidence);expect(f.write).toHaveBeenCalledExactlyOnceWith(ctx.db,ws,actor,id,evidence.entry);
  await expect(get('registrar_evidencia_devolucion').run({...ctx,actor:{type:'mcp',id:actor}},evidence)).rejects.toThrow();expect(f.write).toHaveBeenCalledTimes(1);
 });
 it('checks current state/ETag and receipt identity in preview without writing or moving funds',async()=>{
  await get('registrar_evidencia_devolucion').preview!(ctx,evidence);await get('preparar_reembolso_devolucion').preview!(ctx,proposal);expect(f.write).not.toHaveBeenCalled();expect(f.prepare).not.toHaveBeenCalled();
  f.read.mockResolvedValue({...await f.read(),updated_at:'2026-10-01T12:00:00.123457Z'});await expect(get('registrar_evidencia_devolucion').preview!(ctx,evidence)).rejects.toThrow();
 });
 it('rejects malformed fields and missing/cron identities before running',async()=>{
  await expect(get('registrar_evidencia_devolucion').run(ctx,{...evidence,actor_id:actor})).rejects.toThrow();await expect(get('preparar_reembolso_devolucion').run({...ctx,actor:{type:'cron',id:actor}},proposal)).rejects.toThrow();expect(f.prepare).not.toHaveBeenCalled();expect(f.write).not.toHaveBeenCalled();
 });
 it.each(['es','en'] as const)('localizes failures and human review fields in %s',async locale=>{
  f.prepare.mockRejectedValue(new ReturnRefundError('pending'));await expect(get('preparar_reembolso_devolucion').run({...ctx,locale},proposal)).rejects.toThrow(locale==='es'?'Ya hay':'already');
  const artifact=get('registrar_evidencia_devolucion').artifact!({...ctx,locale},evidence,null);const text=JSON.stringify(artifact);expect(text).toContain(locale==='es'?'Transportadora':'Carrier');expect(text).not.toMatch(/expected_updated_at|actor_id|returns\./);
 });
});
