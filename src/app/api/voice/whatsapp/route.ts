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
import {whatsappCallingSettingsInput,whatsappPeer} from '@/lib/voice/whatsapp-calling-contract';
import {WhatsAppVoiceError} from '@/lib/voice/whatsapp-connector';
import {readWhatsAppVoiceSettings,saveWhatsAppVoiceSettings,readWhatsAppVoiceReceipt,initiateWhatsAppVoiceCall} from '@/lib/voice/whatsapp-calling-service';
const headers={'Cache-Control':'private, no-store'};
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('settings'),input:whatsappCallingSettingsInput}).strict(),
 z.object({action:z.literal('call'),contactId:z.string().uuid(),attemptId:z.string().uuid(),expectedPeer:whatsappPeer,confirmed:z.literal(true)}).strict(),
]);
function failure(locale:'es'|'en',error:unknown){
 const code=error instanceof WhatsAppVoiceError?error.code:error instanceof ContactMigrationError?'invalid':'unavailable';
 return NextResponse.json({error:translate(locale,`voice.whatsappError_${code}`),code},{status:{invalid:400,notAllowed:403,unavailable:503,uncertain:409}[code],headers});
}
const hidden=()=>NextResponse.json({error:'not_found'},{status:404,headers});
async function session(request:Request,locale:'es'|'en'){
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return {response:NextResponse.json({error:translate(locale,'errAi.unauthorized')},{status:401,headers})};
 const workspaceId=await resolveWorkspaceIdForUser(client,user.id),expected=request.headers.get('x-workspace-id');
 if(!workspaceId||!z.string().uuid().safeParse(expected).success||expected!==workspaceId)return {response:failure(locale,new WhatsAppVoiceError('notAllowed'))};
 return {db:supabaseAdmin(),workspaceId,actorId:user.id};
}
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return hidden();const locale=await getLocale();
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;
  const params=new URL(request.url).searchParams,callId=params.get('callId');
  if([...params].some(([key])=>key!=='callId')||params.getAll('callId').length>1||(callId!==null&&!z.string().uuid().safeParse(callId).success))throw new WhatsAppVoiceError('invalid');
  const limit=await limitByKey(`voice-whatsapp-read:${ctx.workspaceId}:${ctx.actorId}`,{limit:40,windowMs:60000});
  if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const data=callId===null?await readWhatsAppVoiceSettings(ctx.db,ctx.workspaceId,ctx.actorId):await readWhatsAppVoiceReceipt(ctx.db,ctx.workspaceId,ctx.actorId,callId);
  return data===null?NextResponse.json({error:'not_found',code:'attemptNotFound'},{status:404,headers}):NextResponse.json(data,{headers});
 }catch(error){return failure(locale,error);}
}
export async function POST(request:Request){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return hidden();const locale=await getLocale();
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;
  if([...new URL(request.url).searchParams].length)throw new WhatsAppVoiceError('invalid');
  const limit=await limitByKey(`voice-whatsapp-write:${ctx.workspaceId}:${ctx.actorId}`,{limit:6,windowMs:60000});
  if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const parsed=input.safeParse(await readMigrationJson(request,2048));if(!parsed.success)throw new WhatsAppVoiceError('invalid');const body=parsed.data;
  const data=body.action==='settings'?await saveWhatsAppVoiceSettings(ctx.db,ctx.workspaceId,ctx.actorId,body.input):await initiateWhatsAppVoiceCall(ctx.db,ctx.workspaceId,ctx.actorId,body.contactId,body.attemptId,body.expectedPeer);
  return NextResponse.json(data,{headers});
 }catch(error){return failure(locale,error);}
}
