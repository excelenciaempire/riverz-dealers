import {describe,expect,it} from 'vitest';
import {checkGorgiasAccount,projectGorgiasContacts,projectZendeskContacts} from './cursor-contacts';
const customer={id:42,name:'Fixture',email:'person@example.test',channels:[{type:'phone',address:'+573001112233'}],integrations:{secret:'PRIVATE'},note:'PRIVATE'};
const gorgias={object:'list',data:[customer],meta:{next_cursor:'NEXT_1=='},links:{next:'https://evil.test'}};
const zendesk={users:[{id:42,name:'Fixture',role:'end-user',phone:'+573001112233',email:'person@example.test',verified:true,notes:'PRIVATE'}],meta:{has_more:true,after_cursor:'NEXT_1=='},links:{next:'https://evil.test'}};
describe('Documented cursor projections',()=>{
 it('keeps five contact fields and ignores provider links, private data and consent flags',()=>{
  for(const result of [projectGorgiasContacts(gorgias,null),projectZendeskContacts(zendesk,null)]){
   expect(result).toMatchObject({done:false,sourceCursor:'NEXT_1==',contacts:[{sourceId:'42',phone:'+573001112233',company:''}]});expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(Object.keys(result.contacts[0])).toHaveLength(5);
  }
 });
 it('does not infer a phone or choose a conflicting channel',()=>{
  const row={...customer,channels:[...customer.channels,{type:'phone',address:'+573009998877'},{type:'email',address:'other@example.test'}]};
  expect(projectGorgiasContacts({...gorgias,data:[row]},null).contacts[0]).toMatchObject({phone:'',email:''});
  expect(projectGorgiasContacts({...gorgias,data:[{id:1}]},null).contacts[0].phone).toBe('');
 });
 it('requires the current active Gorgias account domain without inventing a numeric ID',()=>{
  expect(()=>checkGorgiasAccount({domain:'fixture',status:{status:'active'}},'https://fixture.gorgias.com')).not.toThrow();
  for(const data of [{domain:'other',status:{status:'active'}},{domain:'fixture',status:{status:'inactive'}},{id:7}])expect(()=>checkGorgiasAccount(data,'https://fixture.gorgias.com')).toThrow('source_changed');
 });
 it('requires explicit end metadata, including an empty terminal boundary',()=>{
  expect(projectGorgiasContacts({...gorgias,data:[],meta:{next_cursor:null}},'NEXT_1==')).toEqual({contacts:[],done:true,sourceCursor:null});
  expect(projectZendeskContacts({...zendesk,users:[],meta:{has_more:false,after_cursor:null}},'NEXT_1==')).toEqual({contacts:[],done:true,sourceCursor:null});
  for(const input of [[customer],{object:'list',data:[customer]},{...gorgias,meta:{}}])expect(()=>projectGorgiasContacts(input,null)).toThrow('source_invalid');
  expect(()=>projectZendeskContacts({...zendesk,meta:{has_more:true,after_cursor:null}},null)).toThrow('source_invalid');
 });
 it('rejects repeated cursors, duplicate IDs, empty nonterminal pages and staff rows',()=>{
  expect(()=>projectGorgiasContacts(gorgias,'NEXT_1==')).toThrow('source_changed');
  expect(()=>projectGorgiasContacts({...gorgias,data:[]},null)).toThrow('source_changed');
  expect(()=>projectGorgiasContacts({...gorgias,data:[customer,customer]},null)).toThrow('source_changed');
  expect(()=>projectZendeskContacts({...zendesk,users:[{...zendesk.users[0],role:'agent'}]},null)).toThrow('source_invalid');
  expect(()=>projectZendeskContacts({...zendesk,meta:{has_more:true,after_cursor:'https://evil.test'}},null)).toThrow('source_invalid');
 });
});
