import {NextResponse} from 'next/server';
import {assertCronAuth} from '@/lib/auth/cron';
import {withCronRun} from '@/lib/cron/heartbeat';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {ingestNativeSmsQueue} from '@/lib/integrations/expansion/sms-worker';
async function handler(){try{return NextResponse.json(await ingestNativeSmsQueue(supabaseAdmin()));}catch{return NextResponse.json({error:'native_sms_worker_unavailable'},{status:503});}}
const run=withCronRun('native-sms',handler);
export async function GET(request:Request){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({error:'not_found'},{status:404,headers:{'Cache-Control':'no-store'}});
 try{assertCronAuth(request,'AUTOMATION_CRON_SECRET');}catch(error){if(error instanceof Response)return error;throw error;}
 return run(request);
}
