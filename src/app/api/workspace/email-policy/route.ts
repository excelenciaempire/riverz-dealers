import { NextResponse } from 'next/server';
import { cuentaDeSesion } from '@/lib/workspaces/cuenta-de-sesion';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { translate } from '@/lib/i18n/translate';
import { loadEmailPolicy, validEmailPolicy } from '@/lib/ai/email-policy';

export async function GET() {
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  try { return NextResponse.json(await loadEmailPolicy(c.admin,c.workspaceId), {headers:{'Cache-Control':'no-store'}}); }
  catch (error) { return serverError(error); }
}
export async function POST(request: Request) {
  const block = await csrfGuard(request); if (block) return block;
  const c = await cuentaDeSesion(); if ('error' in c) return c.error;
  const member = await c.admin.from('workspace_members').select('role').eq('workspace_id',c.workspaceId).eq('user_id',c.userId).maybeSingle();
  if (member.error || !['owner','admin'].includes(member.data?.role ?? ''))
    return NextResponse.json({error:translate(c.locale,'errAi.forbidden')},{status:403});
  const body: unknown = await request.json().catch(()=>null);
  if (!validEmailPolicy(body)) return NextResponse.json({error:translate(c.locale,'assistant.emailPolicyInvalid')},{status:400});
  const {error} = await c.admin.from('workspace_email_policy').upsert({
    workspace_id:c.workspaceId,mode:body.mode,whatsapp_number:body.whatsapp_number,
    filter_notifications:body.filter_notifications,prevent_repeated_redirects:body.prevent_repeated_redirects,
    updated_at:new Date().toISOString(),
  },{onConflict:'workspace_id'});
  if (error) return serverError(error);
  return NextResponse.json({ok:true});
}
