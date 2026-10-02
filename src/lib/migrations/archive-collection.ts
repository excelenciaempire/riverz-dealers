import {z} from 'zod';
import {archiveTarget,archiveConversation,archiveMessage,archiveSourceId,archiveMessageId,archiveStoredFile,
  ARCHIVE_MAX_CONTACTS,ARCHIVE_MAX_CONVERSATIONS,ARCHIVE_MAX_MESSAGES,ARCHIVE_MAX_FILES,ARCHIVE_MAX_DATA_BYTES,ARCHIVE_MAX_STORAGE_BYTES} from './archive-contract';
import {ChatwootMigrationError} from './providers/chatwoot';
import type {ChatwootHistoryMessage} from './providers/chatwoot-history';
export const archiveCollection=z.object({
  targets:z.array(archiveTarget).min(1).max(ARCHIVE_MAX_CONTACTS),targetIndex:z.number().int().min(0).max(ARCHIVE_MAX_CONTACTS),
  phase:z.enum(['initial','older','newer','messages','files','done']),seed:archiveSourceId.nullable(),anchor:archiveSourceId.nullable(),
  neighbour:archiveSourceId.nullable(),sample:z.array(archiveSourceId).max(25),conversationIndex:z.number().int().min(0).max(ARCHIVE_MAX_CONVERSATIONS),
  before:archiveMessageId.nullable(),conversations:z.array(archiveConversation).max(ARCHIVE_MAX_CONVERSATIONS),messages:z.array(archiveMessage).max(ARCHIVE_MAX_MESSAGES),storedFiles:z.array(archiveStoredFile).max(ARCHIVE_MAX_FILES),
}).strict().superRefine((value,ctx)=>{
  const targets=new Set(value.targets.map(row=>row.sourceId)),conversations=new Map(value.conversations.map(row=>[row.sourceId,row]));
  if(targets.size!==value.targets.length||new Set(value.targets.map(row=>row.sourceHash)).size!==value.targets.length||
    new Set(value.targets.map(row=>row.contactId)).size!==value.targets.length||conversations.size!==value.conversations.length||
    value.conversations.some(row=>!targets.has(row.contactSourceId))||new Set(value.messages.map(row=>row.sourceId)).size!==value.messages.length||
    value.messages.some(row=>conversations.get(row.conversationSourceId)?.inboxSourceId!==row.inboxSourceId)||
    new Set(value.messages.flatMap(row=>row.attachments.map(file=>file.sourceId))).size!==value.messages.reduce((n,row)=>n+row.attachments.length,0)||
    value.messages.reduce((n,row)=>n+row.attachments.length,0)>ARCHIVE_MAX_FILES||value.targetIndex>value.targets.length||value.conversationIndex>value.conversations.length||
    (['files','done'].includes(value.phase)?value.targetIndex!==value.targets.length:value.targetIndex>=value.targets.length)||
    (['older','newer'].includes(value.phase)&&(!value.seed||!value.anchor))||
    (value.phase==='messages'&&(!value.conversations[value.conversationIndex]||value.conversations[value.conversationIndex].contactSourceId!==value.targets[value.targetIndex]?.sourceId))||
    value.storedFiles.reduce((sum,file)=>sum+file.bytes,0)>ARCHIVE_MAX_STORAGE_BYTES||new Set(value.storedFiles.map(file=>file.fileId)).size!==value.storedFiles.length||
    value.storedFiles.some(file=>!value.messages.some(row=>row.sourceId===file.messageId&&row.attachments.some(attachment=>attachment.sourceId===file.fileId&&attachment.referenceCiphertext===null)))||
    value.messages.some(row=>row.attachments.some(file=>file.referenceCiphertext===null&&!value.storedFiles.some(stored=>stored.fileId===file.sourceId&&stored.messageId===row.sourceId)))||
    (value.phase==='done'&&value.messages.some(row=>row.attachments.some(file=>file.referenceCiphertext!==null)))||
    value.sample.some(id=>!archiveSourceId.safeParse(id).success))ctx.addIssue({code:'custom',message:'archive_collection_invalid'});
});
export type ArchiveCollection=z.infer<typeof archiveCollection>;
export function parseArchiveCollection(value:unknown):ArchiveCollection{
  const parsed=archiveCollection.safeParse(value);if(!parsed.success)throw new ChatwootMigrationError('source_invalid');
  if(new TextEncoder().encode(JSON.stringify(parsed.data)).length>ARCHIVE_MAX_DATA_BYTES)throw new ChatwootMigrationError('source_limit');return parsed.data;
}
export function initialArchiveCollection(targets:unknown):ArchiveCollection{
  return parseArchiveCollection({targets,targetIndex:0,phase:'initial',seed:null,anchor:null,neighbour:null,sample:[],conversationIndex:0,before:null,conversations:[],messages:[],storedFiles:[]});
}
type ConversationsPage={conversations:z.infer<typeof archiveConversation>[];initialSample:boolean;previous:string|null;next:string|null};
type MessagesPage={messages:ChatwootHistoryMessage[];nextBefore:number|null;empty:boolean};
type Broker={conversations:(contactId:number,anchorId?:number)=>Promise<ConversationsPage>;messages:(conversationId:number,inboxId:number,before?:number)=>Promise<MessagesPage>;
  sealFile:(messageId:string,fileId:string,url:string)=>string};
/** One source GET per step, persisted by the lease holder. No transport,
 * storage, contacts, events, AI, customer sends or hidden truncation here. */
export async function advanceArchiveCollection(input:unknown,broker:Broker):Promise<ArchiveCollection>{
  const state=parseArchiveCollection(input);
  if(state.phase==='files'||state.phase==='done')throw new ChatwootMigrationError('source_invalid');
  const contact=state.targets[state.targetIndex];
  const beginMessages=()=>{
    if(state.sample.some(id=>!state.conversations.some(row=>row.sourceId===id&&row.contactSourceId===contact.sourceId)))throw new ChatwootMigrationError('source_changed');
    const index=state.conversations.findIndex(row=>row.contactSourceId===contact.sourceId);
    state.seed=null;state.anchor=null;state.neighbour=null;state.sample=[];state.before=null;
    if(index===-1){state.targetIndex++;state.phase=state.targetIndex===state.targets.length?'files':'initial';state.conversationIndex=state.conversations.length;}
    else{state.phase='messages';state.conversationIndex=index;}
  };
  const append=(row:z.infer<typeof archiveConversation>)=>{
    if(row.contactSourceId!==contact.sourceId||state.conversations.some(existing=>existing.sourceId===row.sourceId))throw new ChatwootMigrationError('source_changed');
    if(state.conversations.length>=ARCHIVE_MAX_CONVERSATIONS)throw new ChatwootMigrationError('source_limit');state.conversations.push(row);
  };
  if(state.phase==='initial'){
    const page=await broker.conversations(Number(contact.sourceId));
    if(!page.initialSample||page.previous!==null||page.next!==null)throw new ChatwootMigrationError('source_changed');
    state.sample=page.conversations.map(row=>row.sourceId);
    if(page.conversations.length===0)beginMessages();
    else{append(page.conversations[0]);state.seed=page.conversations[0].sourceId;state.anchor=state.seed;state.phase='older';}
  }else if(state.phase==='older'||state.phase==='newer'){
    const direction=state.phase,anchor=state.anchor!,page=await broker.conversations(Number(contact.sourceId),Number(anchor));
    const row=page.conversations.find(row=>row.sourceId===anchor),stored=state.conversations.find(row=>row.sourceId===anchor);
    if(page.initialSample||!row||!stored||JSON.stringify(row)!==JSON.stringify(stored)||
      state.neighbour!==null&&(direction==='older'?page.next:page.previous)!==state.neighbour)throw new ChatwootMigrationError('source_changed');
    const next=direction==='older'?page.previous:page.next;
    if(next!==null){const candidate=page.conversations.find(row=>row.sourceId===next);if(!candidate)throw new ChatwootMigrationError('source_changed');append(candidate);state.neighbour=anchor;state.anchor=next;}
    else if(direction==='older'){state.phase='newer';state.anchor=state.seed;state.neighbour=null;}
    else beginMessages();
  }else{
    const conversation=state.conversations[state.conversationIndex];
    const page=await broker.messages(Number(conversation.sourceId),Number(conversation.inboxSourceId),state.before===null?undefined:Number(state.before));
    if(page.empty!== (page.messages.length===0)||page.nextBefore!== (page.messages.length===0?null:Number(page.messages[0].sourceId)))throw new ChatwootMigrationError('source_changed');
    if(page.empty){
      state.before=null;state.conversationIndex++;
      if(state.conversations[state.conversationIndex]?.contactSourceId!==contact.sourceId){state.targetIndex++;state.phase=state.targetIndex===state.targets.length?'files':'initial';}
    }else{
      if(state.messages.length+page.messages.length>ARCHIVE_MAX_MESSAGES||state.messages.reduce((n,row)=>n+row.attachments.length,0)+page.messages.reduce((n,row)=>n+row.attachments.length,0)>ARCHIVE_MAX_FILES)throw new ChatwootMigrationError('source_limit');
      for(const row of page.messages){
        if(row.conversationSourceId!==conversation.sourceId||row.inboxSourceId!==conversation.inboxSourceId||state.messages.some(existing=>existing.sourceId===row.sourceId)||
          state.before!==null&&Number(row.sourceId)>=Number(state.before))throw new ChatwootMigrationError('source_changed');
        state.messages.push({...row,attachments:row.attachments.map(file=>({sourceId:file.sourceId,type:file.type,bytes:file.bytes,referenceCiphertext:broker.sealFile(row.sourceId,file.sourceId,file.referenceUrl)}))});
      }
      state.before=String(page.nextBefore);
    }
  }
  return parseArchiveCollection(state);
}
