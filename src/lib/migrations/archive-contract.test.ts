import {describe,expect,it} from 'vitest';
import {archiveStart,archiveMessage,archiveConfirm} from './archive-contract';
const id='11111111-1111-4111-8111-111111111111',receipt='22222222-2222-4222-8222-222222222222';
const start={id,receiptId:receipt,provider:'chatwoot',origin:'https://source.example.test',accountId:7,token:'FIXTURE_TOKEN'};
const message={sourceId:'1',conversationSourceId:'11',inboxSourceId:'3',at:'2026-10-02T06:00:00Z',kind:'incoming',private:false,text:'Literal text',sourceFormat:'text',sourceDeleted:false,attachments:[]};
describe('Private archive boundaries before collection',()=>{
 it('accepts an explicit source receipt and stable hash cursor without actor scope or replacement messages',()=>{
  expect(archiveStart.parse(start).after).toBeNull();expect(archiveStart.parse({...start,after:'a'.repeat(64)}).receiptId).toBe(receipt);
  for(const patch of [{workspace_id:id},{actor_id:id},{rows:[]},{receiptId:id},{after:'1'},{provider:'zendesk'}])expect(archiveStart.safeParse({...start,...patch}).success).toBe(false);
 });
 it('never reclassifies private notes or retains deleted text/attachments',()=>{
  expect(archiveMessage.safeParse(message).success).toBe(true);expect(archiveMessage.safeParse({...message,private:true,kind:'note'}).success).toBe(true);
  for(const patch of [{private:true},{kind:'note'},{sourceDeleted:true},{sourceId:'2147483648'},{sender:{access_token:'SECRET'}},{attachments:[{sourceId:'1',type:'image',referenceUrl:'https://source.example.test/file',bytes:10}]}])expect(archiveMessage.safeParse({...message,...patch}).success).toBe(false);
 });
 it('requires explicit human confirmation of an exact archive revision',()=>{
  expect(archiveConfirm.safeParse({id,revision:'a'.repeat(64),confirmed:true}).success).toBe(true);
  expect(archiveConfirm.safeParse({id,revision:'a'.repeat(64),confirmed:false}).success).toBe(false);expect(archiveConfirm.safeParse({id,revision:'a'.repeat(64),confirmed:true,workspace_id:id}).success).toBe(false);
 });
});
