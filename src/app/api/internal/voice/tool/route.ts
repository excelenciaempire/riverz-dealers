import { NextResponse } from 'next/server';
import type { Contact, VoiceCall } from '@/types';
import type { AiAgent } from '@/lib/ai/types';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import { resolveShopifyContext } from '@/lib/ai/runner';
import { AGENT_TOOLBOX, toolMode } from '@/lib/ai/toolbox';
import { runTool } from '@/lib/ai/tools';
import { resolveStoreForLookup } from '@/lib/commerce/order-lookup';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { sendWhatsAppDuringCall } from '@/lib/voice/whatsapp-during-call';

/**
 * POST /api/internal/voice/tool
 * Bridges the worker's function tools to the existing Shopify tool logic
 * (lookup_order / create_checkout / create_order). The worker forwards the
 * model's tool call; we run it server-side with the call's workspace context
 * and return the JSON string the model should see as the tool result.
 * Auth: Bearer VOICE_WORKER_SECRET.
 */
export async function POST(request: Request) {
  try {
    assertVoiceWorkerAuth(request);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const body = (await request.json().catch(() => null)) as {
    call_id?: string;
    tool?: string;
    input?: unknown;
  } | null;
  if (!body?.call_id || !body.tool) {
    return NextResponse.json({ error: 'call_id and tool required' }, { status: 400 });
  }

  const db = supabaseAdmin();
  try {
    const { data: callRow } = await db
      .from('voice_calls')
      .select('*')
      .eq('id', body.call_id)
      .maybeSingle();
    if (!callRow) return NextResponse.json({ error: 'call_not_found' }, { status: 404 });
    const call = callRow as VoiceCall;

    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', call.contact_id)
      .maybeSingle();
    if (!contactRow) return NextResponse.json({ error: 'contact_not_found' }, { status: 404 });
    const contact = contactRow as Contact;

    // El agente ENTERO: la pizarra de herramientas vive en sus columnas, y sin
    // ella no se puede saber qué puso el comercio «con aprobación».
    const { data: agentRow } = await db
      .from('ai_agents')
      .select('*')
      .eq('id', call.agent_id)
      .maybeSingle();
    const agente = agentRow as AiAgent | null;
    const canCreateOrders = agente?.puede_crear_pedidos === true;

    const orderId =
      call.context && typeof call.context.order_id !== 'undefined'
        ? String(call.context.order_id)
        : null;

    // WhatsApp durante la llamada: el agente no puede dictar un link por
    // teléfono, así que se lo manda al mismo número al que está llamando. No
    // pasa por `runTool` porque no es una tool de Shopify.
    if (body.tool === 'send_whatsapp') {
      const text = (body.input as { text?: string } | null)?.text?.trim();
      if (!text) {
        return NextResponse.json({ ok: false, error: 'text_required' });
      }
      const sent = await sendWhatsAppDuringCall(db, call, contact, text);
      return NextResponse.json(sent);
    }

    const shopify = await resolveShopifyContext(db, call.workspace_id, contact, null);
    if (shopify) {
      const currency = await resolveWorkspaceCurrency(db, call.workspace_id);
      shopify.canCreateOrders = canCreateOrders;
      shopify.workspaceId = call.workspace_id;
      shopify.agentId = call.agent_id;
      shopify.contactId = call.contact_id;
      shopify.conversationId = call.conversation_id;
      shopify.channel = 'voice';
      shopify.contactName = contact.name ?? null;
      shopify.currency = shopify.config?.currency || currency;
      shopify.orderId = orderId; // for in-call upsell (update_order)
    }

    // La ficha de esta conversación, que es lo que la mitad de las
    // herramientas necesita para existir.
    //
    // Este puente pasaba SÓLO el contexto de Shopify, así que todo lo que se
    // apoya en `localOrders` —ver la ficha del cliente, etiquetarlo, buscar en
    // el catálogo, abrir una devolución, anotar lo que no supo contestar,
    // registrar un pago— contestaba «no tengo la ficha de esta conversación».
    // Por teléfono el agente quedaba con cinco herramientas mientras el mismo
    // agente por chat tenía diecisiete.
    const store = shopify
      ? null
      : await (async () => {
          const t = await resolveStoreForLookup(db, call.workspace_id);
          if (!t || t.platform === 'shopify') return null;
          return { ...t, customerEmail: null, customerPhone: null };
        })();

    const localOrders = {
      db,
      workspaceId: call.workspace_id,
      contactId: call.contact_id,
      conversationId: call.conversation_id,
      agentId: call.agent_id,
      channel: 'voice',
      // La correa del comercio vale igual por teléfono: lo que puso «con
      // aprobación» se prepara y espera a una persona, no se ejecuta porque la
      // conversación sea hablada.
      // Cancelar y reembolsar quedan afuera porque ya preguntan por su cuenta:
      // ponerles el freno encima pediría dos confirmaciones por lo mismo.
      requiereAprobacion: agente
        ? AGENT_TOOLBOX.filter(
            (t) => !t.proponeSolo && toolMode(agente, t.key) === 'aprobacion',
          ).map((t) => t.key)
        : [],
    };

    const result = await runTool(body.tool, body.input ?? {}, shopify, null, localOrders, store);

    // Stamp in-call upsell revenue for analytics. Estimate the delta from the
    // order's unit price (total_price / item_count) × extra units.
    if (body.tool === 'update_order') {
      try {
        const parsed = JSON.parse(result) as { ok?: boolean; added_units?: number };
        if (parsed.ok && parsed.added_units) {
          const ctx = call.context ?? {};
          const total = Number(ctx.total_price ?? 0);
          const items = Number(ctx.item_count ?? 0);
          const unit = items > 0 && total > 0 ? total / items : 0;
          const delta = Math.round(unit * parsed.added_units * 100) / 100;
          await db
            .from('voice_calls')
            .update({ upsell_amount: (call.upsell_amount ?? 0) + delta })
            .eq('id', call.id);
        }
      } catch {
        /* non-fatal — analytics only */
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return serverError(err, 'voice tool failed');
  }
}
