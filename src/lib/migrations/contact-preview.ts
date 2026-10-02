import {parsePhoneNumberFromString} from 'libphonenumber-js';

export const MIGRATION_PROVIDERS = ['kommo', 'leadsales', 'manychat', 'chatwoot', 'gorgias', 'zendesk'] as const;
export type MigrationProvider = typeof MIGRATION_PROVIDERS[number];
export const MIGRATION_FIELDS = ['sourceId', 'phone', 'name', 'email', 'company'] as const;
export type MigrationField = typeof MIGRATION_FIELDS[number];
export type MigrationMapping = Record<MigrationField, number>;
export type MigrationIssue = 'source_id_missing' | 'phone_invalid' | 'email_invalid' | 'source_conflict' | 'phone_conflict' | 'duplicate';
export type MigrationRow = {
  row: number; sourceId: string; phone: string; name: string; email: string; company: string;
  issues: MigrationIssue[];
};
export const MIGRATION_MAX_BYTES = 2 * 1024 * 1024;
export class MigrationPreviewError extends Error {
  constructor(public code: 'size' | 'csv' | 'limits' | 'mapping' | 'source') {super(code);}
}

/** Bounded CSV only. Never resolves links, evaluates cells or contacts a provider. */
export function readMigrationCsv(input: string): {headers: string[]; rows: string[][]} {
  if(new TextEncoder().encode(input).length > MIGRATION_MAX_BYTES) throw new MigrationPreviewError('size');
  const text=input.replace(/^\uFEFF/, '');
  const counts=new Map([[',',0],[';',0],['\t',0]]);
  let quoted=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"') {if(quoted && text[i+1]==='"') i++; else quoted=!quoted;}
    else if(!quoted) {if(char==='\n'||char==='\r') break;if(counts.has(char)) counts.set(char,counts.get(char)!+1);}
  }
  const delimiter=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
  const rows:string[][]=[];let row:string[]=[],cell='',state:'plain'|'quoted'|'closed'='plain';
  const pushCell=()=>{if(cell.length>4096||row.length>=64) throw new MigrationPreviewError('limits');row.push(cell);cell='';state='plain';};
  const pushRow=()=>{pushCell();if(row.some(value=>value.trim()!=='')){if(rows.length>=5001)throw new MigrationPreviewError('limits');rows.push(row);}row=[];};
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(state==='quoted') {
      if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else state='closed';}
      else cell+=char;
    } else if(char===delimiter) pushCell();
    else if(char==='\n'||char==='\r'){pushRow();if(char==='\r'&&text[i+1]==='\n')i++;}
    else if(char==='"'&&state==='plain'&&cell==='') state='quoted';
    else {if(state==='closed'||char==='"')throw new MigrationPreviewError('csv');cell+=char;}
    if(cell.length>4096)throw new MigrationPreviewError('limits');
  }
  if(state==='quoted')throw new MigrationPreviewError('csv');
  if(cell!==''||row.length>0||state==='closed')pushRow();
  if(rows.length<2||rows[0].every(value=>value.trim()===''))throw new MigrationPreviewError('csv');
  const headers=rows[0].map(value=>value.trim());
  if(rows.slice(1).some(value=>value.length!==headers.length))throw new MigrationPreviewError('csv');
  return {headers,rows:rows.slice(1)};
}

export function previewContactMigration(input: {
  provider: MigrationProvider; account: string; headers: string[]; rows: string[][]; mapping: MigrationMapping;
}): {provider: MigrationProvider; account: string; rows: MigrationRow[]; reviewable: number; excluded: number} {
  if(!MIGRATION_PROVIDERS.includes(input.provider)||typeof input.account!=='string'||!input.account.trim()||input.account.trim().length>160)throw new MigrationPreviewError('source');
  if(input.rows.length>5000||input.headers.length>64||input.rows.some(row=>row.length!==input.headers.length||row.some(cell=>typeof cell!=='string'||cell.length>4096)))throw new MigrationPreviewError('limits');
  const columns=MIGRATION_FIELDS.map(field=>input.mapping[field]);
  if(columns.some(index=>!Number.isInteger(index)||index < -1||index>=input.headers.length)||input.mapping.sourceId===-1||input.mapping.phone===-1||new Set(columns.filter(index=>index!==-1)).size!==columns.filter(index=>index!==-1).length)throw new MigrationPreviewError('mapping');
  const rows:MigrationRow[]=input.rows.map((row,index)=>{
    const value=(field:MigrationField)=>input.mapping[field]===-1?'':row[input.mapping[field]].trim();
    const rawPhone=value('phone'),parsed=/^\+[0-9\s().-]+$/.test(rawPhone)?parsePhoneNumberFromString(rawPhone):null;
    const phone=parsed?.isValid()&&!parsed.ext?parsed.number:'',sourceId=value('sourceId'),email=value('email');
    const issues:MigrationIssue[]=[];
    if(!sourceId)issues.push('source_id_missing');
    if(!phone)issues.push('phone_invalid');
    if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))issues.push('email_invalid');
    return {row:index+2,sourceId,phone,name:value('name'),email,company:value('company'),issues};
  });
  const byId=new Map<string,MigrationRow[]>(),byPhone=new Map<string,MigrationRow[]>();
  for(const row of rows) {
    if(row.sourceId){const group=byId.get(row.sourceId)??[];group.push(row);byId.set(row.sourceId,group);}
    if(row.phone){const group=byPhone.get(row.phone)??[];group.push(row);byPhone.set(row.phone,group);}
  }
  const add=(row:MigrationRow,issue:MigrationIssue)=>{if(!row.issues.includes(issue))row.issues.push(issue);};
  const signature=(row:MigrationRow)=>JSON.stringify([row.phone,row.name,row.email,row.company]);
  for(const group of byId.values()) {
    if(group.length<2)continue;
    if(new Set(group.map(signature)).size>1)group.forEach(row=>add(row,'source_conflict'));
    else group.slice(1).forEach(row=>add(row,'duplicate'));
  }
  for(const group of byPhone.values())if(new Set(group.map(row=>row.sourceId)).size>1)group.forEach(row=>add(row,'phone_conflict'));
  const reviewable=rows.filter(row=>row.issues.length===0).length;
  return {provider:input.provider,account:input.account.trim(),rows,reviewable,excluded:rows.length-reviewable};
}
