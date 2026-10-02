import {describe,expect,it} from 'vitest';
import {productReturnPolicy,productPolicyWrite,productReturnPolicyPrompt,returnPolicyWindow} from './product-policy-contract';
const policy={mode:'allow' as const,window_days:10,starts_at:'delivery' as const,remedies:['refund' as const],conditions:'Original packaging'};
const reference={kind:'delivery' as const,at:'2026-03-01T12:00:00Z',verified:true},now='2026-03-11T12:00:00Z';
describe('Merchant-declared product policy contract and advisory window',()=>{
 it('accepts explicit terms, an unspecified window and a withdrawal',()=>{
  expect(productReturnPolicy.parse(policy)).toEqual(policy);expect(productReturnPolicy.parse({...policy,window_days:null}).window_days).toBeNull();
  expect(productPolicyWrite.parse({id:'11111111-1111-4111-8111-111111111111',expected_revision:2,policy:null}).policy).toBeNull();
 });
 it.each([{...policy,window_days:0},{...policy,window_days:366},{...policy,window_days:1.5},{...policy,remedies:['refund','refund']},{...policy,remedies:[]},{...policy,mode:'not_offered'},{...policy,conditions:'x'.repeat(1201)},{...policy,approved:true}])('rejects invalid terms or authority overrides',value=>{
  expect(productReturnPolicy.safeParse(value).success).toBe(false);
 });
 it('preserves the exact end boundary and uses elapsed days across daylight changes',()=>{
  expect(returnPolicyWindow(policy,reference,now)).toEqual({state:'within_declared_window',deadline:now.replace('Z','.000Z')});
  expect(returnPolicyWindow(policy,reference,'2026-03-11T12:00:00.001Z').state).toBe('outside_declared_window');
  expect(returnPolicyWindow({...policy,window_days:1},{...reference,at:'2026-03-08T01:00:00-05:00'},'2026-03-09T02:00:00-04:00').state).toBe('within_declared_window');
 });
 it.each([null,{...reference,verified:false},{...reference,kind:'purchase' as const},{...reference,at:'2026-03-01'},{...reference,at:'2026-03-20T12:00:00Z'}])('does not substitute an absent, unverified, wrong or future reference date',value=>{
  expect(returnPolicyWindow(policy,value,now)).toEqual({state:'review',deadline:null});
 });
 it.each([{...policy,window_days:null},{...policy,mode:'review' as const},{...policy,mode:'not_offered' as const,remedies:[]}])('keeps unspecified/review/not-offered terms subject to review',value=>{
  expect(returnPolicyWindow(value,reference,now).state).toBe('review');
 });
 it.each(['es','en'] as const)('includes the exact version and financial/date limits in %s reference data',locale=>{
  const text=productReturnPolicyPrompt({product_id:'11111111-1111-4111-8111-111111111111',revision:7,policy,changed_at:now},locale);
  expect(text).toContain('7');expect(text).toContain('Original packaging');expect(text).toContain(locale==='es'?'no autoriza rechazo automático':'do not authorize automatic denial');
  expect(productReturnPolicyPrompt({product_id:'11111111-1111-4111-8111-111111111111',revision:8,policy:null,changed_at:now},locale)).toBeNull();
 });
});
