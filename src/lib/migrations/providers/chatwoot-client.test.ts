import {beforeEach,describe,expect,it,vi} from 'vitest';
const calls=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/security/public-json-request',async original=>({...await original<typeof import('@/lib/security/public-json-request')>(),requestChatwootJson:calls.request}));
import {PublicJsonError} from '@/lib/security/public-json-request';
import {readChatwootContactPage} from './chatwoot-client';
const source={provider:'chatwoot' as const,origin:'https://source.example.test',accountId:7};
beforeEach(()=>{calls.request.mockReset().mockResolvedValue({status:200,data:{meta:{count:1,current_page:'1'},payload:[{id:1,name:'Example',phone_number:'+573001112233'}]}});});
describe('Read-only source page broker',()=>{
 it('constructs an account-scoped GET page and returns only normalized fields',async()=>{
  expect(await readChatwootContactPage(source,'FIXTURE_TOKEN',{page:1})).toMatchObject({total:1,contacts:[{sourceId:'1'}]});
  expect(calls.request).toHaveBeenCalledExactlyOnceWith({url:'https://source.example.test/api/v1/accounts/7/contacts?page=1&sort=name&include_contact_inboxes=false',token:'FIXTURE_TOKEN'});
 });
 it.each([{page:0},{page:335},{page:1,total:5001},{page:1,workspace_id:'foreign'},{page:1,total:NaN}])('refuses forged cursor data before transport',async cursor=>{
  await expect(readChatwootContactPage(source,'FIXTURE_TOKEN',cursor)).rejects.toThrow('source_invalid');expect(calls.request).not.toHaveBeenCalled();
 });
 it('rejects provider drift without returning a partial or successful empty page',async()=>{
  await expect(readChatwootContactPage(source,'FIXTURE_TOKEN',{page:1,total:2})).rejects.toThrow('source_changed');
  calls.request.mockResolvedValue({status:200,data:{meta:{count:1,current_page:1},payload:[]}});await expect(readChatwootContactPage(source,'FIXTURE_TOKEN',{page:1})).rejects.toThrow('source_changed');
 });
 it.each([[401,'source_auth'],[403,'source_auth'],[429,'source_rate_limit'],[500,'source_unavailable']] as const)('redacts HTTP %s without retrying an external request',async(status,code)=>{
  calls.request.mockRejectedValue(new PublicJsonError('http_status_failed',true,status));await expect(readChatwootContactPage(source,'FIXTURE_TOKEN',{page:1})).rejects.toThrow(code);expect(calls.request).toHaveBeenCalledOnce();
 });
 it.each([['http_timeout','source_timeout'],['http_response_too_large','source_limit']] as const)('reports %s without URLs or credentials',async(code,message)=>{
  calls.request.mockRejectedValue(new PublicJsonError(code));await expect(readChatwootContactPage(source,'FIXTURE_TOKEN',{page:1})).rejects.toThrow(message);
 });
 it('never exposes a provider exception or secret',async()=>{
  calls.request.mockRejectedValue(new Error('PRIVATE_URL_TOKEN'));await expect(readChatwootContactPage(source,'FIXTURE_TOKEN',{page:1})).rejects.toThrow('source_unavailable');
 });
});
