import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {resolveWorkspaceIdForUser} from '@/lib/workspaces/resolve';
import {csrfGuard} from '@/lib/csrf';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {limitByKey,rateLimitResponse} from '@/lib/rate-limit';
import {readMigrationJson} from '@/lib/migrations/limited-json';
import {ContactMigrationError} from '@/lib/migrations/contact-import';
import {humanHandoffInput} from '@/lib/voice/human-handoff-contract';
import {VoiceHandoffError,readHumanHandoff,requestHumanHandoff,createHumanHandoffGrant,manageHumanHandoff} from '@/lib/voice/human-handoff';
const headers={'Cache-Control':'private, no-store'};
const actions=z.object({action:z.enum(['request','join','renew','end']),input:humanHandoffInput}).strict();
function failure(locale:'es'|'en',error:unknown){
 const code=error instanceof VoiceHandoffError?error.code:error instanceof ContactMigrationError?'invalid':'unavailable';
 return NextResponse.json({error:translate(locale,`voice.handoffError_${code}`),code},{status:{invalid:400,notFound:404,changed:409,readOnly:402,unavailable:503}[code],headers});
}
async function session(request:Request,locale:'es'|'en'){
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return {response:NextResponse.json({error:translate(locale,'errAi.unauthorized')},{status:401,headers})};
 const workspaceId=await resolveWorkspaceIdForUser(client,user.id),expected=request.headers.get('x-workspace-id');
 if(!workspaceId||!z.string().uuid().safeParse(expected).success||expected!==workspaceId)return {response:failure(locale,new VoiceHandoffError('notFound'))};
 return {db:supabaseAdmin(),workspaceId,actorId:user.id};
}
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new VoiceHandoffError('notFound'));
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;const params=new URL(request.url).searchParams,callId=params.get('callId');
  if([...params].some(([key])=>key!=='callId')||params.getAll('callId').length!==1||!z.string().uuid().safeParse(callId).success)throw new VoiceHandoffError('invalid');
  const limit=await limitByKey(`voice-handoff-read:${ctx.workspaceId}:${ctx.actorId}`,{limit:40,windowMs:60000});
  if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  return NextResponse.json(await readHumanHandoff(ctx.db,ctx.workspaceId,ctx.actorId,callId!),{headers});
 }catch(error){return failure(locale,error);}
}
export async function POST(request:Request){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new VoiceHandoffError('notFound'));
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;
  if([...new URL(request.url).searchParams].length)throw new VoiceHandoffError('invalid');
  const limit=await limitByKey(`voice-handoff-write:${ctx.workspaceId}:${ctx.actorId}`,{limit:12,windowMs:60000});
  if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const parsed=actions.safeParse(await readMigrationJson(request,2048));if(!parsed.success)throw new VoiceHandoffError('invalid');const {action,input}=parsed.data;
  const data=action==='request'?await requestHumanHandoff(ctx.db,ctx.workspaceId,ctx.actorId,input):action==='join'?await createHumanHandoffGrant(ctx.db,ctx.workspaceId,ctx.actorId,input):await manageHumanHandoff(ctx.db,ctx.workspaceId,ctx.actorId,input,action);
  return NextResponse.json(data,{headers});
 }catch(error){return failure(locale,error);}
}
