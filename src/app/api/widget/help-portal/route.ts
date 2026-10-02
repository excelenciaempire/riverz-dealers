import {NextResponse} from 'next/server';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {requireSession} from '@/lib/channels/webchat/guard';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {loadWidgetPortal,PortalError} from '@/lib/help-portal/service';
import {translate} from '@/lib/i18n/translate';
import {z} from 'zod';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function GET(request:Request){
 const params=new URL(request.url).searchParams,locale=params.get('locale')==='en'?'en':'es';
 const fail=(code:string,status:number)=>NextResponse.json({code,error:translate(locale,`assistant.${code}`)},{status,headers});
 if(!SHOW_RIVERZ_IMPROVEMENTS)return fail('portal_not_found',404);
 if([...params.keys()].some(key=>key!=='locale')||params.getAll('locale').length>1||params.has('locale')&&!['es','en'].includes(params.get('locale')??''))return fail('portal_invalid',400);
 try{
  const guard=await requireSession(request,'poll');if(!guard.ok){guard.response.headers.set('Cache-Control',headers['Cache-Control']);return guard.response;}
  const agentId=guard.ctx.config.agent_id;
  if(!z.string().uuid().safeParse(agentId).success)return fail('portal_not_found',404);
  return NextResponse.json(await loadWidgetPortal(supabaseAdmin(),guard.session.workspaceId,agentId!,guard.session.visitorId,locale),{headers});
 }catch(error){const code=error instanceof PortalError?error.code:'portal_unavailable';return fail(code,code==='portal_not_found'?404:code==='portal_invalid'?400:503);}
}
