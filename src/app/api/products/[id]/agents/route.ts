import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';

/**
 * POST /api/products/[id]/agents { agent_id }
 * Asigna un agente a este producto. Múltiples agentes pueden tener el
 * mismo producto (el AI runner usa esto como filtro de catálogo cuando
 * el agente está en product_scope='specific').
 *
 * DELETE /api/products/[id]/agents?agent_id=...
 * Quita la asignación.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    agent_id?: string;
  } | null;
  if (!body?.agent_id) {
    return NextResponse.json(
      { error: 'agent_id es requerido' },
      { status: 400 },
    );
  }

  // Verificamos que el producto sea visible para el usuario (RLS
  // workspace-member, mig 057). Si no, devolvemos 404.
  const { data: product } = await supabase
    .from('shopify_products')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!product) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  // Verificamos que el agente exista y sea del mismo workspace que
  // el usuario (RLS de ai_agents lo valida via is_workspace_member).
  const { data: agent, error: agentErr } = await supabase
    .from('ai_agents')
    .select('id, workspace_id')
    .eq('id', body.agent_id)
    .maybeSingle();
  if (agentErr || !agent) {
    return NextResponse.json({ error: 'Agente no encontrado' }, { status: 404 });
  }

  const { error } = await supabase
    .from('ai_agent_products')
    .upsert(
      { agent_id: body.agent_id, product_id: id },
      { onConflict: 'agent_id,product_id' },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const agentId = url.searchParams.get('agent_id');
  if (!agentId) {
    return NextResponse.json(
      { error: 'agent_id query param requerido' },
      { status: 400 },
    );
  }

  // Verificamos que el producto sea visible para el usuario antes de
  // borrar la asignación. La RLS de shopify_products (mig 057) es
  // workspace-member, así que esto ya gatea por workspace; ai_agent_products
  // valida lo mismo a través del agente. Doble check defensivo.
  const { data: product } = await supabase
    .from('shopify_products')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!product) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const { error } = await supabase
    .from('ai_agent_products')
    .delete()
    .eq('product_id', id)
    .eq('agent_id', agentId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
