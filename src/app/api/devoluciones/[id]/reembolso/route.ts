import {NextResponse} from 'next/server';
import {inboxSession} from '@/lib/inbox/server-context';
import {csrfGuard} from '@/lib/csrf';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {returnRefundInput} from '@/lib/returns/refund-link-contract';
import {prepareReturnRefund,readReturnRefundContext,ReturnRefundError} from '@/lib/returns/refund-link';
type Route={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
function failure(locale:'es'|'en',error:unknown){
 const code=error instanceof ReturnRefundError?error.code:'unavailable';
 const key={invalid:'refundInvalid',notFound:'notFound',changed:'refundChanged',pending:'refundPending',readOnly:'readOnly',receiptRequired:'refundReceiptRequired',limited:'refundLimited',unavailable:'refundUnavailable'}[code];
 const status={invalid:400,notFound:404,changed:409,pending:409,readOnly:402,receiptRequired:409,limited:429,unavailable:503}[code];
 return NextResponse.json({error:translate(locale,`returns.${key}`)},{status,headers});
}
async function body(request:Request):Promise<unknown>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new ReturnRefundError('invalid');
 const declared=request.headers.get('content-length');if(declared&&(!/^\d+$/.test(declared)||Number(declared)>4096))throw new ReturnRefundError('invalid');
 const reader=request.body?.getReader();if(!reader)throw new ReturnRefundError('invalid');const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>4096){await reader.cancel();throw new ReturnRefundError('invalid');}chunks.push(chunk.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{throw new ReturnRefundError('invalid');}finally{reader.releaseLock();}
}
export const dynamic='force-dynamic';
export async function GET(request:Request,route:Route){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ReturnRefundError('notFound'));
 const ctx=await inboxSession();if(ctx.response){ctx.response.headers.set('Cache-Control',headers['Cache-Control']);return ctx.response;}
 try{if([...new URL(request.url).searchParams].length)throw new ReturnRefundError('invalid');return NextResponse.json(await readReturnRefundContext(ctx.db,ctx.workspaceId,ctx.userId,(await route.params).id),{headers});}
 catch(error){return failure(locale,error);}
}
export async function POST(request:Request,route:Route){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ReturnRefundError('notFound'));
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 const ctx=await inboxSession();if(ctx.response){ctx.response.headers.set('Cache-Control',headers['Cache-Control']);return ctx.response;}
 try{
  if([...new URL(request.url).searchParams].length)throw new ReturnRefundError('invalid');const parsed=returnRefundInput.safeParse(await body(request));if(!parsed.success)throw new ReturnRefundError('invalid');
  return NextResponse.json(await prepareReturnRefund(ctx.db,ctx.workspaceId,ctx.userId,(await route.params).id,parsed.data),{headers});
 }catch(error){return failure(locale,error);}
}
