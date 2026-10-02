import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {resolveWorkspaceIdForUser} from '@/lib/workspaces/resolve';
import {csrfGuard} from '@/lib/csrf';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {limitByKey,rateLimitResponse} from '@/lib/rate-limit';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {readMigrationJson} from '@/lib/migrations/limited-json';
import {PortalError,readHelpPortal,readPortalStatistics,manageHelpPortal,type PortalFailure} from '@/lib/help-portal/service';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
type Context={params:Promise<{id:string}>};
const statuses:Record<PortalFailure,number>={portal_invalid:400,portal_not_found:404,portal_changed:409,portal_source_changed:409,portal_read_only:403,portal_limit:429,portal_unavailable:503};
async function failure(error:unknown){const code=error instanceof PortalError?error.code:'portal_unavailable';
 return NextResponse.json({code,error:translate(await getLocale(),`assistant.${code}`)},{status:statuses[code],headers});}
async function session(request:Request,agentId:string){
 if(!z.string().uuid().safeParse(agentId).success)throw new PortalError('portal_invalid');
 const client=await createClient(),{data:{user}}=await client.auth.getUser();if(!user)throw new PortalError('portal_not_found');
 const workspaceId=await resolveWorkspaceIdForUser(client,user.id);
 if(!workspaceId||request.headers.get('x-workspace-id')!==workspaceId)throw new PortalError('portal_not_found');
 return {workspaceId,actorId:user.id,agentId};
}
export async function GET(request:Request,{params}:Context){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(new PortalError('portal_not_found'));
 try{
  if([...new URL(request.url).searchParams].length)throw new PortalError('portal_invalid');
  const ctx=await session(request,(await params).id);
  const rate=await limitByKey(`portal:read:${ctx.workspaceId}:${ctx.actorId}`,{limit:60,windowMs:60000});
  if(!rate.success){const response=rateLimitResponse(rate);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const db=supabaseAdmin(),portal=await readHelpPortal(db,ctx);
  return NextResponse.json({portal,statistics:portal?await readPortalStatistics(db,ctx):null},{headers});
 }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(new PortalError('portal_not_found'));
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 try{
  if([...new URL(request.url).searchParams].length)throw new PortalError('portal_invalid');
  const ctx=await session(request,(await params).id);
  const rate=await limitByKey(`portal:write:${ctx.workspaceId}:${ctx.actorId}`,{limit:20,windowMs:60000});
  if(!rate.success){const response=rateLimitResponse(rate);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  let input:unknown;try{input=await readMigrationJson(request,65536);}catch{throw new PortalError('portal_invalid');}
  return NextResponse.json({portal:await manageHelpPortal(supabaseAdmin(),ctx,input)},{headers});
 }catch(error){return failure(error);}
}
