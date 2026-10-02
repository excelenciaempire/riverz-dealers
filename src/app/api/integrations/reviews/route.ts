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
import {createNativeReviewService,storeReviewSettingsInput,reviewReplyInput} from '@/lib/integrations/expansion/review-service';
import {ExpansionProviderError} from '@/lib/integrations/expansion/provider-http';

const headers={'Cache-Control':'private, no-store'},uuid=z.string().uuid();
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('settings'),input:storeReviewSettingsInput}).strict(),
 z.object({action:z.literal('reply'),input:reviewReplyInput}).strict(),
]);
const query=z.discriminatedUnion('view',[
 z.object({view:z.literal('settings')}).strict(),
 z.object({view:z.literal('page'),page:z.string().regex(/^[1-9][0-9]?$/).transform(Number).refine(value=>value<=50)}).strict(),
 z.object({view:z.literal('receipt'),attemptId:uuid}).strict(),
]);
const hidden=()=>NextResponse.json({error:'not_found'},{status:404,headers});
function failure(locale:'es'|'en',error:unknown){
 const code=error instanceof ExpansionProviderError?error.code:error instanceof ContactMigrationError?'invalid':'unavailable';
 return NextResponse.json({error:translate(locale,`settings.reviewError_${code}`),code},{status:{invalid:400,notAllowed:403,unavailable:503,uncertain:409}[code],headers});
}
async function session(request:Request,locale:'es'|'en'){
 const client=await createClient(),{data:{user}}=await client.auth.getUser();
 if(!user)return {response:NextResponse.json({error:translate(locale,'errAi.unauthorized')},{status:401,headers})};
 const workspaceId=await resolveWorkspaceIdForUser(client,user.id),expected=request.headers.get('x-workspace-id');
 if(!workspaceId||!uuid.safeParse(expected).success||expected!==workspaceId)return {response:failure(locale,new ExpansionProviderError('notAllowed'))};
 return {service:createNativeReviewService(supabaseAdmin()),workspaceId,actorId:user.id};
}
function limited(response:Response){response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return hidden();const locale=await getLocale();
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;const params=new URL(request.url).searchParams;
  if([...new Set(params.keys())].some(name=>params.getAll(name).length!==1))throw new ExpansionProviderError('invalid');
  const parsed=query.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ExpansionProviderError('invalid');
  const limit=await limitByKey(`native-reviews-read:${ctx.workspaceId}:${ctx.actorId}`,{limit:40,windowMs:60000});if(!limit.success)return limited(rateLimitResponse(limit));
  const q=parsed.data,data=q.view==='settings'?await ctx.service.settings(ctx.workspaceId,ctx.actorId):q.view==='page'?await ctx.service.page(ctx.workspaceId,ctx.actorId,q.page):await ctx.service.receipt(ctx.workspaceId,ctx.actorId,q.attemptId);
  return data===null?NextResponse.json({error:'not_found',code:'attemptNotFound'},{status:404,headers}):NextResponse.json(data,{headers});
 }catch(error){return failure(locale,error);}
}
export async function POST(request:Request){
 if(!SHOW_RIVERZ_IMPROVEMENTS)return hidden();const locale=await getLocale();const block=await csrfGuard(request);if(block)return limited(block);
 try{
  const ctx=await session(request,locale);if(ctx.response)return ctx.response;
  if([...new URL(request.url).searchParams].length)throw new ExpansionProviderError('invalid');
  const limit=await limitByKey(`native-reviews-write:${ctx.workspaceId}:${ctx.actorId}`,{limit:8,windowMs:60000});if(!limit.success)return limited(rateLimitResponse(limit));
  const parsed=input.safeParse(await readMigrationJson(request,32768));if(!parsed.success)throw new ExpansionProviderError('invalid');
  const body=parsed.data,data=body.action==='settings'?await ctx.service.saveSettings(ctx.workspaceId,ctx.actorId,body.input):await ctx.service.reply(ctx.workspaceId,ctx.actorId,body.input);
  return NextResponse.json(data,{headers});
 }catch(error){return failure(locale,error);}
}
