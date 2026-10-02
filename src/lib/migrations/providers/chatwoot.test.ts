import {describe,expect,it} from 'vitest';
import {projectChatwootContacts,projectChatwootMessages} from './chatwoot';
const contact=(id=1)=>({id,account_id:7,name:' Example ',email:'person@example.test',phone_number:'+573001112233',identifier:'not-a-transport-proof',contact_inboxes:[{source_id:'not-a-verified-wa-id'}],custom_attributes:{token:'SECRET'},access_token:'SECRET'});
const contacts=(total=1,page:number|string=1,payload:unknown[]=[contact()])=>({meta:{count:total,current_page:page},payload});
const expected={accountId:7,page:1};
const message=(id=1)=>({id,account_id:7,conversation_id:11,inbox_id:3,message_type:0,private:false,created_at:1790911000+id,content:'Example',sender:{access_token:'SECRET'},content_attributes:{email:{html:'PRIVATE_EXTRA'}}});
const context={accountId:7,conversationId:11,inboxId:3};
describe('Chatwoot projection before any remote connector is enabled',()=>{
 it('projects only explicit contact fields without source IDs or credentials from nested inboxes',()=>{
  expect(projectChatwootContacts(contacts(),expected)).toEqual({total:1,page:1,next:null,contacts:[{sourceId:'1',name:'Example',phone:'+573001112233',email:'person@example.test',company:''}]});
  expect(JSON.stringify(projectChatwootContacts(contacts(),expected))).not.toMatch(/SECRET|transport|token|contact_inboxes/);
 });
 it('accepts the documented numeric/string page metadata and retains missing phone for later exclusion',()=>{
  expect(projectChatwootContacts(contacts(1,'1',[{id:1,phone_number:null}]),expected).contacts[0].phone).toBe('');
  expect(projectChatwootContacts(contacts(0,1,[]),expected)).toMatchObject({total:0,next:null,contacts:[]});
  expect(projectChatwootContacts(contacts(1,1,[contact(5000000000)]),expected).contacts[0].sourceId).toBe('5000000000');
 });
 it('requires all 15 items on a non-final page and preserves the final page total',()=>{
  const rows=Array.from({length:15},(_,index)=>contact(index+1));expect(projectChatwootContacts(contacts(16,1,rows),expected).next).toBe(2);
  expect(projectChatwootContacts(contacts(16,2,[contact(16)]),{...expected,page:2,total:16})).toMatchObject({next:null,total:16});
  expect(()=>projectChatwootContacts(contacts(16),expected)).toThrow('source_changed');
 });
 it.each([{...contacts(),meta:{count:1,current_page:2}},contacts(2),contacts(1,1,[{...contact(),account_id:8}]),contacts(2,1,[contact(),contact()])])('rejects changed page, count, account or duplicate identities',value=>{
  expect(()=>projectChatwootContacts(value,expected)).toThrow('source_changed');
 });
 it('refuses oversize source accounts and metadata drift instead of returning a truncated success',()=>{
  expect(()=>projectChatwootContacts(contacts(5001),expected)).toThrow('source_limit');
  expect(()=>projectChatwootContacts(contacts(),{...expected,total:2})).toThrow('source_changed');
 });
 it.each([contacts(1,1,[{...contact(),id:1.5}]),contacts(1,1,[{...contact(),name:'x'.repeat(4097)}]),contacts(1,'oops'),{payload:[contact()]},contacts(1,1,[{...contact(),email:42}])])('fails closed on malformed contact fields',value=>{
  expect(()=>projectChatwootContacts(value,expected)).toThrow('source_invalid');
 });
 it('retains private notes as private and refuses to convert them into customer messages',()=>{
  const value=projectChatwootMessages({payload:[{...message(),private:true,message_type:1}]},context);
  expect(value).toMatchObject({messages:[{kind:'note',private:true,text:'Example',sourceId:'1'}],nextBefore:1,empty:false});expect(JSON.stringify(value)).not.toMatch(/SECRET|PRIVATE_EXTRA|sender|content_attributes/);
 });
 it('preserves actual message types, empty text and an explicit earlier-page cursor',()=>{
  const value=projectChatwootMessages({payload:[message(1),{...message(2),message_type:3,content:null}]},context);
  expect(value.messages.map(row=>[row.kind,row.text])).toEqual([['incoming','Example'],['template','']]);expect(value.nextBefore).toBe(1);
  expect(projectChatwootMessages({payload:[]},{...context,before:1})).toEqual({messages:[],nextBefore:null,empty:true});
 });
 it.each([{...message(),account_id:8},{...message(),conversation_id:12},{...message(),inbox_id:4}])('rejects a message belonging to another scope',row=>{
  expect(()=>projectChatwootMessages({payload:[row]},context)).toThrow('source_changed');
 });
 it('rejects non-monotonic IDs, timestamps and a repeated before cursor without dropping messages',()=>{
  expect(()=>projectChatwootMessages({payload:[message(2),message(1)]},context)).toThrow('source_order_unsupported');
  expect(()=>projectChatwootMessages({payload:[message(1),{...message(2),created_at:1}]},context)).toThrow('source_order_unsupported');
  expect(()=>projectChatwootMessages({payload:[message(2)]},{...context,before:2})).toThrow('source_changed');
 });
 it('keeps attachment references separate; performs no download and makes no verified content claim',()=>{
  const file={id:12,file_type:'image',data_url:'https://cdn.example.test/file?signature=FIXTURE',file_size:1024,access_token:'SECRET'};
  expect(projectChatwootMessages({payload:[{...message(),attachments:[file]}]},context).messages[0].attachments).toEqual([{sourceId:'12',type:'image',referenceUrl:file.data_url,bytes:1024}]);
 });
 it('does not silently lose an undocumented legacy attachment or a structured content type',()=>{
  expect(()=>projectChatwootMessages({payload:[{...message(),attachment:{data_url:'https://cdn.example.test/a'}}]},context)).toThrow('source_invalid');
  expect(projectChatwootMessages({payload:[{...message(),content_type:'incoming_email',attachment:{}}]},context).messages[0].sourceFormat).toBe('incoming_email');
 });
 it.each(['http://cdn.example.test/a','https://127.0.0.1/a','https://user:pass@cdn.example.test/a','javascript:alert(1)'])('rejects an unsafe attachment reference %s',url=>{
  expect(()=>projectChatwootMessages({payload:[{...message(),attachments:[{id:1,file_type:'image',data_url:url}]}]},context)).toThrow('source_invalid');
 });
 it.each([{...message(),private:undefined},{...message(),message_type:4},{...message(),created_at:4102444801},{...message(),content:'x'.repeat(150001)}])('rejects uncertain privacy, unknown types and excessive text',row=>{
  expect(()=>projectChatwootMessages({payload:[row]},context)).toThrow('source_invalid');
 });
});
