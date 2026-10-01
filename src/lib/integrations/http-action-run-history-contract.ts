import {z} from 'zod';
const uuid=z.string().uuid();
const timestamp=z.string().datetime({offset:true});
export const httpRunCursor=z.object({created_at:timestamp,id:uuid}).strict();
const errors=['http_destination_forbidden','http_input_invalid','http_timeout','http_transport_failed','http_response_invalid','http_response_too_large','http_status_failed','http_output_invalid','http_action_credential_unavailable','http_execution_unavailable'] as const;
export const httpRunHistory=z.object({
 runs:z.array(z.object({id:uuid,action_revision:z.number().int().positive(),state:z.enum(['claimed','acknowledged','blocked','uncertain']),
  status_code:z.number().int().min(100).max(599).nullable(),error_code:z.enum(errors).nullable(),created_at:timestamp,finished_at:timestamp.nullable()}).strict()).max(20),
 next_cursor:httpRunCursor.nullable(),observed_at:timestamp,
}).strict();
export type HttpRunHistory=z.infer<typeof httpRunHistory>;
export function httpRunHistoryCsv(locale:'es'|'en',runs:HttpRunHistory['runs']) {
 const headers=locale==='es'?['Comprobante','Versión','Estado registrado','Código HTTP','Error','Creado','Finalizado']:['Receipt','Version','Recorded state','HTTP code','Error','Created','Finished'];
 const cell=(value:string|number|null)=>'"'+String(value??'').replaceAll('"','""')+'"';
 return '\uFEFF'+[headers,...runs.map(row=>[row.id,row.action_revision,row.state,row.status_code,row.error_code,row.created_at,row.finished_at])].map(row=>row.map(cell).join(',')).join('\r\n');
}
