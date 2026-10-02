import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({context:{} as Record<string,unknown>,update:vi.fn(),settle:vi.fn()}));
vi.mock('./media-billing',()=>({settleVoiceMedia:m.settle}));
vi.mock('./human-media-boundary',()=>({controlledVoiceSttSeconds:async()=>0}));
vi.mock('@/lib/channels/admin-client',()=>({supabaseAdmin:()=>({from:()=>{
 const query={select:()=>query,eq:()=>query,is:()=>query,maybeSingle:async()=>({data:{id:'fixture-call',context:m.context,direction:'outbound',ended_at:null}}),update:(values:unknown)=>{m.update(values);return query;},then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return query;
}})}));
import {persistCallResult} from './result';
beforeEach(()=>{vi.clearAllMocks();m.settle.mockRejectedValue(new Error('fixture settlement boundary'));m.context={};});
describe('Transport capacity backpressure cannot switch WhatsApp to PSTN',()=>{
 it('preserves existing PSTN capacity requeue behavior',async()=>{
  expect(await persistCallResult({call_id:'fixture-call',status:'capacity_limited'})).toEqual({ok:true,reason:'requeued_for_capacity'});expect(m.update).toHaveBeenCalledWith(expect.objectContaining({status:'queued',room_name:null}));expect(m.settle).not.toHaveBeenCalled();
 });
 it('takes WhatsApp through terminal settlement without inserting it in the PSTN queue',async()=>{
  m.context={__whatsapp_call:{}};await expect(persistCallResult({call_id:'fixture-call',status:'capacity_limited'})).rejects.toThrow('fixture settlement boundary');expect(m.update).not.toHaveBeenCalled();expect(m.settle).toHaveBeenCalledOnce();
 });
});
