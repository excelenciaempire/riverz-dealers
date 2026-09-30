import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { maintainBillingNotifications } from '@/lib/billing/notifications';
import { recoverBillingReplies } from '@/lib/billing/recovery';
async function handler(request:Request) {
 try {assertCronAuth(request,'AUTOMATION_CRON_SECRET');}
 catch(response) {if(response instanceof Response)return response;throw response;}
 const db=supabaseAdmin();
 const results=await Promise.allSettled([maintainBillingNotifications(db),recoverBillingReplies(db)]);
 const failures=results.flatMap(result=>result.status==='rejected'?['billing_job_unavailable']:result.value.failures);
 return NextResponse.json({ok:!failures.length,notifications:results[0].status==='fulfilled'?results[0].value:null,recovery:results[1].status==='fulfilled'?results[1].value:null,failures},{status:failures.length?207:200});
}
export const GET=withCronRun('billing-recovery',handler);
export const POST=GET;
