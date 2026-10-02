import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@/lib/security/public-json-request',async original=>({...await original<typeof import('@/lib/security/public-json-request')>(),requestChatwootJson:f.request}));
import {PublicJsonError} from '@/lib/security/public-json-request';
import {readChatwootContactConversations,readChatwootHistoryMessages} from './chatwoot-history-client';
const source={provider:'chatwoot' as const,origin:'https://source.example.test',accountId:7};
const conversation={id:11,inbox_id:3,status:'open',created_at:1790911000,meta:{sender:{id:42},assignee:{access_token:'PRIVATE_TOKEN'}}};
beforeEach(()=>{f.request.mockReset().mockResolvedValue({status:200,data:{payload:[conversation]}});});
describe('Read-only source history broker',()=>{
 it('builds exact contact-scoped reads and the explicit neighbour anchor',async()=>{
  await readChatwootContactConversations(source,'FIXTURE_TOKEN',{contactId:42});expect(f.request.mock.calls[0][0]).toEqual({url:'https://source.example.test/api/v1/accounts/7/contacts/42/conversations',token:'FIXTURE_TOKEN'});
  expect((await readChatwootContactConversations(source,'FIXTURE_TOKEN',{contactId:42,anchorId:11})).initialSample).toBe(false);expect(f.request.mock.calls[1][0].url).toBe('https://source.example.test/api/v1/accounts/7/contacts/42/conversations?conversation_id=11');
 });
 it('uses only before pagination for messages and preserves private/source deletion state',async()=>{
  f.request.mockResolvedValue({status:200,data:{payload:[{id:1,account_id:7,conversation_id:11,inbox_id:3,message_type:1,private:true,created_at:1790911000,content:'Private note'}]}});
  expect(await readChatwootHistoryMessages(source,'FIXTURE_TOKEN',{conversationId:11,inboxId:3,before:2})).toMatchObject({messages:[{kind:'note',private:true,sourceDeleted:false}],nextBefore:1});
  expect(f.request).toHaveBeenCalledExactlyOnceWith({url:'https://source.example.test/api/v1/accounts/7/conversations/11/messages?before=2',token:'FIXTURE_TOKEN'});
 });
 it.each([{contactId:0},{contactId:42,anchorId:1.5},{contactId:42,page:1},{contactId:42,workspace_id:'foreign'}])('refuses forged contact cursors before IO',async value=>{
  await expect(readChatwootContactConversations(source,'FIXTURE_TOKEN',value)).rejects.toThrow('source_invalid');expect(f.request).not.toHaveBeenCalled();
 });
 it.each([{conversationId:0,inboxId:3},{conversationId:11,inboxId:3,before:2147483648},{conversationId:11,inboxId:3,after:2}])('refuses unsupported message cursors before IO',async value=>{
  await expect(readChatwootHistoryMessages(source,'FIXTURE_TOKEN',value)).rejects.toThrow('source_invalid');expect(f.request).not.toHaveBeenCalled();
 });
 it.each([[401,'source_auth'],[403,'source_auth'],[404,'source_changed'],[429,'source_rate_limit'],[500,'source_unavailable']] as const)('redacts HTTP %s without retrying',async(status,code)=>{
  f.request.mockRejectedValue(new PublicJsonError('http_status_failed',true,status));await expect(readChatwootContactConversations(source,'FIXTURE_TOKEN',{contactId:42})).rejects.toThrow(code);expect(f.request).toHaveBeenCalledOnce();
 });
 it('reports an anchor removed from the source instead of pretending the history is finished',async()=>{
  f.request.mockResolvedValue({status:200,data:{payload:[]}});await expect(readChatwootContactConversations(source,'FIXTURE_TOKEN',{contactId:42,anchorId:11})).rejects.toThrow('source_changed');
 });
});
