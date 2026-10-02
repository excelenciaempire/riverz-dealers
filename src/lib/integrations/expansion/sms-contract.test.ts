import {describe,expect,it} from 'vitest';
import {reviewedSms,smsCost,smsEncoding,smsWasDelivered} from './sms-contract';
describe('SMS units and delivery evidence',()=>{
 it('counts GSM single and concatenated segment boundaries',()=>{expect(smsEncoding('a'.repeat(160))).toMatchObject({encoding:'GSM-7',segments:1,units:160});expect(smsEncoding('a'.repeat(161))).toMatchObject({segments:2});expect(smsEncoding('a'.repeat(1530))).toMatchObject({segments:10});expect(smsEncoding('a'.repeat(1531))).toBeNull();});
 it('counts extended GSM escape units',()=>{expect(smsEncoding('^'.repeat(80))).toMatchObject({segments:1,units:160});expect(smsEncoding('€'.repeat(81))).toMatchObject({segments:2,units:162});});
 it('counts Unicode and supplementary emoji in UTF-16 units',()=>{expect(smsEncoding('á'.repeat(70))).toMatchObject({encoding:'UTF-16',segments:1,units:70});expect(smsEncoding('á'.repeat(71))).toMatchObject({segments:2});expect(smsEncoding('😀'.repeat(35))).toMatchObject({units:70,segments:1});expect(smsEncoding('😀'.repeat(36))).toMatchObject({units:72,segments:2});});
 it.each(['','   ','a\u0000b','a\u001bb','\ud800'])('rejects malformed text %s',text=>expect(smsEncoding(text)).toBeNull());
 it('does not treat queued, sent or unconfirmed as delivered',()=>{for(const status of ['queued','sending','sent','delivery_unconfirmed','delivery_failed'] as const)expect(smsWasDelivered(status)).toBe(false);expect(smsWasDelivered('delivered')).toBe(true);});
 it('requires an explicit text SMS and does not accept provider authority in its payload',()=>{const input={from:'+12025550100',to:'+573001234567',text:'Hello',type:'SMS'};expect(reviewedSms.safeParse(input).success).toBe(true);expect(reviewedSms.safeParse({...input,type:'MMS'}).success).toBe(false);expect(reviewedSms.safeParse({...input,token:'secret'}).success).toBe(false);});
 it('preserves provider amounts as decimals with currency, never a guessed rate',()=>{expect(smsCost.safeParse({amount:'0.0075',currency:'USD'}).success).toBe(true);expect(smsCost.safeParse({amount:0.0075,currency:'USD'}).success).toBe(false);expect(smsCost.safeParse({amount:'-1',currency:'USD'}).success).toBe(false);});
});
