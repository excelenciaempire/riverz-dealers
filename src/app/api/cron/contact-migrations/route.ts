import {NextResponse} from 'next/server';
import {assertCronAuth} from '@/lib/auth/cron';
import {withCronRun} from '@/lib/cron/heartbeat';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {syncNativeContactSources} from '@/lib/migrations/native-contact-worker';
import {syncExternalContactSources} from '@/lib/migrations/external-contact-worker';
import {syncNativeHistoryArchives,purgeNativeHistoryStorage} from '@/lib/migrations/archive-worker';
async function handler(){
  if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({error:'not_found'},{status:404});
  try{const db=supabaseAdmin();const results=await Promise.allSettled([syncNativeContactSources(db),syncNativeHistoryArchives(db),syncExternalContactSources(db)]);
    if(results.some(result=>result.status==='rejected'))throw new Error('unavailable');
    const contacts=results[0],history=results[1],external=results[2];if(contacts.status!=='fulfilled'||history.status!=='fulfilled'||external.status!=='fulfilled')throw new Error('unavailable');
    const archiveObjectsCleared=await purgeNativeHistoryStorage(db);return NextResponse.json({...contacts.value,history:history.value,external:external.value,archiveObjectsCleared});}
  catch{return NextResponse.json({error:'native_contact_worker_unavailable'},{status:503});}
}
const run=withCronRun('contact-migrations',handler);
// Off means no auth, heartbeat insert, queue claim or outbound provider IO.
export async function GET(request:Request){
  if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({error:'not_found'},{status:404});
  try{assertCronAuth(request,'AUTOMATION_CRON_SECRET');}catch(error){if(error instanceof Response)return error;throw error;}
  return run(request);
}
