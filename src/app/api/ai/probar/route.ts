import { containsEscalationKeyword } from '@/lib/ai/business-hours';
import { detectarEscalada } from '@/lib/ai/escalada';
import { aiBudgetGuard } from '@/lib/ai/rate-limit';
import { detectInboundProduct, pickAgent } from '@/lib/ai/runner';
import {
  canalSimulado,
  normalizarHistorial,
  simularRespuesta,
  SinClaveError,
} from '@/lib/ai/simulacion';
import type { AiAgent } from '@/lib/ai/types';
import { serverError } from '@/lib/api/errors';
import {
  ESCENARIOS,
  simularDisparo,
  type EscenarioSimulado,
} from '@/lib/automations/simulacion';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { esRespuestaAutomatica } from '@/lib/channels/respuesta-automatica';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { createClient } from '@/lib/supabase/server';
import { isOptInKeyword, isOptOutKeyword } from '@/lib/whatsapp/opt-out';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { NextResponse } from 'next/server';

/**
 * Probar el comercio entero como si uno fuera el cliente.
 *
 * "Probar" (por agente) sirve para afinar UN asistente, pero no contesta la
 * pregunta que el comercio se hace de verdad: "si alguien compra contra
 * entrega, ¿qué le llega y quién le contesta?". Con dos asistentes encima
 * había que saber cuál abrir. Acá no se elige agente: se elige la SITUACIÓN
 * y el canal, y el sistema hace lo mismo que en vivo:
 *
 *   1. Si la situación es un evento de tienda, recorre las automatizaciones
 *      que dispara y devuelve las plantillas ya rellenas, las esperas y quién
 *      se queda con la conversación (`lib/automations/simulacion`).
 *   2. Cuando el cliente escribe, pasa por las MISMAS barreras que el runner
 *      —baja por palabra clave, contestador automático, palabra de escalado,
 *      triaje de problemas, tope de respuestas— y, si ninguna lo frena, elige
 *      al asistente con el mismo `pickAgent` de producción (entrega de la
 *      automatización primero, después el que ya venía contestando, después
 *      canal y producto) y lo corre en simulación (`lib/ai/simulacion`) con
 *      el contexto que la automatización dejó en la conversación.
 *
 * Nada se guarda ni se manda. Los tokens sí se cobran: es el agente entero.
 *
 * POST /api/ai/probar
 *   body: {
 *     escenario: 'mensaje' | EscenarioSimulado,
 *     channel?: Channel,
 *     product_id?: string, pago?: 'cod' | 'paid', guia?: string,
 *     simulated_phone?: string,
 *     message?: string, historial?: {role,content}[],
 *     agente_asignado?: string | null,   // handoff de la automatización (paso 1)
 *     agente_actual?: string | null,     // quién contestó el turno anterior
 *     automation_context?: object,       // lo que dejó la automatización (paso 1)
 *   }
 *   → sin `message`: { vars, automatizaciones, agente_asignado }
 *   → con `message`: { agente, motivo, barrera?, reply, chunks, herramientas, usage }
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, 'errAi.unauthorized') },
      { status: 401 }
    );

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId)
    return NextResponse.json(
      { error: translate(locale, 'errAi.forbidden') },
      { status: 403 }
    );

  const body = (await request.json().catch(() => null)) as {
    escenario?: unknown;
    channel?: unknown;
    product_id?: unknown;
    pago?: unknown;
    guia?: unknown;
    simulated_phone?: unknown;
    message?: unknown;
    historial?: unknown;
    agente_asignado?: unknown;
    agente_actual?: unknown;
    automation_context?: unknown;
  } | null;
  const escenario = escenarioValido(body?.escenario);
  if (!escenario) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.messageRequired') },
      { status: 400 }
    );
  }
  // Las plantillas son de WhatsApp: un evento de tienda siempre le llega al
  // cliente por ahí, elija lo que elija la pantalla.
  const channel = escenario === 'mensaje' ? canalSimulado(body?.channel) : 'whatsapp';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const simulatedPhone =
    typeof body?.simulated_phone === 'string' ? body.simulated_phone.trim() : '';

  // ── Paso 1: qué dispara el evento ──
  if (!message) {
    if (escenario === 'mensaje') {
      return NextResponse.json({ vars: {}, automatizaciones: [], agente_asignado: null });
    }
    const [producto, currency] = await Promise.all([
      cargarProducto(admin, workspaceId, body?.product_id),
      resolveWorkspaceCurrency(admin, workspaceId),
    ]);
    const { vars, automatizaciones } = await simularDisparo(admin, workspaceId, escenario, {
      producto,
      currency,
      pago: body?.pago === 'paid' ? 'paid' : 'cod',
      cliente: { nombre: 'Ana Prueba', telefono: simulatedPhone || '+573000000000' },
      guia: typeof body?.guia === 'string' ? body.guia.trim() : '',
    });
    const conEntrega = automatizaciones.find((a) => a.agente);
    return NextResponse.json({
      vars,
      automatizaciones,
      agente_asignado: conEntrega?.agente ?? null,
    });
  }

  // ── Paso 2: el cliente escribe ──
  const historial = normalizarHistorial(body?.historial);
  const asignado = uuidOrNull(body?.agente_asignado);
  const actual = uuidOrNull(body?.agente_actual);
  const automationContext =
    body?.automation_context && typeof body.automation_context === 'object'
      ? (body.automation_context as Record<string, unknown>)
      : null;

  // Las barreras que en vivo van ANTES que la IA. Se contestan sin gastar
  // un token, igual que el runner.
  if (channel !== 'webchat') {
    if (isOptOutKeyword(message)) return NextResponse.json(barrera('baja'));
    if (isOptInKeyword(message)) return NextResponse.json(barrera('alta'));
  }

  const productMatch = await detectInboundProduct(
    admin,
    workspaceId,
    [message, automationContext?.first_item, automationContext?.order_items]
      .filter(Boolean)
      .join('\n')
  );
  const agent = await pickAgent(admin, workspaceId, channel, {
    productMatch,
    stickyAgentId: actual,
    forcedAgentId: asignado,
    inboundText: message,
    hasOpenCart:
      escenario === 'shopify_abandoned_checkout' ||
      Boolean(automationContext?.pending_checkout_at),
  });
  if (!agent) {
    return NextResponse.json({
      agente: null,
      motivo: asignado ? 'asignado_inactivo' : 'sin_agente',
      reply: '',
      chunks: [],
      herramientas: [],
    });
  }
  const motivo = asignado
    ? 'automatizacion'
    : actual && agent.id === actual
      ? 'pegado'
      : 'enrutamiento';
  const quien = { id: agent.id, nombre: agent.name, role: agent.role ?? 'general' };

  if (channel !== 'webchat') {
    if (esRespuestaAutomatica(message)) {
      return NextResponse.json({ agente: quien, motivo, ...barrera('respuesta_automatica') });
    }
    if (containsEscalationKeyword(agent.escalate_keywords, message)) {
      return NextResponse.json({ agente: quien, motivo, ...barrera('escalation_keyword') });
    }
    const escalada = await detectarEscalada({
      mensaje: message,
      hilo: historial.map((t) => `${t.role === 'user' ? 'Cliente' : 'Asistente'}: ${t.content}`),
      hayPedido: escenario !== 'mensaje',
      db: admin,
      workspaceId,
      agentKeyEncrypted: agent.api_key_encrypted,
    }).catch(() => null);
    if (escalada) {
      return NextResponse.json({
        agente: quien,
        motivo,
        ...barrera(escalada.clase === 'pide_persona' ? 'escalation_keyword' : 'problema_detectado', escalada.porQue),
      });
    }
    const tope = agent.escalate_after_messages ?? 0;
    const respondidas = historial.filter((t) => t.role === 'assistant').length;
    if (tope > 0 && respondidas >= tope) {
      return NextResponse.json({ agente: quien, motivo, ...barrera('tope_respuestas', String(tope)) });
    }
  }

  const overBudget = await aiBudgetGuard(workspaceId);
  if (overBudget) return overBudget;

  try {
    const result = await simularRespuesta(admin, agent as AiAgent, {
      message,
      historial,
      simulatedPhone,
      simulatedChannel: channel,
      automationContext,
    });
    return NextResponse.json({ agente: quien, motivo, ...result });
  } catch (err) {
    if (err instanceof SinClaveError) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.missingApiKey') },
        { status: 500 }
      );
    }
    return serverError(err, translate(locale, 'errAi.testGenerateFailed'), 502);
  }
}

/** Una barrera del runner: el asistente no contesta, y se dice por qué. */
function barrera(tipo: string, detalle?: string) {
  return { barrera: { tipo, detalle: detalle ?? null }, reply: '', chunks: [], herramientas: [] };
}

function escenarioValido(v: unknown): 'mensaje' | EscenarioSimulado | null {
  if (v === 'mensaje') return 'mensaje';
  return typeof v === 'string' && (ESCENARIOS as string[]).includes(v)
    ? (v as EscenarioSimulado)
    : null;
}

function uuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** El producto elegido, o el primero del catálogo, o uno de mentira. */
async function cargarProducto(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  productId: unknown
): Promise<{ title: string; price: string; variant_title: string | null }> {
  let q = admin
    .from('shopify_products')
    .select('title, price_min')
    .eq('workspace_id', workspaceId)
    .limit(1);
  if (typeof productId === 'string' && productId) q = q.eq('id', productId);
  const { data } = await q.maybeSingle();
  const row = data as { title?: string | null; price_min?: number | string | null } | null;
  return {
    title: row?.title?.trim() || 'Producto de prueba',
    price: row?.price_min != null ? String(row.price_min) : '110000',
    variant_title: null,
  };
}
