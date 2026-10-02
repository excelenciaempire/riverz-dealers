import {NextResponse} from 'next/server';
import {z} from 'zod';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {assertVoiceWorkerAuth} from '@/lib/voice/auth';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {observeWhatsAppVoiceCustomer,endWhatsAppVoiceCall} from '@/lib/voice/whatsapp-calling-service';
import {readMigrationJson} from '@/lib/migrations/limited-json';
import {ContactMigrationError} from '@/lib/migrations/contact-import';
const input=z.object({action:z.enum(['observe','end']),callId:z.string().uuid(),room:z.string().max(128),customerIdentity:z.string().max(128)}).strict();
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({error:'not_found'},{status:404,headers});
 try{assertVoiceWorkerAuth(request);}catch(r){if(r instanceof Response){r.headers.set('Cache-Control','no-store');return r;}throw r;}
 try{
  if([...new URL(request.url).searchParams].length)return NextResponse.json({error:'invalid'},{status:400,headers});
  const parsed=input.safeParse(await readMigrationJson(request,1024));if(!parsed.success)return NextResponse.json({error:'invalid'},{status:400,headers});
  const {action,callId,room,customerIdentity}=parsed.data;
  return NextResponse.json(await(action==='observe'?observeWhatsAppVoiceCustomer(supabaseAdmin(),callId,room,customerIdentity):endWhatsAppVoiceCall(supabaseAdmin(),callId,room,customerIdentity)),{headers});
 }catch(error){return NextResponse.json({error:error instanceof ContactMigrationError?'invalid':'whatsapp_voice_unavailable'},{status:error instanceof ContactMigrationError?400:409,headers});}
}
