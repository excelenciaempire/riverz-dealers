import { beforeEach,describe,expect,it,vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapabilityContext } from './types'
const mocks=vi.hoisted(() => ({ prepare:vi.fn(),rpc:vi.fn(),from:vi.fn() }))
vi.mock('@/lib/ai/gap-knowledge-actions',async original => ({ ...await original<typeof import('@/lib/ai/gap-knowledge-actions')>(),prepareGapKnowledgeReview:mocks.prepare }))
import { gapCapabilityActor } from '@/lib/ai/gap-knowledge-actions'
import { PRODUCT_CAPABILITIES } from './products'
import { BANDEJA_CAPABILITIES } from './bandeja'
const ctx:CapabilityContext={ db:{ rpc:mocks.rpc,from:mocks.from } as unknown as SupabaseClient,workspaceId:'active-store',actor:{ type:'mcp',id:'token-label',userId:'authenticated-issuer' },locale:'en' }
const product='66666666-6666-4666-8666-666666666666',receipt='77777777-7777-4777-8777-777777777777'
beforeEach(() => { vi.clearAllMocks();mocks.prepare.mockResolvedValue({ data:{ id:receipt },error:null });mocks.rpc.mockResolvedValue({ data:{ ok:true },error:null }) })
describe('one supervised writer for the editor, Operator and MCP',() => {
 it('requires the existing confirmation boundary before publishing generated gap answers',() => {
  const cap=PRODUCT_CAPABILITIES.find(c => c.key==='productos.responder_hueco')!
  expect(cap.risk).toBe('irreversible');expect(cap.inerte).not.toBe(true);expect(cap.preview).toBeTypeOf('function')
 })
 it('uses the authenticated MCP issuer, never a caller label as the author',() => {
  expect(gapCapabilityActor(ctx)).toBe('authenticated-issuer');expect(() => gapCapabilityActor({ ...ctx,actor:{ type:'mcp',id:'forged-user-label' } })).toThrow('invalid_gap_context')
 })
 it('prepares and confirms the same receipt without a blind FAQ update or closing private gaps',async() => {
  const cap=PRODUCT_CAPABILITIES.find(c => c.key==='productos.responder_hueco')!
  expect(await cap.run(ctx,{ producto_id:product,pregunta:'Delivery?',respuesta:'Verified date',hueco_clave:'delivery' })).toMatchObject({ hueco_cerrado:true,knowledge_receipt_id:receipt })
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ workspaceId:'active-store',userId:'authenticated-issuer' }),expect.objectContaining({ destino:'producto',key:'delivery' }))
  expect(mocks.rpc).toHaveBeenCalledWith('confirm_gap_knowledge_review',{ p_workspace_id:'active-store',p_actor_id:'authenticated-issuer',p_review_id:receipt });expect(mocks.from).not.toHaveBeenCalled()
 })
 it('never closes a source when preparation or confirmation fails',async() => {
  const cap=PRODUCT_CAPABILITIES.find(c => c.key==='productos.responder_hueco')!,args={ producto_id:product,pregunta:'Delivery?',respuesta:'Verified date',hueco_clave:'delivery' }
  mocks.prepare.mockResolvedValue({ data:null,error:{ message:'invalid_gap_context' } });await expect(cap.run(ctx,args)).rejects.toThrow('invalid_gap_context');expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.prepare.mockResolvedValue({ data:{ id:receipt },error:null });mocks.rpc.mockResolvedValue({ data:null,error:{ message:'gap_changed' } });await expect(cap.run(ctx,args)).rejects.toThrow('gap_changed');expect(mocks.rpc).toHaveBeenCalledTimes(1)
 })
 it('reads gaps only through the current-member RPC and supplies the existing resolution key',async() => {
  mocks.rpc.mockResolvedValue({ data:[{ id:'gap',question:'Delivery?',question_key:'delivery',missing:'Date',channel:'whatsapp',created_at:'2026-09-30',resolved_at:null,conversation_id:'case' }],error:null })
  const cap=BANDEJA_CAPABILITIES.find(c => c.key==='bandeja.huecos')!
  expect(await cap.run(ctx,{})).toMatchObject({ huecos:[{ hueco_clave:'delivery',pregunta:'Delivery?' }] });expect(mocks.rpc).toHaveBeenCalledWith('list_visible_answer_gaps',{ p_workspace_id:'active-store',p_actor_id:'authenticated-issuer',p_resolved:false });expect(mocks.from).not.toHaveBeenCalled()
 })
})
