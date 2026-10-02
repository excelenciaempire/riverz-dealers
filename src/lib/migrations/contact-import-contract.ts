import {z} from 'zod';
import {MIGRATION_MAX_BYTES,MIGRATION_PROVIDERS} from './contact-preview';

const column=z.number().int().min(-1).max(63);
const label=z.string().trim().min(1).max(160).refine(value=>!/[\u0000-\u001f\u007f]/.test(value));
export const contactMigrationPreparation=z.object({
  id:z.string().uuid(),provider:z.enum(MIGRATION_PROVIDERS),account:label,
  csv:z.string().max(MIGRATION_MAX_BYTES),
  mapping:z.object({sourceId:column,phone:column,name:column,email:column,company:column}).strict(),
}).strict();
export const contactMigrationConfirmation=z.object({
  id:z.string().uuid(),revision:z.string().regex(/^[0-9a-f]{64}$/),confirmed:z.literal(true),
}).strict();
export const contactMigrationRead=z.object({
  id:z.string().uuid(),after:z.number().int().min(0).max(5001).default(0),
}).strict();
const issue=z.enum(['source_id_missing','phone_invalid','email_invalid','source_conflict','phone_conflict','duplicate','source_changed','existing_contact']);
export const contactMigrationSnapshot=z.object({
  id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),
  provider:z.enum(MIGRATION_PROVIDERS),account:label,revision:z.string().regex(/^[0-9a-f]{64}$/),
  state:z.enum(['prepared','completed','expired']),prepared_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),
  completed_at:z.string().datetime({offset:true}).nullable(),
  counts:z.object({total:z.number().int().min(0).max(5000),new:z.number().int().min(0).max(5000),existing:z.number().int().min(0).max(5000),excluded:z.number().int().min(0).max(5000),created:z.number().int().min(0).max(5000)}).strict(),
  rows:z.array(z.object({row:z.number().int().min(2).max(5001),sourceId:z.string().max(4096),phone:z.string().max(32),name:z.string().max(4096),email:z.string().max(4096),company:z.string().max(4096),
    state:z.enum(['new','existing','excluded','created']),issues:z.array(issue).max(8),contact_id:z.string().uuid().nullable(),
  }).strict()).max(25),
  next:z.number().int().min(2).max(5001).nullable(),
}).strict().superRefine((value,ctx)=>{
  const counts=value.counts;
  if(counts.total<1||counts.new+counts.existing+counts.excluded!==counts.total||counts.created>counts.new||
    Date.parse(value.expires_at)<=Date.parse(value.prepared_at)||
    value.state==='prepared'&&(counts.created!==0||value.completed_at!==null)||
    value.state==='completed'&&(counts.created!==counts.new||value.completed_at===null)||
    value.state==='completed'&&(value.rows.length!==0||value.next!==null)||
    value.state==='expired'&&(value.rows.length!==0||value.next!==null||counts.created!==0||value.completed_at!==null))ctx.addIssue({code:'custom',message:'migration_snapshot_invalid'});
  const ordinal=value.rows.map(row=>row.row);
  if(value.rows.length>counts.total||new Set(ordinal).size!==ordinal.length||ordinal.some((row,index)=>row>counts.total+1||index>0&&row!==ordinal[index-1]+1)||
    value.next!==null&&(ordinal.length===0||value.next!==ordinal.at(-1)||value.next>=counts.total+1)||
    value.rows.some(row=>value.state==='prepared'&&row.state==='created'||row.state==='new'&&(row.issues.length!==0||row.contact_id!==null)||
      row.state==='created'&&(row.issues.length!==0||row.contact_id===null)||
      row.state==='existing'&&(row.contact_id!==null||!row.issues.includes('existing_contact'))||
      row.state==='excluded'&&(row.issues.length===0||row.contact_id!==null)||
      (row.state==='new'||row.state==='created')&&(!row.sourceId.trim()||!/^\+[1-9][0-9]{5,14}$/.test(row.phone))||
      new Set(row.issues).size!==row.issues.length))ctx.addIssue({code:'custom',message:'migration_rows_invalid'});
});
export type ContactMigrationPreparation=z.infer<typeof contactMigrationPreparation>;
export type ContactMigrationSnapshot=z.infer<typeof contactMigrationSnapshot>;
export const contactMigrationResults=z.object({id:z.string().uuid(),workspace_id:z.string().uuid(),actor_id:z.string().uuid(),revision:z.string().regex(/^[0-9a-f]{64}$/),total:z.number().int().min(1).max(5000),
  rows:z.array(z.object({row:z.number().int().min(2).max(5001),sourceId:z.string().max(4096),state:z.enum(['created','existing','excluded']),issues:z.array(issue).max(8),contact_id:z.string().uuid().nullable()}).strict()).max(25),
  next:z.number().int().min(2).max(5001).nullable(),
}).strict().superRefine((value,ctx)=>{
  if(value.rows.some((row,index)=>row.row>value.total+1||index>0&&row.row!==value.rows[index-1].row+1||
    row.state==='created'&&(!row.contact_id||row.issues.length>0||!row.sourceId.trim())||
    row.state!=='created'&&(row.contact_id!==null||row.issues.length===0)||new Set(row.issues).size!==row.issues.length)||
    value.next!==null&&(value.rows.length===0||value.next!==value.rows.at(-1)?.row||value.next>=value.total+1))ctx.addIssue({code:'custom',message:'migration_results_invalid'});
});
export type ContactMigrationResults=z.infer<typeof contactMigrationResults>;
