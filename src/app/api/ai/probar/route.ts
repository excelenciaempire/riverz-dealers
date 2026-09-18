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
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { createClient } from '@/lib/supabase/server';
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
 *   2. Cuando el cliente escribe, elige al asistente con el MISMO `pickAgent`
 *      de producción —la entrega de la automatización primero, después el
 *      que ya venía contestando, después el enrutamiento por canal y
 *      producto— y lo corre en modo simulación (`lib/ai/simulacion`).
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
 *   }
 *   → sin `message`: { vars, automatizaciones, agente_asignado }
 *   → con `message`: { agente, motivo, reply, chunks, herramientas, usage }
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
  } | null;
  const escenario = escenarioValido(body?.escenario);
  if (!escenario) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.messageRequired') },
      { status: 400 }
    );
  }
  const channel = canalSimulado(body?.channel);
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

  // ── Paso 2: el cliente escribe; quién contesta se decide como en vivo ──
  const overBudget = await aiBudgetGuard(workspaceId);
  if (overBudget) return overBudget;

  const asignado = uuidOrNull(body?.agente_asignado);
  const actual = uuidOrNull(body?.agente_actual);
  const productMatch = await detectInboundProduct(admin, workspaceId, message);
  const agent = await pickAgent(admin, workspaceId, channel, {
    productMatch,
    stickyAgentId: actual,
    forcedAgentId: asignado,
    inboundText: message,
    hasOpenCart: escenario === 'shopify_abandoned_checkout',
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

  try {
    const result = await simularRespuesta(admin, agent as AiAgent, {
      message,
      historial: normalizarHistorial(body?.historial),
      simulatedPhone,
      simulatedChannel: channel,
    });
    return NextResponse.json({
      agente: { id: agent.id, nombre: agent.name, role: agent.role ?? 'general' },
      motivo,
      ...result,
    });
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
