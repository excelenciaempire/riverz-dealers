import {describe,expect,it} from 'vitest';
import {projectChatwootContactConversations,projectChatwootHistoryMessages} from './chatwoot-history';
const conversation=(id=11,at=1790911000)=>({id,inbox_id:3,status:'open',created_at:at,channel:'Channel::Email',contact_inbox:{contact_id:42,inbox_id:3,source_id:'NOT_TRANSPORT_PROOF'},
  meta:{sender:{id:42,email:'PRIVATE_EMAIL'},assignee:{access_token:'PRIVATE_TOKEN',pubsub_token:'PRIVATE_TOKEN'}},messages:[{content:'DO_NOT_USE_AS_HISTORY'}]});
const ctx={accountId:7,contactId:42};
const message=(id=1)=>({id,account_id:7,conversation_id:11,inbox_id:3,message_type:1,private:true,created_at:1790911000+id,content:'Private note',content_attributes:{email:{html:'PRIVATE_EXTRA'}},sender:{access_token:'PRIVATE_TOKEN'}});
describe('Observed source history projection',()=>{
 it('labels the initial list as a sample and keeps only source-scoped conversation metadata',()=>{
  const projected=projectChatwootContactConversations({payload:[conversation()]},ctx);expect(projected).toMatchObject({initialSample:true,previous:null,next:null,
    conversations:[{sourceId:'11',contactSourceId:'42',inboxSourceId:'3',state:'open',sourceChannel:'Channel::Email'}]});
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE|DO_NOT_USE|NOT_TRANSPORT|meta|sender|contact_inbox/);
 });
 it('accepts optional account metadata but never a foreign account, sender or inbox association',()=>{
  expect(projectChatwootContactConversations({payload:[{...conversation(),account_id:7}]},ctx).conversations).toHaveLength(1);
  for(const row of [{...conversation(),account_id:8},{...conversation(),meta:{sender:{id:43}}},{...conversation(),contact_inbox:{contact_id:43,inbox_id:3}},{...conversation(),contact_inbox:{contact_id:42,inbox_id:4}}])expect(()=>projectChatwootContactConversations({payload:[row]},ctx)).toThrow('source_changed');
 });
 it('preserves both neighbours instead of guessing from last activity or message previews',()=>{
  expect(projectChatwootContactConversations({payload:[conversation(10,100),conversation(11,200),conversation(12,300)]},{...ctx,anchorId:11})).toMatchObject({initialSample:false,previous:'10',next:'12'});
  expect(projectChatwootContactConversations({payload:[conversation(11,200),conversation(12,300)]},{...ctx,anchorId:11})).toMatchObject({previous:null,next:'12'});
  expect(projectChatwootContactConversations({payload:[conversation(10,100),conversation(11,200)]},{...ctx,anchorId:11})).toMatchObject({previous:'10',next:null});
  expect(projectChatwootContactConversations({payload:[conversation()]},{...ctx,anchorId:11})).toMatchObject({previous:null,next:null});
 });
 it('does not impose creation ordering on the initial activity-sorted sample',()=>{
  expect(projectChatwootContactConversations({payload:[conversation(11,200),conversation(10,100)]},ctx).conversations).toHaveLength(2);
 });
 it.each([{payload:[conversation(),conversation()]},{payload:[]},{payload:[conversation(12)]},{payload:[conversation(11,200),conversation(12,100)]},
  {payload:[conversation(9,50),conversation(10,100),conversation(11,200)]}])('refuses duplicate, missing, impossible or misordered anchors',value=>{
  expect(()=>projectChatwootContactConversations(value,{...ctx,anchorId:11})).toThrow();
 });
 it('rejects responses larger than the actual source limit instead of truncating them',()=>{
  expect(()=>projectChatwootContactConversations({payload:Array.from({length:26},(_,i)=>conversation(i+1))},ctx)).toThrow('source_limit');
  expect(()=>projectChatwootContactConversations({payload:Array.from({length:4},(_,i)=>conversation(i+10))},{...ctx,anchorId:11})).toThrow('source_changed');
 });
 it.each([{accountId:7,contactId:0},{...ctx,workspace_id:'foreign'},{...ctx,anchorId:1.5}])('validates context before accepting remote data',value=>{expect(()=>projectChatwootContactConversations({payload:[conversation()]},value)).toThrow('source_invalid');});
 it('keeps private notes and text literal, but destroys deleted text and attachment references',()=>{
  const deleted={...message(2),content:'PRIVATE_OLD_DELETED',content_attributes:{deleted:true},attachments:[{id:1,data_url:'https://source.example.test/file?token=PRIVATE_TOKEN'}]};
  const projected=projectChatwootHistoryMessages({payload:[message(),deleted]},{accountId:7,conversationId:11,inboxId:3});
  expect(projected.messages[0]).toMatchObject({kind:'note',private:true,sourceDeleted:false,text:'Private note'});expect(projected.messages[1]).toMatchObject({sourceDeleted:true,text:'',attachments:[]});
  expect(JSON.stringify(projected)).not.toMatch(/PRIVATE_TOKEN|PRIVATE_EXTRA|PRIVATE_OLD_DELETED/);
 });
 it('does not treat malformed deletion markers as false or suppress foreign message scope',()=>{
  expect(()=>projectChatwootHistoryMessages({payload:[{...message(),content_attributes:{deleted:'true'}}]},{accountId:7,conversationId:11,inboxId:3})).toThrow('source_invalid');
  expect(()=>projectChatwootHistoryMessages({payload:[{...message(),account_id:8,content_attributes:{deleted:true}}]},{accountId:7,conversationId:11,inboxId:3})).toThrow('source_changed');
 });
});
