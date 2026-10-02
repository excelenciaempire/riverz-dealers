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
import {contactMigrationPreparation,contactMigrationConfirmation} from '@/lib/migrations/contact-import-contract';
import {readMigrationJson} from '@/lib/migrations/limited-json';
import {ContactMigrationError,prepareContactMigration,confirmContactMigration,readContactMigration,readContactMigrationResults} from '@/lib/migrations/contact-import';

const headers={'Cache-Control':'private, no-store'};
const actions=z.discriminatedUnion('action',[z.object({action:z.literal('prepare'),input:contactMigrationPreparation}).strict(),z.object({action:z.literal('confirm'),input:contactMigrationConfirmation}).strict()]);
function failure(locale:'es'|'en',error:unknown){
  const code=error instanceof ContactMigrationError?error.code:'unavailable';
  const status={invalid:400,notFound:404,changed:409,expired:409,readOnly:402,limit:429,unavailable:503}[code];
  return NextResponse.json({error:translate(locale,`contacts.migrationServer_${code}`),code},{status,headers});
}
async function session(request:Request,locale:'es'|'en'){
  const client=await createClient(),{data:{user}}=await client.auth.getUser();
  if(!user)return {response:NextResponse.json({error:translate(locale,'errAi.unauthorized')},{status:401,headers})};
  const workspaceId=await resolveWorkspaceIdForUser(client,user.id);
  const expected=request.headers.get('x-workspace-id');
  if(!workspaceId||!z.string().uuid().safeParse(expected).success||expected!==workspaceId)return {response:failure(locale,new ContactMigrationError('notFound'))};
  return {db:supabaseAdmin(),workspaceId,actorId:user.id};
}
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ContactMigrationError('notFound'));
  try{
    const ctx=await session(request,locale);if(ctx.response)return ctx.response;
    const params=new URL(request.url).searchParams;
    if([...params].some(([key])=>!['id','after','results'].includes(key))||['id','after','results'].some(key=>params.getAll(key).length>1))throw new ContactMigrationError('invalid');
    const after=params.get('after')??'0',report=params.get('results');if(!/^\d{1,4}$/.test(after)||report!==null&&report!=='true')throw new ContactMigrationError('invalid');
    const limiter=await limitByKey(`migration-read:${ctx.workspaceId}:${ctx.actorId}`,{limit:120,windowMs:60000});
    if(!limiter.success){const response=rateLimitResponse(limiter);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
    const input={id:params.get('id'),after:Number(after)};
    return NextResponse.json(await (report?readContactMigrationResults:readContactMigration)(ctx.db,ctx.workspaceId,ctx.actorId,input),{headers});
  }catch(error){return failure(locale,error);}
}
export async function POST(request:Request){
  const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ContactMigrationError('notFound'));
  const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
  try{
    const ctx=await session(request,locale);if(ctx.response)return ctx.response;if([...new URL(request.url).searchParams].length)throw new ContactMigrationError('invalid');
    const limiter=await limitByKey(`migration-write:${ctx.workspaceId}:${ctx.actorId}`,{limit:12,windowMs:60000});
    if(!limiter.success){const response=rateLimitResponse(limiter);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
    const parsed=actions.safeParse(await readMigrationJson(request));if(!parsed.success)throw new ContactMigrationError('invalid');
    const value=parsed.data;
    return NextResponse.json(await (value.action==='prepare'?prepareContactMigration:confirmContactMigration)(ctx.db,ctx.workspaceId,ctx.actorId,value.input),{headers});
  }catch(error){return failure(locale,error);}
}
