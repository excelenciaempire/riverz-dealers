import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {resolveWorkspaceIdForUser} from '@/lib/workspaces/resolve';
import {csrfGuard} from '@/lib/csrf';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {limitByKey,rateLimitResponse} from '@/lib/rate-limit';
import {ContactMigrationError} from '@/lib/migrations/contact-import';
import {readMigrationJson} from '@/lib/migrations/limited-json';
import {archiveStart,archiveRead,archiveConfirm} from '@/lib/migrations/archive-contract';
import {startNativeHistoryArchive,readNativeHistoryArchive,confirmNativeHistoryArchive,cancelNativeHistoryArchive,readNativeHistoryMessages,readNativeHistoryFile} from '@/lib/migrations/archive-service';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const actions=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),input:archiveStart}).strict(),z.object({action:z.literal('confirm'),input:archiveConfirm}).strict(),
 z.object({action:z.literal('cancel'),input:archiveRead}).strict(),z.object({action:z.literal('delete'),input:archiveRead}).strict(),
]);
function failure(locale:'es'|'en',error:unknown){const code=error instanceof ContactMigrationError?error.code:'unavailable';
 return NextResponse.json({error:translate(locale,`contacts.migrationServer_${code}`),code},{status:{invalid:400,notFound:404,changed:409,expired:409,readOnly:402,limit:429,unavailable:503}[code],headers});}
async function session(request:Request,locale:'es'|'en'){
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return {response:NextResponse.json({error:translate(locale,'errAi.unauthorized')},{status:401,headers})};
 const workspaceId=await resolveWorkspaceIdForUser(client,user.id),expected=request.headers.get('x-workspace-id');
 if(!workspaceId||!z.string().uuid().safeParse(expected).success||expected!==workspaceId)return {response:failure(locale,new ContactMigrationError('notFound'))};
 return {db:supabaseAdmin(),workspaceId,actorId:user.id};
}
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ContactMigrationError('notFound'));
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;
  const params=new URL(request.url).searchParams,view=params.get('view')??'status',allowed=view==='status'?['id','view']:view==='messages'?['id','view','after']:view==='file'?['id','view','fileId']:[];
  if(allowed.length===0||[...params].some(([key])=>!allowed.includes(key))||allowed.some(key=>params.getAll(key).length>1))throw new ContactMigrationError('invalid');
  const limit=await limitByKey(`migration-history-read:${ctx.workspaceId}:${ctx.actorId}`,{limit:60,windowMs:60000});
  if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const id=params.get('id');
  if(view==='file'){
   const file=await readNativeHistoryFile(ctx.db,ctx.workspaceId,ctx.actorId,{id,fileId:params.get('fileId')});
   return new Response(new Uint8Array(file.buffer),{headers:{...headers,'Content-Type':file.mime,'Content-Disposition':`attachment; filename="archive-${file.fileId}"`,
    'Content-Length':String(file.buffer.length),'Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  if(view==='messages'){const after=params.get('after')??'0';if(!/^\d{1,5}$/.test(after)||Number(after)>10000)throw new ContactMigrationError('invalid');
   return NextResponse.json(await readNativeHistoryMessages(ctx.db,ctx.workspaceId,ctx.actorId,{id,after:Number(after)}),{headers});}
  return NextResponse.json(await readNativeHistoryArchive(ctx.db,ctx.workspaceId,ctx.actorId,{id}),{headers});
 }catch(error){return failure(locale,error);}
}
export async function POST(request:Request){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ContactMigrationError('notFound'));
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;if([...new URL(request.url).searchParams].length)throw new ContactMigrationError('invalid');
  const limit=await limitByKey(`migration-history-write:${ctx.workspaceId}:${ctx.actorId}`,{limit:6,windowMs:60000});
  if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const parsed=actions.safeParse(await readMigrationJson(request,65536));if(!parsed.success)throw new ContactMigrationError('invalid');const value=parsed.data;
  const result=value.action==='start'?await startNativeHistoryArchive(ctx.db,ctx.workspaceId,ctx.actorId,value.input):value.action==='confirm'?await confirmNativeHistoryArchive(ctx.db,ctx.workspaceId,ctx.actorId,value.input):
   await cancelNativeHistoryArchive(ctx.db,ctx.workspaceId,ctx.actorId,value.input,value.action==='delete');return NextResponse.json(result,{headers});
 }catch(error){return failure(locale,error);}
}
