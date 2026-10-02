import {describe,expect,it,vi} from 'vitest';
import {advanceArchiveCollection,initialArchiveCollection,parseArchiveCollection} from './archive-collection';
import type {ChatwootArchiveConversation,ChatwootHistoryMessage} from './providers/chatwoot-history';
const target={sourceHash:'a'.repeat(64),sourceId:'42',contactId:'22222222-2222-4222-8222-222222222222'};
const conversation=(id:number):ChatwootArchiveConversation=>({sourceId:String(id),contactSourceId:'42',inboxSourceId:'3',state:'open',at:new Date(1790911000000+id*1000).toISOString(),sourceChannel:'Channel::Api'});
const token='a'.repeat(24)+':'+ 'b'.repeat(32)+':'+ 'c'.repeat(32);
function broker(){
 const conversations=vi.fn(async(_contact:number,anchor?:number)=>anchor===undefined?{conversations:[conversation(20),conversation(30),conversation(10)],initialSample:true,previous:null,next:null}:
  {conversations:[anchor>10?conversation(anchor-10):null,conversation(anchor),anchor<30?conversation(anchor+10):null].filter((row):row is ChatwootArchiveConversation=>row!==null),initialSample:false,previous:anchor>10?String(anchor-10):null,next:anchor<30?String(anchor+10):null});
 const messages=vi.fn(async(id:number,_inbox:number,before?:number):Promise<{messages:ChatwootHistoryMessage[];nextBefore:number|null;empty:boolean}>=>before===undefined?{messages:[{sourceId:String(id),conversationSourceId:String(id),inboxSourceId:'3',at:'2026-10-02T00:00:00Z',kind:'note',private:true,text:'Private note',sourceFormat:'text',sourceDeleted:false,attachments:[{sourceId:String(id+100),type:'image',bytes:3,referenceUrl:'https://files.example.test/signed?key=SECRET'}]}],nextBefore:id,empty:false}:{messages:[],nextBefore:null,empty:true});
 return {conversations,messages,sealFile:vi.fn(()=>token)};
}
describe('Resumable observed history collector',()=>{
 it('walks both directions from an activity-sorted sample and reads empty message boundaries',async()=>{
   const io=broker();let state=initialArchiveCollection([target]);
   for(let i=0;i<11;i++)state=await advanceArchiveCollection(state,io);
   expect(state).toMatchObject({phase:'files',targetIndex:1,conversations:[{sourceId:'20'},{sourceId:'10'},{sourceId:'30'}]});
   expect(io.conversations.mock.calls).toEqual([[42],[42,20],[42,10],[42,20],[42,30]]);expect(io.messages).toHaveBeenCalledTimes(6);
   expect(state.messages).toHaveLength(3);expect(state.messages.every(row=>row.kind==='note'&&row.private)).toBe(true);
   expect(JSON.stringify(state)).not.toContain('SECRET');expect(JSON.stringify(state)).not.toContain('referenceUrl');expect(io.sealFile).toHaveBeenCalledTimes(3);
 });
 it('advances empty contacts without pretending message history exists',async()=>{
   const io=broker();io.conversations.mockResolvedValue({conversations:[],initialSample:true,previous:null,next:null});
   expect(await advanceArchiveCollection(initialArchiveCollection([target]),io)).toMatchObject({phase:'files',conversations:[],messages:[],targetIndex:1});expect(io.messages).not.toHaveBeenCalled();
 });
 it('rejects a neighbour cycle',async()=>{
   const io=broker();let state=await advanceArchiveCollection(initialArchiveCollection([target]),io);state=await advanceArchiveCollection(state,io);
   io.conversations.mockResolvedValue({conversations:[conversation(20),conversation(10)],initialSample:false,previous:'20',next:'20'});
   await expect(advanceArchiveCollection(state,io)).rejects.toThrow('source_changed');
 });
 it('rejects a broken reciprocal boundary',async()=>{
   const io=broker();let state=await advanceArchiveCollection(initialArchiveCollection([target]),io);state=await advanceArchiveCollection(state,io);
   io.conversations.mockResolvedValue({conversations:[conversation(10)],initialSample:false,previous:null,next:null});await expect(advanceArchiveCollection(state,io)).rejects.toThrow('source_changed');
 });
 it('refuses a changed anchor instead of silently dropping the source drift',async()=>{
   const io=broker();const state=await advanceArchiveCollection(initialArchiveCollection([target]),io);
   io.conversations.mockResolvedValue({conversations:[{...conversation(20),inboxSourceId:'4'}],initialSample:false,previous:null,next:null});await expect(advanceArchiveCollection(state,io)).rejects.toThrow('source_changed');
 });
 it('requires every initial sample to occur in the observed walk',async()=>{
   const io=broker();let state=await advanceArchiveCollection(initialArchiveCollection([target]),io);
   io.conversations.mockResolvedValue({conversations:[conversation(20)],initialSample:false,previous:null,next:null});state=await advanceArchiveCollection(state,io);
   await expect(advanceArchiveCollection(state,io)).rejects.toThrow('source_changed');
 });
 it('requires message cursor progress and forbids replacing prior source messages',async()=>{
   const io=broker();let state=initialArchiveCollection([target]);for(let i=0;i<6;i++)state=await advanceArchiveCollection(state,io);
   io.messages.mockImplementation(async()=>({messages:[state.messages[0]].map(row=>({...row,attachments:[]})),nextBefore:20,empty:false}));
   await expect(advanceArchiveCollection(state,io)).rejects.toThrow('source_changed');
 });
 it('cannot advance the finished source phase or forge contacts and archive associations',async()=>{
   const io=broker();expect(()=>initialArchiveCollection([target,target])).toThrow('source_invalid');
   expect(()=>parseArchiveCollection({...initialArchiveCollection([target]),conversations:[{...conversation(10),contactSourceId:'43'}]})).toThrow('source_invalid');
   await expect(advanceArchiveCollection({...initialArchiveCollection([target]),phase:'files',targetIndex:1},io)).rejects.toThrow('source_invalid');
 });
});
