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
import {nativeSourceStart} from '@/lib/migrations/native-source-contract';
import {startNativeContactSource,readNativeContactSource,cancelNativeContactSource,prepareNativeContactReview,nativeContactReview} from '@/lib/migrations/native-contact-source';
const headers={'Cache-Control':'private, no-store'};
const actions=z.discriminatedUnion('action',[
  z.object({action:z.literal('start'),input:nativeSourceStart}).strict(),
  z.object({action:z.literal('cancel'),input:z.object({id:z.string().uuid()}).strict()}).strict(),
  z.object({action:z.literal('review'),input:nativeContactReview}).strict(),
]);
function failure(locale:'es'|'en',error:unknown){
  const code=error instanceof ContactMigrationError?error.code:'unavailable';
  return NextResponse.json({error:translate(locale,`contacts.migrationServer_${code}`),code},{status:{invalid:400,notFound:404,changed:409,expired:409,readOnly:402,limit:429,unavailable:503}[code],headers});
}
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
    const ctx=await session(request,locale);if(ctx.response)return ctx.response;const params=new URL(request.url).searchParams,after=params.get('after')??'0';
    if([...params].some(([key])=>!['id','after'].includes(key))||['id','after'].some(key=>params.getAll(key).length>1)||!/^\d{1,4}$/.test(after)||Number(after)>5000)throw new ContactMigrationError('invalid');
    const limit=await limitByKey(`migration-native-read:${ctx.workspaceId}:${ctx.actorId}`,{limit:60,windowMs:60000});
    if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
    return NextResponse.json(await readNativeContactSource(ctx.db,ctx.workspaceId,ctx.actorId,{id:params.get('id'),after:Number(after)}),{headers});
  }catch(error){return failure(locale,error);}
}
export async function POST(request:Request){
  const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ContactMigrationError('notFound'));
  const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
  try{
    const ctx=await session(request,locale);if(ctx.response)return ctx.response;if([...new URL(request.url).searchParams].length)throw new ContactMigrationError('invalid');
    const limit=await limitByKey(`migration-native-write:${ctx.workspaceId}:${ctx.actorId}`,{limit:6,windowMs:60000});
    if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
    const parsed=actions.safeParse(await readMigrationJson(request,65536));if(!parsed.success)throw new ContactMigrationError('invalid');const value=parsed.data;
    const saved=value.action==='start'?await startNativeContactSource(ctx.db,ctx.workspaceId,ctx.actorId,value.input):value.action==='cancel'?await cancelNativeContactSource(ctx.db,ctx.workspaceId,ctx.actorId,value.input):await prepareNativeContactReview(ctx.db,ctx.workspaceId,ctx.actorId,value.input);
    return NextResponse.json(saved,{headers});
  }catch(error){return failure(locale,error);}
}
