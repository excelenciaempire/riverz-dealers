import {z} from 'zod';
import {nativeSourceStart,nativeSourceDefinition,nativeSourceErrors} from './native-source-contract';
export const ARCHIVE_MAX_CONTACTS=100,ARCHIVE_MAX_CONVERSATIONS=500,ARCHIVE_MAX_MESSAGES=10000,ARCHIVE_MAX_FILES=100;
export const ARCHIVE_MAX_FILE_BYTES=8*1024*1024,ARCHIVE_MAX_DATA_BYTES=16*1024*1024,ARCHIVE_MAX_STORAGE_BYTES=50*1024*1024;
export const archiveSourceId=z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value=>Number(value)<=Number.MAX_SAFE_INTEGER);
export const archiveMessageId=archiveSourceId.refine(value=>Number(value)<=2147483647);
export const archiveStart=nativeSourceStart.extend({receiptId:z.string().uuid(),after:z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null)}).strict()
  .refine(value=>value.id!==value.receiptId);
export const archiveTarget=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),sourceId:archiveSourceId,contactId:z.string().uuid()}).strict();
export const archiveConversation=z.object({sourceId:archiveSourceId,contactSourceId:archiveSourceId,inboxSourceId:archiveSourceId,
  state:z.enum(['open','resolved','pending','snoozed']),at:z.string().datetime({offset:true}),sourceChannel:z.string().max(128).nullable()}).strict();
export const archiveFile=z.object({sourceId:archiveSourceId,type:z.string().max(64),bytes:z.number().int().min(0).max(ARCHIVE_MAX_FILE_BYTES).nullable(),
  referenceCiphertext:z.string().max(20000).regex(/^[0-9a-f]{24}:[0-9a-f]+:[0-9a-f]{32}$/).nullable()}).strict();
export const archiveStoredFile=z.object({messageId:archiveMessageId,fileId:archiveSourceId,path:z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[1-9][0-9]{0,15}$/),
  mime:z.string().min(1).max(160),bytes:z.number().int().min(0).max(ARCHIVE_MAX_FILE_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const archiveMessage=z.object({sourceId:archiveMessageId,conversationSourceId:archiveSourceId,inboxSourceId:archiveSourceId,at:z.string().datetime({offset:true}),
  kind:z.enum(['incoming','outgoing','activity','template','note']),private:z.boolean(),text:z.string().max(150000),sourceFormat:z.string().max(64).nullable(),sourceDeleted:z.boolean(),
  attachments:z.array(archiveFile).max(15)}).strict().superRefine((value,ctx)=>{
  if(value.private!== (value.kind==='note')||value.sourceDeleted&&(value.text!==''||value.attachments.length>0)||
    new Set(value.attachments.map(file=>file.sourceId)).size!==value.attachments.length)ctx.addIssue({code:'custom',message:'archive_message_invalid'});
});
export const archiveRead=z.object({id:z.string().uuid()}).strict();
export const archiveMessagesRead=archiveRead.extend({after:z.number().int().min(0).max(10000).default(0)}).strict();
export const archiveFileRead=archiveRead.extend({fileId:archiveSourceId}).strict();
export const archiveConfirm=z.object({id:z.string().uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
export const archiveSnapshot=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),receipt_id:z.string().uuid(),source:nativeSourceDefinition,
  state:z.enum(['queued','fetching','ready','empty','confirmed','failed','cancelled','expired']),created_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),
  confirmed_at:z.string().datetime({offset:true}).nullable(),revision:z.string().regex(/^[a-f0-9]{64}$/).nullable(),error:z.enum(nativeSourceErrors).nullable(),
  targets:z.number().int().min(0).max(ARCHIVE_MAX_CONTACTS),contacts_collected:z.number().int().min(0).max(ARCHIVE_MAX_CONTACTS),conversations:z.number().int().min(0).max(ARCHIVE_MAX_CONVERSATIONS),
  messages:z.number().int().min(0).max(ARCHIVE_MAX_MESSAGES),files:z.number().int().min(0).max(ARCHIVE_MAX_FILES),next:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict().superRefine((value,ctx)=>{
  if(value.contacts_collected>value.targets||value.state==='ready'&&(value.contacts_collected!==value.targets||!value.revision)||
    value.state==='confirmed'&&(!value.confirmed_at||!value.revision)||value.state!=='confirmed'&&value.confirmed_at!==null||
    value.state==='empty'&&(value.conversations>0||value.messages>0||value.files>0)||Date.parse(value.expires_at)<=Date.parse(value.created_at))ctx.addIssue({code:'custom',message:'archive_snapshot_invalid'});
});
export type ArchiveStart=z.infer<typeof archiveStart>;
export type ArchiveTarget=z.infer<typeof archiveTarget>;
export type ArchiveConversation=z.infer<typeof archiveConversation>;
export type ArchiveMessage=z.infer<typeof archiveMessage>;
export type ArchiveSnapshot=z.infer<typeof archiveSnapshot>;
export const archiveMessagesPage=z.object({id:z.string().uuid(),revision:z.string().regex(/^[a-f0-9]{64}$/),total:z.number().int().min(0).max(ARCHIVE_MAX_MESSAGES),
 rows:z.array(z.object({contactId:z.string().uuid(),contactSourceId:archiveSourceId,conversation:archiveConversation,
  message:z.object(archiveMessage.shape).omit({attachments:true}).strict(),files:z.array(z.object({fileId:archiveSourceId,type:z.string().max(64),mime:z.string().min(1).max(160),bytes:z.number().int().min(0).max(ARCHIVE_MAX_FILE_BYTES)}).strict()).max(15)}).strict()).max(20),
 next:z.number().int().min(1).max(10000).nullable()}).strict();
export type ArchiveMessagesPage=z.infer<typeof archiveMessagesPage>;
