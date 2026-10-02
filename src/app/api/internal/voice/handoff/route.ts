import {NextResponse} from 'next/server';
import {z} from 'zod';
import {assertVoiceWorkerAuth} from '@/lib/voice/auth';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {readMigrationJson} from '@/lib/migrations/limited-json';
import {humanRuntimeRegistration,humanRuntimePoll,humanRuntimeAck,humanRuntimeRelease} from '@/lib/voice/human-handoff-contract';
import {VoiceHandoffError,registerHumanRuntime,pollHumanRuntime,ackHumanRuntime,releaseHumanRuntime} from '@/lib/voice/human-handoff';
const headers={'Cache-Control':'private, no-store'};
const actions=z.discriminatedUnion('action',[
 z.object({action:z.literal('register'),input:humanRuntimeRegistration}).strict(),
 z.object({action:z.literal('poll'),input:humanRuntimePoll}).strict(),
 z.object({action:z.literal('ack'),input:humanRuntimeAck}).strict(),
 z.object({action:z.literal('release'),input:humanRuntimeRelease}).strict(),
]);
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({error:'not_found'},{status:404,headers});
 try{assertVoiceWorkerAuth(request);}catch(error){if(error instanceof Response){error.headers.set('Cache-Control',headers['Cache-Control']);return error;}throw error;}
 if([...new URL(request.url).searchParams].length)return NextResponse.json({error:'invalid'},{status:400,headers});
 let parsed:ReturnType<typeof actions.safeParse>;
 try{parsed=actions.safeParse(await readMigrationJson(request,2048));}catch{return NextResponse.json({error:'invalid'},{status:400,headers});}
 if(!parsed.success)return NextResponse.json({error:'invalid'},{status:400,headers});
 try{
  const db=supabaseAdmin(),value=parsed.data;
  const data=value.action==='register'?{registered:await registerHumanRuntime(db,value.input)}:value.action==='poll'?await pollHumanRuntime(db,value.input):value.action==='release'?{released:await releaseHumanRuntime(db,value.input)}:{acknowledged:await ackHumanRuntime(db,value.input)};
  return NextResponse.json(data,{headers});
 }catch(error){const code=error instanceof VoiceHandoffError?error.code:'unavailable';return NextResponse.json({error:code},{status:{invalid:400,notFound:404,changed:409,readOnly:402,unavailable:503}[code],headers});}
}
