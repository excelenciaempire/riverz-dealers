import { containsEscalationKeyword } from '@/lib/ai/business-hours';
import { detectarEscalada } from '@/lib/ai/escalada';
import { cuentaDeLaPrueba } from '@/lib/ai/cuenta-de-prueba';
import { aiTestGuard } from '@/lib/ai/rate-limit';
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
  lugarDePrueba,
  simularDisparo,
  type EscenarioSimulado,
} from '@/lib/automations/simulacion';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { esRespuestaAutomatica } from '@/lib/channels/respuesta-automatica';
import { csrfGuard } from '@/lib/csrf';
import { simularComentario } from '@/lib/instagram-agent/simulacion-comentario';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { agruparPorPrincipal, type FilaAgrupable } from '@/lib/products/agrupar';
import { resolveWorkspaceCurrency } from '@/lib/products/currency';
import { probandoSinPagar } from '@/lib/wallet/prueba';
import { isOptInKeyword, isOptOutKeyword } from '@/lib/whatsapp/opt-out';
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
export function POST(request: Request) {
  // Se prueba igual antes de pagar el link: ver `wallet/prueba`.
  return probandoSinPagar(() => probar(request));
}

/**
 * GET /api/ai/probar[?token=]
 *   → { comercio, productos, acepta_contraentrega, medios_pago, telefono_ejemplo }
 *
 * Lo que la pantalla de prueba necesita para armarse, también desde el link
 * compartido, donde no hay sesión para pedir el catálogo por otro lado.
 */
export async function GET(request: Request) {
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const token = new URL(request.url).searchParams.get('token');
  const { workspaceId, conSesion, compartida } = await cuentaDeLaPrueba(admin, token);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, compartida || conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: compartida || conSesion ? 403 : 401 }
    );
  }
  const [{ data: ws }, { data: filas }, { data: agentes }, currency] = await Promise.all([
    admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    admin
      .from('shopify_products')
      .select('id, title, master_id, platform, price_min, currency, url, allowed_offers')
      .eq('workspace_id', workspaceId)
      .order('title', { ascending: true })
      .limit(500),
    admin
      .from('ai_agents')
      .select('medios_pago')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null),
    resolveWorkspaceCurrency(admin, workspaceId),
  ]);
  const productos = agruparPorPrincipal((filas ?? []) as unknown as FilaAgrupable[]).map((p) => ({
    id: String(p.id),
    title: String(p.title ?? ''),
    allowed_offers: (p as { allowed_offers?: unknown }).allowed_offers ?? null,
  }));
  // Con qué se puede pagar en el comercio: lo que declararon sus asistentes.
  const medios = new Set<string>();
  for (const a of (agentes ?? []) as Array<{ medios_pago?: unknown }>) {
    if (Array.isArray(a.medios_pago)) for (const m of a.medios_pago) if (typeof m === 'string') medios.add(m);
  }
  return NextResponse.json(
    {
      comercio: (ws as { name?: string | null } | null)?.name ?? null,
      productos,
      acepta_contraentrega: medios.has('contraentrega'),
      medios_pago: [...medios],
      telefono_ejemplo: lugarDePrueba(currency).telefono,
      compartida,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

async function probar(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const locale = await getLocale();
  const admin = supabaseAdmin();
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    escenario?: unknown;
    channel?: unknown;
    product_id?: unknown;
    unidades?: unknown;
    pago?: unknown;
    guia?: unknown;
    simulated_phone?: unknown;
    message?: unknown;
    historial?: unknown;
    agente_asignado?: unknown;
    agente_actual?: unknown;
    automation_context?: unknown;
  } | null;
  const { workspaceId, conSesion, compartida } = await cuentaDeLaPrueba(admin, body?.token);
  if (!workspaceId)
    return NextResponse.json(
      { error: translate(locale, compartida || conSesion ? 'errAi.forbidden' : 'errAi.unauthorized') },
      { status: compartida || conSesion ? 403 : 401 }
    );
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
  // Con el link compartido no se elige teléfono: un teléfono real haría que
  // el asistente buscara pedidos de clientes de verdad.
  const simulatedPhone =
    !compartida && typeof body?.simulated_phone === 'string' ? body.simulated_phone.trim() : '';

  // ── Paso 1: qué dispara el evento ──
  if (!message) {
    if (escenario === 'mensaje') {
      return NextResponse.json({ vars: {}, automatizaciones: [], agente_asignado: null });
    }
    const [producto, currency] = await Promise.all([
      cargarProducto(admin, workspaceId, body?.product_id, body?.unidades),
      resolveWorkspaceCurrency(admin, workspaceId),
    ]);
    const { vars, automatizaciones, plataforma, whatsapp_conectado } = await simularDisparo(admin, workspaceId, escenario, {
      producto,
      currency,
      pago:
        body?.pago === 'mercadopago' ||
        body?.pago === 'tarjeta' ||
        body?.pago === 'pendiente' ||
        body?.pago === 'transferencia'
          ? body.pago
          : 'cod',
      cliente: { nombre: 'Ana Prueba', telefono: simulatedPhone || lugarDePrueba(currency).telefono },
      guia: typeof body?.guia === 'string' ? body.guia.trim() : '',
    });
    const conEntrega = automatizaciones.find((a) => a.agente);
    return NextResponse.json({
      vars,
      automatizaciones,
      plataforma,
      whatsapp_conectado,
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

  // ── Comentarios ──
  // Un comentario no pasa por el runner: lo atiende Comentarios, con sus
  // propias puertas (crítica y spam se ocultan, intención, modo público o
  // privado). Se simula ese camino entero y se devuelve qué se publicaría,
  // qué llegaría por privado o por qué no saldría nada.
  if (channel === 'ig_comment' || channel === 'fb_comment') {
    const overBudget = await aiTestGuard(workspaceId);
    if (overBudget) return overBudget;
    try {
      const r = await simularComentario(admin, {
        workspaceId,
        canal: channel,
        texto: message,
        historial,
        simulatedPhone,
      });
      return NextResponse.json({
        agente: r.agente
          ? { id: r.agente.id, nombre: r.agente.nombre, role: 'general' }
          : null,
        motivo: 'comentarios',
        comentario: {
          publico: r.publico,
          privado: r.privado,
          oculto: r.oculto,
          escala: r.escala,
          espera_aprobacion: r.esperaAprobacion,
        },
        ...(r.barrera ? { barrera: r.barrera } : {}),
        reply: [r.publico, r.privado].filter(Boolean).join('\n\n'),
        chunks: [],
        herramientas: r.herramientas,
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
  const enrutamiento = {
    productMatch,
    stickyAgentId: actual,
    forcedAgentId: asignado,
    inboundText: message,
    hasOpenCart:
      escenario === 'shopify_abandoned_checkout' ||
      Boolean(automationContext?.pending_checkout_at),
  };
  // Si no hay ninguno prendido para este canal, se prueba el que atendería
  // al prenderlo: un asistente se prueba antes de encenderlo.
  const agent =
    (await pickAgent(admin, workspaceId, channel, enrutamiento)) ??
    (await pickAgent(admin, workspaceId, channel, { ...enrutamiento, incluirApagados: true }));
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
  const quien = {
    id: agent.id,
    nombre: agent.name,
    role: agent.role ?? 'general',
    // Apagado: en vivo no contestaría. Se muestra para probarlo igual.
    apagado: agent.is_active === false,
  };

  let traspaso: string | null = null;
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
    // Como en vivo: pedir una persona corta ahí; un problema se verifica,
    // se contesta y después pasa al equipo (`instruccionDeTraspaso`).
    if (escalada?.clase === 'pide_persona') {
      return NextResponse.json({ agente: quien, motivo, ...barrera('escalation_keyword', escalada.porQue) });
    }
    traspaso = escalada?.porQue ?? null;
    const tope = agent.escalate_after_messages ?? 0;
    const respondidas = historial.filter((t) => t.role === 'assistant').length;
    if (tope > 0 && respondidas >= tope) {
      return NextResponse.json({ agente: quien, motivo, ...barrera('tope_respuestas', String(tope)) });
    }
  }

  const overBudget = await aiTestGuard(workspaceId);
  if (overBudget) return overBudget;

  try {
    const { bloqueo, ...result } = await simularRespuesta(admin, agent as AiAgent, {
      message,
      historial,
      simulatedPhone,
      simulatedChannel: channel,
      automationContext,
      traspaso,
    });
    // En vivo esa respuesta no sale y la conversación pasa a una persona.
    if (bloqueo) {
      return NextResponse.json({
        agente: quien,
        motivo,
        ...barrera(bloqueo.tipo, bloqueo.detalle),
        herramientas: result.herramientas,
      });
    }
    return NextResponse.json({ agente: quien, motivo, ...result, ...(traspaso ? { traspaso } : {}) });
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

/**
 * El producto elegido, o el primero del catálogo, o uno de mentira.
 *
 * Con `unidades`, el pedido es el de esa oferta del producto (2, 3, 10
 * frascos) con su total: así la confirmación muestra lo que pagaría y la
 * recompra elige el camino de esas unidades.
 */
async function cargarProducto(
  admin: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  productId: unknown,
  unidades: unknown
): Promise<{ title: string; price: string; variant_title: string | null; quantity: number }> {
  let q = admin
    .from('shopify_products')
    .select('title, price_min, allowed_offers')
    .eq('workspace_id', workspaceId)
    .is('master_id', null)
    .limit(1);
  if (typeof productId === 'string' && productId) q = q.eq('id', productId);
  const { data } = await q.maybeSingle();
  const row = data as {
    title?: string | null;
    price_min?: number | string | null;
    allowed_offers?: unknown;
  } | null;
  const n = Number(unidades);
  const oferta = Number.isSafeInteger(n) && n > 0 && Array.isArray(row?.allowed_offers)
    ? (row.allowed_offers as Array<{ units?: unknown; total?: unknown }>).find(
        (o) => Number(o?.units) === n && Number.isFinite(Number(o?.total))
      )
    : undefined;
  return {
    title: row?.title?.trim() || 'Producto de prueba',
    price: oferta
      ? String(Number(oferta.total))
      : row?.price_min != null
        ? String(row.price_min)
        : '110000',
    variant_title: null,
    quantity: oferta ? n : 1,
  };
}
