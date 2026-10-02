import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {whatsappVoiceRate,whatsappTelephonyRateForCall} from './whatsapp-calling-rates';
import type {VoiceCall} from '@/types';
const id='11111111-1111-4111-8111-111111111111',ws='22222222-2222-4222-8222-222222222222';
const binding={version:1,callId:id,workspaceId:ws,connectionId:ws,phoneNumberId:'123',wabaId:'456',peer:'12025550100',direction:'inbound',apiVersion:'26.0',providerCallId:'fixture'};
const call:Pick<VoiceCall,'id'|'workspace_id'|'direction'|'context'>={id,workspace_id:ws,direction:'inbound',context:{__whatsapp_call:binding}};
beforeEach(()=>{vi.stubEnv('VOICE_WHATSAPP_INBOUND_USD_PER_MIN','0.003');vi.stubEnv('VOICE_WHATSAPP_OUTBOUND_USD_PER_MIN','0.012');});
afterEach(()=>vi.unstubAllEnvs());
describe('Transport-specific voice billing',()=>{
 it('does not change PSTN or legacy null-context pricing',()=>{expect(whatsappTelephonyRateForCall({...call,context:{}})).toBeNull();expect(whatsappTelephonyRateForCall({...call,context:null as unknown as VoiceCall['context']})).toBeNull();});
 it('uses the configured agreement for the bound direction',()=>{expect(whatsappTelephonyRateForCall(call)).toBe(0.003);expect(whatsappVoiceRate('outbound')).toBe(0.012);});
 it.each(['',' ','-1','NaN','Infinity','no-rate'])('blocks an unconfigured agreement instead of guessing %s',raw=>{vi.stubEnv('VOICE_WHATSAPP_INBOUND_USD_PER_MIN',raw);expect(()=>whatsappTelephonyRateForCall(call)).toThrow('wallet_whatsapp_voice_rate_not_configured');});
 it('accepts an explicitly configured zero rate',()=>{vi.stubEnv('VOICE_WHATSAPP_INBOUND_USD_PER_MIN','0');expect(whatsappTelephonyRateForCall(call)).toBe(0);});
 it.each([{callId:ws},{workspaceId:id},{direction:'outbound'},{providerCallId:null}])('rejects a forged binding %j',change=>expect(()=>whatsappTelephonyRateForCall({...call,context:{__whatsapp_call:{...binding,...change}}})).toThrow('wallet_invalid_whatsapp_voice_binding'));
});
