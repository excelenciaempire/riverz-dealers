import { NextResponse } from 'next/server';
import { inboxSession } from '@/lib/inbox/server-context';
import { decideReturn, returnDecisionInput, ReturnDecisionError } from '@/lib/returns/decision';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import {visibleReturnIds,ReturnAccessError} from '@/lib/returns/access';

/**
 * Las devoluciones y los cambios que abrió el agente.
 *
 * GET   — la lista, primero lo que espera una decisión.
 * PATCH — mover una de estado, con la nota de por qué.
 *
 * Sin esto el dato entraba y no salía: el agente abría el caso con el pedido,
 * el motivo y las fotos, y el comercio no tenía dónde verlo — la mitad peor de
 * construir una funcionalidad.
 */
export const dynamic = 'force-dynamic';

const ESTADOS = ['abierta', 'aprobada', 'rechazada', 'recibida', 'resuelta'] as const;

async function contexto() {
  const ctx = await inboxSession();
  if (ctx.response) return { response: ctx.response };
  return { admin: ctx.db, workspaceId: ctx.workspaceId, userId: ctx.userId };
}

export async function GET(request: Request) {
  const locale = await getLocale();
  const ctx = await contexto();
  if (ctx.response) { ctx.response.headers.set('Cache-Control', 'private, no-store'); return ctx.response; }

  try{await visibleReturnIds(ctx.admin,ctx.workspaceId,ctx.userId,[]);}catch(error){return NextResponse.json({error:translate(locale,'returns.loadFailed')},{status:error instanceof ReturnAccessError&&error.code==='forbidden'?403:503,headers:{'Cache-Control':'private, no-store'}});}

  const estado = new URL(request.url).searchParams.get('estado');
  const contactId = new URL(request.url).searchParams.get('contact_id');
  if (contactId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId)) {
    return NextResponse.json({ error: translate(locale, 'returns.invalidContact') }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  }
  let q = ctx.admin
    .from('returns')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (estado && (ESTADOS as readonly string[]).includes(estado)) q = q.eq('status', estado);
  if (contactId) q = q.eq('contact_id', contactId);

  const candidates = await q;
  if(candidates.error)return NextResponse.json({error:translate(locale,'returns.loadFailed')},{status:503,headers:{'Cache-Control':'private, no-store'}});
  let ids:Set<string>;
  try{ids=await visibleReturnIds(ctx.admin,ctx.workspaceId,ctx.userId,(candidates.data??[]).map(row=>String(row.id)));}catch{return NextResponse.json({error:translate(locale,'returns.loadFailed')},{status:503,headers:{'Cache-Control':'private, no-store'}});}
  if(!ids.size)return NextResponse.json({returns:[]},{headers:{'Cache-Control':'private, no-store'}});
  const {data,error}=await ctx.admin.from('returns').select('id,order_number,kind,reason,customer_note,photos,status,resolution,created_at,updated_at,decided_at,contact_id,conversation_id,platform,external_url,contacts(id,name,email,phone)')
    .eq('workspace_id',ctx.workspaceId).in('id',[...ids]).order('created_at',{ascending:false}).limit(200);
  if (error) return NextResponse.json({ error: translate(locale, 'returns.loadFailed') }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });

  let current:Set<string>;
  try{current=await visibleReturnIds(ctx.admin,ctx.workspaceId,ctx.userId,(data??[]).map(row=>String(row.id)));}catch{return NextResponse.json({error:translate(locale,'returns.loadFailed')},{status:503,headers:{'Cache-Control':'private, no-store'}});}
  const filas = ((data ?? []) as Array<Record<string, unknown>>).filter(row=>current.has(String(row.id)));
  const contactIds = [...new Set(filas.flatMap(row => row.contacts && typeof row.contacts === 'object' && 'id' in row.contacts ? [String(row.contacts.id)] : []))];
  let allowed = new Set<string>();
  if (contactIds.length) {
    const contacts = await ctx.admin.from('contacts').select('id').eq('workspace_id', ctx.workspaceId).in('id', contactIds);
    if (contacts.error) return NextResponse.json({ error: translate(locale, 'returns.loadFailed') }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    allowed = new Set((contacts.data ?? []).map(row => String(row.id)));
  }
  for (const row of filas) if (row.contacts && (typeof row.contacts !== 'object' || Array.isArray(row.contacts) || !('id' in row.contacts) || !allowed.has(String(row.contacts.id)))) row.contacts = null;
  // Lo que espera una decisión va primero, aunque sea más viejo: es la lista de
  // trabajo, no un registro histórico.
  const peso = (s: unknown) => (s === 'abierta' ? 0 : s === 'recibida' ? 1 : s === 'aprobada' ? 2 : 3);
  filas.sort((a, b) => peso(a.status) - peso(b.status));

  return NextResponse.json({ returns: filas }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(request: Request) {
  const locale = await getLocale();
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  const fail = (key: string, status: number) => NextResponse.json({ error: translate(locale, `returns.${key}`) }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (ctx.response) { ctx.response.headers.set('Cache-Control', 'private, no-store'); return ctx.response; }
  const body = returnDecisionInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail('invalidDecision', 400);
  try {
    const result = await decideReturn(ctx.admin, ctx.workspaceId, ctx.userId, body.data);
    return NextResponse.json({ ok: true, status: result.status, updated_at: result.updated_at, unchanged: result.unchanged }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof ReturnDecisionError ? error.code : 'saveFailed';
    return fail(code, code === 'unauthorized' ? 403 : code === 'readOnly' ? 402 : code === 'notFound' ? 404 : code === 'invalidDecision' ? 400 : ['platformManaged', 'decisionChanged'].includes(code) ? 409 : 503);
  }
}
