import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/security/public-json-request',async original=>({...await original<typeof import('@/lib/security/public-json-request')>(),requestExternalContactJson:f.request}));
import {PublicJsonError} from '@/lib/security/public-json-request';
import {readExternalContactPage} from './external-client';
const source={provider:'kommo' as const,origin:'https://fixture.kommo.com',accountId:7},cursor={page:1,collected:0,lastId:0};
const selected={provider:'manychat' as const,origin:'https://api.manychat.com' as const,accountId:7,subscriberIds:[42,43]};
beforeEach(()=>{f.request.mockReset().mockResolvedValue({status:200,data:{_page:1,_embedded:{contacts:[{id:1,account_id:7,name:'Fixture',custom_fields_values:null}]}}});});
describe('Read-only native contact provider requests',()=>{
 it('rechecks Gorgias account domain and constructs its cursor URL instead of following links',async()=>{
  const source={provider:'gorgias' as const,origin:'https://fixture.gorgias.com'};
  f.request.mockResolvedValueOnce({status:200,data:{domain:'fixture',status:{status:'active'}}}).mockResolvedValueOnce({status:200,data:{object:'list',data:[{id:42}],meta:{next_cursor:null}}});
  expect(await readExternalContactPage(source,'FIXTURE_TOKEN',{page:2,collected:1,lastId:1,sourceCursor:'A+/='})).toMatchObject({done:true,sourceCursor:null});
  expect(f.request.mock.calls[0][0].url).toBe(source.origin+'/api/account');const url=new URL(f.request.mock.calls[1][0].url);expect([...url.searchParams]).toEqual([['limit','25'],['order_by','created_datetime:asc'],['cursor','A+/=']]);
 });
 it('uses an explicit Zendesk end-user filter and boundary metadata',async()=>{
  const source={provider:'zendesk' as const,origin:'https://fixture.zendesk.com'};
  f.request.mockResolvedValueOnce({status:200,data:{users:[],meta:{has_more:false,after_cursor:null}}});
  expect(await readExternalContactPage(source,'FIXTURE_TOKEN',cursor)).toMatchObject({done:true,sourceCursor:null});const url=new URL(f.request.mock.calls[0][0].url);expect(url.pathname).toBe('/api/v2/users.json');expect([...url.searchParams]).toEqual([['page[size]','25'],['role','end-user'],['include_boundary_indicators','true']]);
 });
 it('rejects absent cursors on subsequent pages and foreign Gorgias accounts before listing',async()=>{
  const source={provider:'gorgias' as const,origin:'https://fixture.gorgias.com'};await expect(readExternalContactPage(source,'FIXTURE_TOKEN',{...cursor,page:2,collected:1})).rejects.toMatchObject({code:'source_changed'});expect(f.request).not.toHaveBeenCalled();
  f.request.mockResolvedValueOnce({status:200,data:{domain:'other',status:{status:'active'}}});await expect(readExternalContactPage(source,'FIXTURE_TOKEN',cursor)).rejects.toMatchObject({code:'source_changed'});expect(f.request).toHaveBeenCalledOnce();
 });
 it('uses fixed bounded Kommo pagination and constructs links itself',async()=>{
  expect(await readExternalContactPage(source,'FIXTURE_TOKEN',cursor)).toMatchObject({done:true,contacts:[{sourceId:'1',phone:''}]});
  const input=f.request.mock.calls[0][0],url=new URL(input.url);expect(input.provider).toBe('kommo');expect(url.origin).toBe(source.origin);expect(url.pathname).toBe('/api/v4/contacts');expect([...url.searchParams]).toEqual([['page','1'],['limit','25'],['order[id]','asc']]);expect(input).not.toHaveProperty('method');
 });
 it('recognizes a documented empty 204 without treating 205 or JSON null as an empty account',async()=>{
  f.request.mockResolvedValueOnce({status:204,data:null});expect(await readExternalContactPage(source,'FIXTURE_TOKEN',cursor)).toEqual({done:true,contacts:[]});
  for(const status of [200,205]){f.request.mockResolvedValueOnce({status,data:null});await expect(readExternalContactPage(source,'FIXTURE_TOKEN',cursor)).rejects.toMatchObject({code:'source_invalid'});}
 });
 it('fetches only explicitly selected subscribers after validating Page ownership',async()=>{
  f.request.mockResolvedValueOnce({status:200,data:{status:'success',data:{id:7}}}).mockResolvedValueOnce({status:200,data:{status:'success',data:{id:'42',page_id:'7',phone:'+573001112233'}}});
  expect(await readExternalContactPage(selected,'FIXTURE_TOKEN',cursor)).toMatchObject({done:false,contacts:[{sourceId:'42'}]});expect(f.request.mock.calls.map(call=>call[0].url)).toEqual(['https://api.manychat.com/fb/page/getInfo','https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=42']);
 });
 it('marks only the final selected ID complete',async()=>{
  f.request.mockResolvedValueOnce({status:200,data:{status:'success',data:{id:7}}}).mockResolvedValueOnce({status:200,data:{status:'success',data:{id:'43',page_id:'7'}}});
  expect((await readExternalContactPage(selected,'FIXTURE_TOKEN',{page:2,collected:1,lastId:42})).done).toBe(true);
 });
 it('does not fetch subscribers when the token belongs to a different Page',async()=>{
  f.request.mockResolvedValue({status:200,data:{status:'success',data:{id:8}}});await expect(readExternalContactPage(selected,'FIXTURE_TOKEN',cursor)).rejects.toMatchObject({code:'source_invalid'});expect(f.request).toHaveBeenCalledOnce();
 });
 it.each([{page:2,collected:0,lastId:0},{page:202,collected:5025,lastId:1},{...cursor,token:'injected'}])('rejects an inconsistent cursor before provider IO',async value=>{
  const error=await readExternalContactPage(source,'FIXTURE_TOKEN',value).catch(error=>error);expect(['source_invalid','source_changed']).toContain(error.code);expect(f.request).not.toHaveBeenCalled();
 });
 it.each([[401,'source_auth'],[402,'source_auth'],[403,'source_auth'],[429,'source_rate_limit'],[500,'source_unavailable']] as const)('redacts HTTP %s without implicit retries',async(status,code)=>{
  f.request.mockRejectedValue(new PublicJsonError('http_status_failed',true,status));await expect(readExternalContactPage(source,'FIXTURE_TOKEN',cursor)).rejects.toMatchObject({code});expect(f.request).toHaveBeenCalledOnce();
 });
});
