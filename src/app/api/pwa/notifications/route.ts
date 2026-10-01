import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {resolveWorkspaceIdForUser} from '@/lib/workspaces/resolve';
import {userAccess} from '@/lib/mcp/access';
import {csrfGuard} from '@/lib/csrf';
import {limitByKey} from '@/lib/rate-limit';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {pushSave,pushRemove} from '@/lib/pwa/push-contract';
import {browserPushKeys,manageBrowserPush} from '@/lib/pwa/push-server';
const headers={'Cache-Control':'private, no-store'};
const fail=(status:number)=>NextResponse.json({error:'browser_push_unavailable'},{status,headers});
async function body(request:Request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new Error('invalid');
 const reader=request.body?.getReader();if(!reader)throw new Error('invalid');const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const value=await reader.read();if(value.done)break;bytes+=value.value.byteLength;if(bytes>4096){await reader.cancel();throw new Error('invalid');}chunks.push(value.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}finally{reader.releaseLock();}
}
async function handle(request:Request,mode:'config'|'save'|'remove'){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return fail(404);
 if(mode!=='config'){const blocked=await csrfGuard(request);if(blocked){blocked.headers.set('Cache-Control',headers['Cache-Control']);return blocked;}}
 try{
  if([...new URL(request.url).searchParams].length)return fail(400);
  const client=await createClient(),auth=await client.auth.getUser();if(auth.error||!auth.data.user)return fail(401);
  const user=auth.data.user.id,workspace=await resolveWorkspaceIdForUser(client,user);if(!workspace)return fail(404);
  const expected=request.headers.get('x-riverz-workspace');if(!z.string().uuid().safeParse(expected).success||expected?.toLowerCase()!==workspace.toLowerCase())return fail(409);
  const db=supabaseAdmin(),access=await userAccess(db,user,workspace);
  if(mode!=='remove'&&(!access||(access.sections!==null&&!access.sections.includes('/bandeja'))))return fail(403);
  if(!(await limitByKey(`browser-push:${user}`,{limit:20,windowMs:60_000})).success)return fail(429);
  const keys=browserPushKeys();if(mode==='config')return NextResponse.json({enabled:!!keys,public_key:keys?.publicKey??null},{headers});
  if(mode==='save'&&!keys)return fail(503);
  let input:unknown;try{input=await body(request);}catch{return fail(400);}
  if(mode==='save'){
   const parsed=pushSave.safeParse(input);if(!parsed.success)return fail(400);
   const data=parsed.data;return NextResponse.json(await manageBrowserPush(db,workspace,user,'save',data.subscription.endpoint,data.locale,data.subscription),{headers});
  }
  const parsed=pushRemove.safeParse(input);if(!parsed.success)return fail(400);
  return NextResponse.json(await manageBrowserPush(db,workspace,user,'remove',parsed.data.endpoint),{headers});
 }catch(error){return fail(error instanceof Error&&error.message==='browser_push_forbidden'?403:error instanceof Error&&error.message==='browser_push_limit'?409:503);}
}
export const GET=(request:Request)=>handle(request,'config');
export const POST=(request:Request)=>handle(request,'save');
export const DELETE=(request:Request)=>handle(request,'remove');
