import {describe,it,expect,vi} from 'vitest';
import {DEFAULT_EMAIL_POLICY,emailDispositionForPolicy,emailRedirectText,isEmailChannel,loadEmailPolicy,normalizeEmailPhone,validEmailPolicy} from './email-policy';
function database(numbers:string[],stored:unknown=null){
 const q={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:stored,error:null})};
 const c={select:vi.fn().mockReturnThis(),eq:vi.fn()};
 c.eq.mockReturnValueOnce(c).mockReturnValueOnce(c).mockResolvedValueOnce({data:numbers.map(n=>({config:{display_phone_number:n}})),error:null});
 return {from:vi.fn().mockReturnValueOnce(q).mockReturnValueOnce(c)};
}
describe('workspace email policy',()=>{
 it('honors all configurable modes and repeat settings with shared live/test decisions',()=>{
  const p={...DEFAULT_EMAIL_POLICY,whatsapp_number:'12025550101'};
  const input={workspaceId:'any',channel:'zoho',text:'¿Cuánto cuesta?',alreadyRedirected:true};
  expect(emailDispositionForPolicy(p,input)).toBe('review');
  expect(emailDispositionForPolicy({...p,prevent_repeated_redirects:false},input)).toBe('customer');
  expect(emailDispositionForPolicy({...p,mode:'assist'},input)).toBeNull();
  expect(emailDispositionForPolicy({...p,mode:'manual'},input)).toBe('review');
  expect(emailDispositionForPolicy({...p,mode:'manual'},{...input,text:'Gracias'})).toBe('ignore');
  expect(emailDispositionForPolicy(DEFAULT_EMAIL_POLICY,{...input,alreadyRedirected:false})).toBe('review');
 });
 it.each(['gmail','outlook','zoho'])('recognizes %s',c=>expect(isEmailChannel(c)).toBe(true));
 it('does not affect WhatsApp',()=>expect(isEmailChannel('whatsapp')).toBe(false));
 it('uses safe defaults for existing and new workspaces without overwriting configuration',async()=>{
  const db=database(['+54 9 2255 629123']);
  const result=await loadEmailPolicy(db as never,'merchant-a');
  expect(result).toEqual({...DEFAULT_EMAIL_POLICY,whatsapp_number:'5492255629123'});
 });
 it('does not choose another merchant or an arbitrary connected line',async()=>{
  for(const numbers of [[],['+12025550101','+12025550102']]){
   const db=database(numbers);
   expect((await loadEmailPolicy(db as never,'merchant-b')).whatsapp_number).toBe('');
  }
 });
 it('preserves saved manual mode and explicit phone',async()=>{
  const saved={...DEFAULT_EMAIL_POLICY,mode:'manual',whatsapp_number:'12025550101'};
  const db=database([],saved);expect(await loadEmailPolicy(db as never,'merchant')).toEqual(saved);
  expect(db.from).toHaveBeenCalledTimes(1);
 });
 it('validates settings without accepting links or invented destinations',()=>{
  expect(validEmailPolicy(DEFAULT_EMAIL_POLICY)).toBe(true);
  for(const patch of [{mode:'anything'},{whatsapp_number:'https://evil.test'},{whatsapp_number:'123'},{filter_notifications:'false'}])
   expect(validEmailPolicy({...DEFAULT_EMAIL_POLICY,...patch})).toBe(false);
  expect(normalizeEmailPhone('+1 (202) 555-0101')).toBe('12025550101');
 });
 it('builds a free localized redirect only with the merchant destination',()=>{
  const policy={...DEFAULT_EMAIL_POLICY,whatsapp_number:'12025550101'};
  expect(emailRedirectText(policy,'es')).toContain('https://wa.me/12025550101');
  expect(emailRedirectText(policy,'en')).toContain('Please continue');
  expect(emailRedirectText(DEFAULT_EMAIL_POLICY,'es')).toBeNull();
  expect(emailRedirectText({...policy,mode:'assist'},'es')).toBeNull();
 });
});
