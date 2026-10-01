import {NextResponse} from 'next/server';
import {assertCronAuth} from '@/lib/auth/cron';
import {withCronRun} from '@/lib/cron/heartbeat';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {browserPushKeys,dispatchBrowserPush} from '@/lib/pwa/push-server';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
async function handler(request:Request){
 try{assertCronAuth(request,'AUTOMATION_CRON_SECRET');}catch(error){if(error instanceof Response)return error;throw error;}
 if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({enabled:false});
 try{return NextResponse.json(await dispatchBrowserPush(supabaseAdmin()));}catch{return NextResponse.json({error:'browser_push_unavailable'},{status:503});}
}
const run=withCronRun('browser-push',handler);
export async function GET(request:Request){
 try{assertCronAuth(request,'AUTOMATION_CRON_SECRET');}catch(error){if(error instanceof Response)return error;throw error;}
 if(!SHOW_RIVERZ_IMPROVEMENTS||!browserPushKeys())return NextResponse.json({enabled:false});
 return run(request);
}
