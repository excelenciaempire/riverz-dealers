import {describe,expect,it} from 'vitest';
import {projectKommoContacts,projectManyChatContact,checkManyChatPage} from './external-contacts';
import {externalSourceDefinition,externalSourceSnapshot} from '../external-source-contract';
const source={provider:'kommo' as const,origin:'https://fixture.kommo.com',accountId:7},context={source,page:1,lastId:0};
const contact=(id=1)=>({id,account_id:7,name:' Fixture ',custom_fields_values:[{field_code:'PHONE',values:[{value:'+573001112233'}]},{field_code:'EMAIL',values:[{value:'person@example.test'}]},{field_code:'SECRET',values:[{value:'PRIVATE'}]}],_embedded:{companies:[{id:999}]},access_token:'PRIVATE'});
const page=(contacts:unknown[]=[contact()],n=1)=>({_page:n,_embedded:{contacts},_links:{next:{href:'https://evil.test/private'}}});
const subscriber=()=>({status:'success',data:{id:'42',page_id:'7',name:' Fixture ',phone:'+573001112233',whatsapp_phone:'+573001112233',email:'person@example.test',optin_whatsapp:true,whatsapp_bsuid:'UNVERIFIED',last_input_text:'PRIVATE',access_token:'PRIVATE'}});
describe('Native external contact minimal projections',()=>{
 it('projects explicit fields and ignores links, company IDs, secrets and opt-ins',()=>{
  expect(projectKommoContacts(page(),context)).toEqual({done:true,contacts:[{sourceId:'1',phone:'+573001112233',email:'person@example.test',name:'Fixture',company:''}]});
  expect(JSON.stringify(projectKommoContacts(page(),context))).not.toMatch(/PRIVATE|evil|999/);
  expect(projectManyChatContact(subscriber(),{accountId:7,subscriberId:42})).toEqual({sourceId:'42',phone:'+573001112233',email:'person@example.test',name:'Fixture',company:''});
 });
 it('leaves ambiguous phones/emails blank for exclusion rather than selecting an identity',()=>{
  const item=contact();item.custom_fields_values[0].values.push({value:'+573009998877'});item.custom_fields_values[1].values.push({value:'other@example.test'});
  expect(projectKommoContacts(page([item]),context).contacts[0]).toMatchObject({phone:'',email:''});
  const other=subscriber();other.data.whatsapp_phone='+573009998877';expect(projectManyChatContact(other,{accountId:7,subscriberId:42}).phone).toBe('');
 });
 it('continues full pages, terminates only a short/204 response and checks the page',()=>{
  expect(projectKommoContacts(page(Array.from({length:25},(_,i)=>contact(i+1))),context).done).toBe(false);
  expect(projectKommoContacts(null,context)).toEqual({done:true,contacts:[]});
  expect(()=>projectKommoContacts(page([],2),context)).toThrow('source_invalid');
 });
 it.each(['account','descending','duplicate','deleted','oversized','invalidPhone'] as const)('rejects %s Kommo data without returning partial contacts',mode=>{
  const items=[contact(2),contact(3)];if(mode==='account')items[1].account_id=8;if(mode==='descending')items.reverse();if(mode==='duplicate')items[1].id=2;
  if(mode==='deleted')Object.assign(items[1],{is_deleted:true});if(mode==='oversized')items[1].name='x'.repeat(4097);if(mode==='invalidPhone')Object.assign(items[1].custom_fields_values[0].values[0],{value:123});
  expect(()=>projectKommoContacts(page(items),context)).toThrow();
 });
 it('rejects a cross-page source ID overlap',()=>expect(()=>projectKommoContacts(page([contact(25)],2),{...context,page:2,lastId:25})).toThrow('source_changed'));
 it.each(['subscriber','account','status','numericIds'] as const)('rejects %s ManyChat data',mode=>{
  const data=subscriber();if(mode==='subscriber')data.data.id='43';if(mode==='account')data.data.page_id='8';if(mode==='status')data.status='error';if(mode==='numericIds')Object.assign(data.data,{id:42});
  expect(()=>projectManyChatContact(data,{accountId:7,subscriberId:42})).toThrow('source_invalid');
 });
 it('binds ManyChat token ownership to the actual Page',()=>{expect(()=>checkManyChatPage({status:'success',data:{id:7}},7)).not.toThrow();expect(()=>checkManyChatPage({status:'success',data:{id:8}},7)).toThrow();});
 it.each([
  {...source,origin:'https://fixture.kommo.com.evil.test'}, {...source,origin:'https://fixture.kommo.com/path'}, {...source,token:'SECRET'},
  {provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[42,42]},
  {provider:'manychat',origin:'https://api.manychat.com',accountId:7,subscriberIds:[]},
  {provider:'manychat',origin:'https://evil.test',accountId:7,subscriberIds:[42]},
 ])('rejects unsupported source scopes before credentials are collected',input=>expect(externalSourceDefinition.safeParse(input).success).toBe(false));
 it('allows an unknown total during an observed Kommo listing without inventing completion',()=>{
  const v={id:'11111111-1111-4111-8111-111111111111',workspace_id:'22222222-2222-4222-8222-222222222222',actor_id:'33333333-3333-4333-8333-333333333333',source,state:'queued',total:null,collected:25,created_at:'2026-10-02T00:00:00Z',expires_at:'2026-10-02T02:00:00Z',updated_at:'2026-10-02T00:00:01Z',error:null,rows:[],next:null};
  expect(externalSourceSnapshot.safeParse(v).success).toBe(true);expect(externalSourceSnapshot.safeParse({...v,state:'ready'}).success).toBe(false);
 });
});
