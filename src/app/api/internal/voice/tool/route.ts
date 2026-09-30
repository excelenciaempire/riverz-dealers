import { getAnthropic } from '@/lib/ai/anthropic-client';
import { buscarEnInternet } from '@/lib/ai/busqueda-web';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { resolveShopifyContext } from '@/lib/ai/runner';
import { herramientasQueRequierenAprobacion, toolEnabled, toolPermissionKey } from '@/lib/ai/toolbox';
import { runTool } from '@/lib/ai/tools';
import type { AiAgent } from '@/lib/ai/types';
import { serverError } from '@/lib/api/errors';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveStoreForLookup } from '@/lib/commerce/order-lookup';
import { loadPrimaryContact } from '@/lib/contacts/dedupe';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import {
  resolveVoiceBrainAgent,
  resolveVoiceContextConversation,
} from '@/lib/voice/context';
import { sendWhatsAppDuringCall } from '@/lib/voice/whatsapp-during-call';
import type { Contact, VoiceCall } from '@/types';
import { NextResponse } from 'next/server';
import { exigirMensualidad } from '@/lib/wallet/puerta';

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
  if (typeof body?.call_id !== 'string' || !body.call_id || typeof body.tool !== 'string' || !body.tool) {
    return NextResponse.json(
      { error: 'call_id and tool required' },
      { status: 400 }
    );
  }
  if (body.input != null && (typeof body.input !== 'object' || Array.isArray(body.input))) {
    return NextResponse.json({ error: 'invalid_tool_input' }, { status: 400 });
  }

  const db = supabaseAdmin();
  try {
    const { data: callRow } = await db
      .from('voice_calls')
      .select('*')
      .eq('id', body.call_id)
      .maybeSingle();
    if (!callRow)
      return NextResponse.json({ error: 'call_not_found' }, { status: 404 });
    const call = callRow as VoiceCall;
    const paymentBlock = await exigirMensualidad(db, call.workspace_id);
    if (paymentBlock) return paymentBlock;

    const { data: contactRow } = await db
      .from('contacts')
      .select('*')
      .eq('id', call.contact_id)
      .eq('workspace_id', call.workspace_id)
      .maybeSingle();
    if (!contactRow)
      return NextResponse.json({ error: 'contact_not_found' }, { status: 404 });
    const contact = contactRow as Contact;

    // El agente ENTERO: la pizarra de herramientas vive en sus columnas, y sin
    // ella no se puede saber qué puso el comercio «con aprobación».
    const { data: agentRow } = await db
      .from('ai_agents')
      .select('*')
      .eq('id', call.agent_id)
      .eq('workspace_id', call.workspace_id)
      .is('deleted_at', null)
      .maybeSingle();
    const voiceAgent = agentRow as AiAgent | null;
    if (!voiceAgent)
      return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });
    const primaryContact = await loadPrimaryContact(db, contact);
    const contextConversation = await resolveVoiceContextConversation(
      db,
      call,
      contact,
      primaryContact
    );
    const agente = await resolveVoiceBrainAgent(
      db,
      call,
      voiceAgent,
      contextConversation
    );
    const conversationId = contextConversation?.id ?? call.conversation_id;
    // Never rely on a model or worker's advertised tool list for authorization.
    if (body.tool !== 'send_whatsapp' &&
      (body.tool === 'escalate_to_call' || !toolEnabled(agente, toolPermissionKey(body.tool)))) {
      return NextResponse.json({ ok: false, error: 'tool_disabled' }, { status: 403 });
    }
    const canCreateOrders = toolEnabled(agente, 'crear_pedido');

    const orderId =
      call.context && typeof call.context.order_id !== 'undefined'
        ? String(call.context.order_id)
        : null;

    // WhatsApp durante la llamada: el agente no puede dictar un link por
    // teléfono, así que se lo manda al mismo número al que está llamando. No
    // pasa por `runTool` porque no es una tool de Shopify.
    if (body.tool === 'send_whatsapp') {
      const input = body.input as { text?: string; scenario?: string } | null;
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      if (!text) {
        return NextResponse.json({ ok: false, error: 'text_required' });
      }
      const sent = await sendWhatsAppDuringCall(
        db,
        call,
        contact,
        text,
        typeof input?.scenario === 'string' ? input.scenario : null
      );
      return NextResponse.json(sent);
    }

    // Internet durante la llamada. Por chat la búsqueda la resuelve Anthropic
    // dentro del mismo turno, pero el teléfono corre sobre otro modelo, así que
    // por ahí no le llegaba: era el único canal que no podía mirar afuera. Acá
    // la corre el servidor y devuelve texto, que es lo que el worker sabe
    // manejar. Tampoco pasa por `runTool`: no toca la tienda.
    if (body.tool === 'buscar_en_internet') {
      const input = body.input as { consulta?: string; query?: string } | null;
      const rawQuery = input?.consulta ?? input?.query;
      const consulta = typeof rawQuery === 'string' ? rawQuery.trim() : '';
      if (!consulta)
        return NextResponse.json({ ok: false, error: 'consulta_required' });
      if (!agente || !toolEnabled(agente, 'buscar_en_internet')) {
        return NextResponse.json({ ok: false, error: 'tool_disabled' });
      }
      const resolved = await resolveAnthropicKey(db, {
        workspaceId: call.workspace_id,
        agentKeyEncrypted: agente.api_key_encrypted ?? null,
      });
      if (!resolved)
        return NextResponse.json({ ok: false, error: 'no_api_key' });
      const texto = await buscarEnInternet({
        client: getAnthropic(resolved.key, {
          db,
          workspaceId: call.workspace_id,
          concepto: 'busqueda_web',
          origenDeLaClave: resolved.source,
        }),
        model: agente.model || 'claude-sonnet-5-5',
        consulta,
        idioma: agente.language || undefined,
      });
      return NextResponse.json({ ok: true, result: texto });
    }

    const shopify = await resolveShopifyContext(
      db,
      call.workspace_id,
      contact,
      null
    );
    if (shopify) {
      const currency = await resolveWorkspaceCurrency(db, call.workspace_id);
      shopify.canCreateOrders = canCreateOrders;
      shopify.workspaceId = call.workspace_id;
      shopify.agentId = agente.id;
      shopify.contactId = call.contact_id;
      shopify.conversationId = conversationId;
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
      conversationId,
      agentId: agente.id,
      channel: 'voice',
      // La correa del comercio vale igual por teléfono: lo que puso «con
      // aprobación» se prepara y espera a una persona, no se ejecuta porque la
      // conversación sea hablada.
      // Cancelar y reembolsar quedan afuera porque ya preguntan por su cuenta:
      // ponerles el freno encima pediría dos confirmaciones por lo mismo.
      requiereAprobacion: herramientasQueRequierenAprobacion(agente),
    };

    const result = await runTool(
      body.tool,
      body.input ?? {},
      shopify,
      null,
      localOrders,
      store
    );

    // Stamp in-call upsell revenue for analytics. Estimate the delta from the
    // order's unit price (total_price / item_count) × extra units.
    if (body.tool === 'update_order') {
      try {
        const parsed = JSON.parse(result) as {
          ok?: boolean;
          added_units?: number;
        };
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
