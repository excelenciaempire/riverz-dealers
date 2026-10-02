import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {resolveWorkspaceIdForUser} from '@/lib/workspaces/resolve';
import {csrfGuard} from '@/lib/csrf';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {productPolicyWrite} from '@/lib/returns/product-policy-contract';
import {readProductReturnPolicy,writeProductReturnPolicy,ProductPolicyError} from '@/lib/returns/product-policy';
type Route={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
const failure=(locale:'es'|'en',error:unknown)=>{
 const code=error instanceof ProductPolicyError?error.code:'unavailable';
 const key={invalid:'returnPolicyInvalid',notFound:'returnPolicyNotFound',changed:'returnPolicyChanged',readOnly:'returnPolicyReadOnly',unavailable:'returnPolicyUnavailable'}[code];
 const status={invalid:400,notFound:404,changed:409,readOnly:402,unavailable:503}[code];
 return NextResponse.json({error:translate(locale,`products.${key}`)},{status,headers});
};
async function session(locale:'es'|'en'){
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return {response:NextResponse.json({error:translate(locale,'products.returnPolicyUnauthorized')},{status:401,headers})};
 const workspaceId=await resolveWorkspaceIdForUser(client,user.id);if(!workspaceId)return {response:failure(locale,new ProductPolicyError('notFound'))};
 return {db:supabaseAdmin(),workspaceId,actorId:user.id};
}
async function readBody(request:Request):Promise<unknown>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new ProductPolicyError('invalid');
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>8192))throw new ProductPolicyError('invalid');
 const reader=request.body?.getReader();if(!reader)throw new ProductPolicyError('invalid');let bytes=0;const chunks:Uint8Array[]=[];
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>8192){await reader.cancel();throw new ProductPolicyError('invalid');}chunks.push(chunk.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 catch{throw new ProductPolicyError('invalid');}finally{reader.releaseLock();}
}
export const dynamic='force-dynamic';
export async function GET(request:Request,route:Route){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ProductPolicyError('notFound'));
 try{
  const ctx=await session(locale);if(ctx.response)return ctx.response;if([...new URL(request.url).searchParams].length)throw new ProductPolicyError('invalid');
  return NextResponse.json(await readProductReturnPolicy(ctx.db,ctx.workspaceId,ctx.actorId,(await route.params).id),{headers});
 }catch(error){return failure(locale,error);}
}
export async function POST(request:Request,route:Route){
 const locale=await getLocale();if(!SHOW_RIVERZ_IMPROVEMENTS)return failure(locale,new ProductPolicyError('notFound'));
 const block=await csrfGuard(request);if(block){block.headers.set('Cache-Control',headers['Cache-Control']);return block;}
 try{
  const ctx=await session(locale);if(ctx.response)return ctx.response;if([...new URL(request.url).searchParams].length)throw new ProductPolicyError('invalid');
  const parsed=productPolicyWrite.safeParse(await readBody(request));if(!parsed.success)throw new ProductPolicyError('invalid');
  return NextResponse.json(await writeProductReturnPolicy(ctx.db,ctx.workspaceId,ctx.actorId,(await route.params).id,parsed.data),{headers});
 }catch(error){return failure(locale,error);}
}
