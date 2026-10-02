import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
const mock=vi.hoisted(()=>({enabled:true}));
vi.mock('@/lib/ui/improvements-preview',()=>({get SHOW_RIVERZ_IMPROVEMENTS(){return mock.enabled;}}));
import {controlledVoiceSttSeconds} from './human-media-boundary';
const callId='11111111-1111-4111-8111-111111111111';
function fixture(data:unknown,error:unknown=null){const rpc=vi.fn().mockResolvedValue({data,error});return {rpc,db:{rpc} as unknown as SupabaseClient};}
afterEach(()=>{mock.enabled=true;});
describe('Human voice does not become fallback AI transcription usage',()=>{
 it('retains measured usage without an extra database read',async()=>{const {rpc,db}=fixture(null);expect(await controlledVoiceSttSeconds(db,callId,300,42)).toBe(42);expect(rpc).not.toHaveBeenCalled();});
 it('preserves the existing flag-off fallback with no RPC',async()=>{mock.enabled=false;const {rpc,db}=fixture(null);expect(await controlledVoiceSttSeconds(db,callId,300,undefined)).toBe(300);expect(rpc).not.toHaveBeenCalled();});
 it('falls back normally for a call that never stopped AI',async()=>{const {db}=fixture(null);expect(await controlledVoiceSttSeconds(db,callId,300,undefined)).toBe(300);});
 it('caps missing usage at the server-acknowledged AI segment, not the human duration',async()=>{const {db}=fixture({call_id:callId,answered_at:'2026-10-02T10:00:00Z',ai_stopped_at:'2026-10-02T10:00:35Z'});expect(await controlledVoiceSttSeconds(db,callId,300,undefined)).toBe(35);expect(await controlledVoiceSttSeconds(db,callId,20,undefined)).toBe(20);});
 it('fails closed on an unavailable or cross-call boundary rather than charging human STT',async()=>{for(const f of [fixture(null,{message:'unavailable'}),fixture({call_id:'22222222-2222-4222-8222-222222222222',answered_at:'2026-10-02T10:00:00Z',ai_stopped_at:'2026-10-02T10:00:35Z'})])await expect(controlledVoiceSttSeconds(f.db,callId,300,undefined)).rejects.toThrow('voice_usage_boundary_unavailable');});
});
