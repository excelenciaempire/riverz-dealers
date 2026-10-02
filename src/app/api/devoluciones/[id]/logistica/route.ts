import {NextResponse} from 'next/server';
import {inboxSession} from '@/lib/inbox/server-context';
import {csrfGuard} from '@/lib/csrf';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {parseReturnHistoryQuery} from '@/lib/returns/history';
import {returnLogisticsInput} from '@/lib/returns/logistics-contract';
import {readReturnLogistics,recordReturnLogistics,ReturnLogisticsError} from '@/lib/returns/logistics';
type Route={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
async function body(request:Request):Promise<unknown>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new ReturnLogisticsError('invalid');
 const declared=request.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>8192))throw new ReturnLogisticsError('invalid');
 const reader=request.body?.getReader();if(!reader)throw new ReturnLogisticsError('invalid');const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>8192){await reader.cancel();throw new ReturnLogisticsError('invalid');}chunks.push(chunk.value);}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }catch{throw new ReturnLogisticsError('invalid');}finally{reader.releaseLock();}
}
function failed(locale:'es'|'en',error:unknown){
 const code=error instanceof ReturnLogisticsError?error.code:'unavailable';
 const key={invalid:'logisticsInvalid',forbidden:'unauthorized',notFound:'notFound',platformManaged:'platformManaged',changed:'decisionChanged',readOnly:'readOnly',limit:'logisticsLimit',unavailable:'logisticsFailed'}[code];
 const status={invalid:400,forbidden:403,notFound:404,platformManaged:409,changed:409,readOnly:402,limit:409,unavailable:503}[code];
 return NextResponse.json({error:translate(locale,`returns.${key}`)},{status,headers});
}
export const dynamic='force-dynamic';
export async function GET(request:Request,route:Route){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failed(locale,new ReturnLogisticsError('notFound'));
 const ctx=await inboxSession();if(ctx.response){ctx.response.headers.set('Cache-Control',headers['Cache-Control']);return ctx.response;}
 try{
  let cursor:string|undefined;try{cursor=parseReturnHistoryQuery(new URL(request.url).searchParams).cursor;}catch{throw new ReturnLogisticsError('invalid');}
  return NextResponse.json(await readReturnLogistics(ctx.db,ctx.workspaceId,ctx.userId,(await route.params).id,cursor),{headers});
 }catch(error){return failed(locale,error);}
}
export async function POST(request:Request,route:Route){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failed(locale,new ReturnLogisticsError('notFound'));
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 const ctx=await inboxSession();if(ctx.response){ctx.response.headers.set('Cache-Control',headers['Cache-Control']);return ctx.response;}
 try{
  if([...new URL(request.url).searchParams].length)throw new ReturnLogisticsError('invalid');
  const input=returnLogisticsInput.safeParse(await body(request));if(!input.success)throw new ReturnLogisticsError('invalid');
  return NextResponse.json(await recordReturnLogistics(ctx.db,ctx.workspaceId,ctx.userId,(await route.params).id,input.data),{headers});
 }catch(error){return failed(locale,error);}
}
