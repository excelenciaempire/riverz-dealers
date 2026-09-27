import {NextResponse} from 'next/server';
import {assertCronAuth} from '@/lib/auth/cron';
import {withCronRun} from '@/lib/cron/heartbeat';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {syncAutomationTemplates} from '@/lib/automations/template-status-sync';

export const dynamic='force-dynamic';
async function handler(request:Request){
  try{assertCronAuth(request,'AUTOMATION_CRON_SECRET');}catch(e){if(e instanceof Response)return e;throw e;}
  const db=supabaseAdmin();const ids=new Set<string>();
  for(let offset=0;;offset+=500){
    const rows=await db.from('automations').select('id,workspace_id').eq('trigger_config->>session_template_fallback','true')
      .in('activation_state',['active','armed']).is('deleted_at',null).order('id').range(offset,offset+499);
    if(rows.error)throw rows.error;for(const r of rows.data??[])ids.add(r.workspace_id);
    if((rows.data?.length??0)<500)break;
  }
  const results=[];for(const workspace of ids){
    try{results.push({workspace,changed:await syncAutomationTemplates(db,workspace)});}
    catch(e){results.push({workspace,error:e instanceof Error?e.message:String(e)});}
  }
  return NextResponse.json({results},{status:results.some(r=>'error'in r)?207:200});
}
export const GET=withCronRun('automation-templates',handler);
