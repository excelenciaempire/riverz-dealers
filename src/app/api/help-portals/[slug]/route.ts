import {NextResponse} from 'next/server';
import {supabaseAdmin} from '@/lib/channels/admin-client';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';
import {limitByKey,clientIp,rateLimitResponse} from '@/lib/rate-limit';
import {getLocale} from '@/lib/i18n/server';
import {translate} from '@/lib/i18n/translate';
import {loadPublicPortal,recordPortalFeedback,PortalError} from '@/lib/help-portal/service';
import {portalPublicRead} from '@/lib/help-portal/contract';
import {readMigrationJson} from '@/lib/migrations/limited-json';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
type Context={params:Promise<{slug:string}>};
export async function GET(request:Request,{params}:Context){
 const locale=await getLocale();
 const fail=(code:string,status:number)=>NextResponse.json({code,error:translate(locale,`assistant.${code}`)},{status,headers});
 if(!SHOW_RIVERZ_IMPROVEMENTS)return fail('portal_not_found',404);
 try{
  const query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>key!=='locale')||query.getAll('locale').length>1)return fail('portal_invalid',400);
  const requested=query.get('locale')??locale;
  const slug=(await params).slug;
  if(!portalPublicRead.safeParse({slug,locale:requested}).success)return fail('portal_invalid',400);
  const rate=await limitByKey(`portal:public:ip:${clientIp(request)}`,{limit:60,windowMs:60000});
  if(!rate.success){const response=rateLimitResponse(rate);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const ceiling=await limitByKey(`portal:public:slug:${slug}`,{limit:3000,windowMs:60000});
  if(!ceiling.success){const response=rateLimitResponse(ceiling);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  const result=await loadPublicPortal(supabaseAdmin(),{slug,locale:requested});
  return result?NextResponse.json(result,{headers}):fail('portal_not_found',404);
 }catch(error){return fail(error instanceof PortalError&&error.code==='portal_invalid'?'portal_invalid':'portal_unavailable',error instanceof PortalError&&error.code==='portal_invalid'?400:503);}
}
export async function POST(request:Request,{params}:Context){
 const locale=await getLocale(),fail=(code:string,status:number)=>NextResponse.json({code,error:translate(locale,`assistant.${code}`)},{status,headers});
 if(!SHOW_RIVERZ_IMPROVEMENTS)return fail('portal_not_found',404);
 // Anonymous aggregate feedback has no session or authority. Reject cross-site forms/origins before reading its body.
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return fail('portal_invalid',403);
 try{
  if([...new URL(request.url).searchParams].length)return fail('portal_invalid',400);
  const rate=await limitByKey(`portal:feedback:ip:${clientIp(request)}`,{limit:30,windowMs:60000});
  if(!rate.success){const response=rateLimitResponse(rate);response.headers.set('Cache-Control',headers['Cache-Control']);return response;}
  let value:unknown;try{value=await readMigrationJson(request,4096);}catch{throw new PortalError('portal_invalid');}
  await recordPortalFeedback(supabaseAdmin(),(await params).slug,value);return NextResponse.json({recorded:true},{headers});
 }catch(error){const code=error instanceof PortalError?error.code:'portal_unavailable';return fail(code,code==='portal_invalid'?400:code==='portal_not_found'?404:code==='portal_limit'?429:503);}
}
