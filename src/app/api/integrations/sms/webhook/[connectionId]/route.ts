import {NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {createNativeSmsService} from '@/lib/integrations/expansion/sms-service';
import {ExpansionProviderError} from '@/lib/integrations/expansion/provider-http';
import {limitByKey,rateLimitResponse} from '@/lib/rate-limit';
import {z} from 'zod';
const headers={'Cache-Control':'no-store'};
export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{connectionId:string}>}){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return NextResponse.json({error:'not_found'},{status:404,headers});
 const {connectionId}=await params;
 if(!z.string().uuid().safeParse(connectionId).success)return NextResponse.json({error:'invalid_event'},{status:400,headers});
 const limit=await limitByKey(`sms-webhook:${connectionId}`,{limit:600,windowMs:60000});if(!limit.success){const response=rateLimitResponse(limit);response.headers.set('Cache-Control','no-store');return response;}
 try{
  // Read bounded original bytes; decoding and parsing happen after Ed25519
  // verification. No query key or UUID alone constitutes authorization.
  if([...new URL(request.url).searchParams].length||!request.body)throw new ExpansionProviderError('invalid');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>128*1024)throw new ExpansionProviderError('invalid');chunks.push(chunk.value);}}catch(error){await reader.cancel().catch(()=>undefined);throw error;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const data=await createNativeSmsService(supabaseAdmin()).webhook(connectionId,bytes,request.headers.get('telnyx-signature-ed25519'),request.headers.get('telnyx-timestamp'));
  // ACK only after durable persistence. A database failure returns a retryable
  // status; provider redelivery deduplicates the immutable event ID.
  return NextResponse.json(data,{headers});
 }catch(error){const invalid=error instanceof ExpansionProviderError&&['invalid','notAllowed'].includes(error.code);return NextResponse.json({error:invalid?'invalid_event':'temporarily_unavailable'},{status:invalid?400:503,headers});}
}
