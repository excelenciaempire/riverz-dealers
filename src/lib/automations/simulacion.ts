import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  SendTemplateStepConfig,
  WaitStepConfig,
} from '@/types';
import { confirmationDisplayVars } from './confirmation-copy';
import { confirmationSummary } from '@/lib/shopify/confirmation-summary';
import { TEMPLATE_VAR_SAMPLES } from './data-points';
import { RIVERZ_FLOWS, riverzOrderSkipReason } from './riverzoficial-context-gate';
import { RIVERZOFICIAL_WORKSPACE } from './riverzoficial-template-context';

/**
 * ¿Qué le llegaría al cliente si pasara X? Sin mandar nada.
 *
 * Recorre las automatizaciones activas de un disparador con un pedido de
 * mentira y devuelve la línea de tiempo: plantillas ya rellenas con las
 * variables, esperas, llamadas, condiciones con el camino que tomarían. Es lo
 * que el comercio ve en "Probar como cliente" antes de chatear.
 *
 * Es una LECTURA del árbol, no el motor: no encola, no escribe, no llama a
 * Meta. Lo que el motor decide en vivo con datos que acá no existen (¿compró
 * mientras tanto?, ¿tiene la etiqueta?) se asume del lado "no pasó nada" y
 * se dice en el paso, para que la línea de tiempo cuente la historia más
 * común y no una inventada.
 */

export type EscenarioSimulado =
  | 'shopify_order_created'
  | 'shopify_abandoned_checkout'
  | 'shopify_order_fulfilled'
  | 'shopify_order_delivered'
  | 'shopify_order_cancelled'
  | 'payment_rejected';

export const ESCENARIOS: EscenarioSimulado[] = [
  'shopify_order_created',
  'shopify_abandoned_checkout',
  'shopify_order_fulfilled',
  'shopify_order_delivered',
  'shopify_order_cancelled',
  'payment_rejected',
];

export interface ProductoDePrueba {
  title: string;
  price: string;
  variant_title?: string | null;
}

export interface PedidoDePrueba {
  producto: ProductoDePrueba;
  currency: string;
  /** Contra entrega (pendiente de pago), o pagado con Mercado Pago o tarjeta. */
  pago: 'cod' | 'mercadopago' | 'tarjeta';
  cliente: { nombre: string; telefono: string };
  /** Para "despachado": vacío simula una tienda que cumple sin guía. */
  guia?: string;
}

export type PasoSimulado =
  | {
      tipo: 'plantilla';
      nombre: string;
      texto: string;
      botones: Array<{ text: string; type: string }>;
      /** Una variable quedó vacía: en vivo, el motor corta antes de Meta. */
      vacias: string[];
      /** Estado en Meta. Sólo una aprobada sale de verdad. */
      estado: string | null;
    }
  | { tipo: 'mensaje'; texto: string }
  | { tipo: 'espera'; amount: number; unit: string }
  | { tipo: 'condicion'; descripcion: string; camino: 'yes' | 'no'; asumido: boolean }
  | { tipo: 'llamada'; agente: string | null; objetivo: string | null }
  | { tipo: 'contexto'; valores: Record<string, unknown> }
  | { tipo: 'otro'; step_type: string };

export interface AutomacionSimulada {
  id: string;
  nombre: string;
  /** El asistente que se queda con la conversación después (handoff). */
  agente: { id: string; nombre: string } | null;
  ventana: string | null;
  se_detiene_si_responde: boolean;
  pasos: PasoSimulado[];
  /**
   * Por qué esta automatización NO correría para este pedido, cuando el
   * comercio tiene una barrera propia (DeUNA verifica el pedido en Shopify
   * antes de cada mensaje: un pedido ya pagado no recibe la confirmación de
   * contra entrega). null = corre.
   */
  omitida: string | null;
  /**
   * Lo que quedaría en `conversations.automation_context` al entregar la
   * conversación: las variables del pedido más lo que fijó `set_context` por
   * el camino recorrido. Es lo que el asistente lee después.
   */
  contexto: Record<string, string>;
  /**
   * Armada pero todavía no activa: el comercio la pidió y espera algo de
   * afuera (la aprobación de una plantilla en Meta, el método de pago del
   * WhatsApp). Se muestra igual, porque es lo que va a pasar apenas eso se
   * resuelva; estas son las claves i18n de lo que falta. null = activa.
   */
  armada: string[] | null;
}

/** Las variables que tendría el contexto para este pedido de mentira. */
export function varsDePedido(
  trigger: EscenarioSimulado,
  pedido: PedidoDePrueba
): Record<string, string> {
  const [first, ...rest] = pedido.cliente.nombre.trim().split(/\s+/);
  const resumen = confirmationSummary({
    line_items: [
      {
        title: pedido.producto.title,
        quantity: 1,
        variant_title: pedido.producto.variant_title ?? '',
      },
    ],
    shipping_address: {
      address1: 'Calle 10 # 20-30',
      city: 'Bogotá',
      province: 'Cundinamarca',
      phone: pedido.cliente.telefono,
      name: pedido.cliente.nombre,
    },
    phone: pedido.cliente.telefono,
  });
  const vars: Record<string, string> = {
    ...TEMPLATE_VAR_SAMPLES,
    platform: 'shopify',
    customer_name: pedido.cliente.nombre,
    contact_first_name: first ?? '',
    contact_last_name: rest.join(' '),
    contact_phone: pedido.cliente.telefono,
    order_name: '#1042',
    order_number: '1042',
    total_price: pedido.producto.price,
    subtotal_price: pedido.producto.price,
    total_discounts: '0',
    currency: pedido.currency,
    item_count: '1',
    first_item: pedido.producto.title,
    last_product: pedido.producto.title,
    is_repeat_customer: 'false',
    // Los nombres que Shopify pone en `gateway` / `payment_gateway_names`.
    payment_gateway:
      pedido.pago === 'cod' ? 'Cash on Delivery' : pedido.pago === 'mercadopago' ? 'Mercado Pago' : 'Tarjeta',
    payment_method: pedido.pago === 'cod' ? 'cod' : pedido.pago,
    financial_status: pedido.pago === 'cod' ? 'pending' : 'paid',
    fulfillment_status:
      trigger === 'shopify_order_fulfilled' || trigger === 'shopify_order_delivered'
        ? 'fulfilled'
        : '',
    shipping_address: 'Calle 10 # 20-30',
    shipping_city: 'Bogotá',
    shipping_province: 'Cundinamarca',
    shipping_country: 'Colombia',
    checkout_url: 'https://tienda.ejemplo/checkout/abc123',
    abandoned_checkout_url: 'https://tienda.ejemplo/checkout/abc123',
    ...resumen,
  };
  if (trigger === 'shopify_order_fulfilled' || trigger === 'shopify_order_delivered') {
    vars.tracking_number = pedido.guia ?? '';
    vars.tracking_company = pedido.guia ? 'Servientrega' : '';
    vars.tracking_url = pedido.guia ? `https://www.servientrega.com/rastreo/${pedido.guia}` : '';
  } else {
    vars.tracking_number = '';
    vars.tracking_company = '';
    vars.tracking_url = '';
  }
  if (trigger === 'payment_rejected') {
    // Lo que manda el cron de Mercado Pago cuando un pago no pasa.
    Object.assign(vars, {
      payment_gateway: 'mercadopago',
      financial_status: 'pending',
      payment_attempts: '1',
      payment_reason: 'Fondos insuficientes',
      payment_reason_code: 'cc_rejected_insufficient_amount',
      payment_reason_bucket: 'fondos',
      installments: '1',
    });
  }
  Object.assign(vars, confirmationDisplayVars(vars, 'es'));
  return vars;
}

export interface DisparoSimulado {
  vars: Record<string, string>;
  automatizaciones: AutomacionSimulada[];
  /** De qué tienda se simuló el pedido; null si el comercio no tiene tienda conectada. */
  plataforma: string | null;
  /** Sin WhatsApp conectado, en vivo ninguna plantilla sale. */
  whatsapp_conectado: boolean;
}

export async function simularDisparo(
  db: SupabaseClient,
  workspaceId: string,
  trigger: EscenarioSimulado,
  pedido: PedidoDePrueba
): Promise<DisparoSimulado> {
  const vars = varsDePedido(trigger, pedido);
  // La tienda real del comercio. Con dos conectadas (Pilar: Shopify y
  // Tiendanube) se simula la de Shopify, que es la que más automatizaciones
  // filtran por plataforma.
  const [{ data: tiendas }, { data: wa }] = await Promise.all([
    db.from('shopify_connections').select('platform').eq('workspace_id', workspaceId).eq('status', 'active'),
    db.from('channel_connections').select('id').eq('workspace_id', workspaceId).eq('channel', 'whatsapp').eq('status', 'connected').limit(1),
  ]);
  const plataformas = ((tiendas ?? []) as Array<{ platform: string | null }>).map((t) => String(t.platform ?? 'shopify'));
  const plataforma = plataformas.includes('shopify') ? 'shopify' : (plataformas[0] ?? null);
  vars.platform = plataforma ?? '';
  const whatsappConectado = ((wa ?? []) as unknown[]).length > 0;
  // Las activas y las ARMADAS: una armada es una que el comercio ya pidió
  // prender y sólo espera a Meta. Probar antes de que Meta conteste es justo
  // cuando más se prueba, y dejarlas afuera decía "no hay automatizaciones"
  // de una cuenta que las tiene listas.
  const { data: rows } = await db
    .from('automations')
    .select('id, name, trigger_type, trigger_config, is_active, activation_state, activation_blockers, deleted_at')
    .eq('workspace_id', workspaceId)
    .eq('trigger_type', trigger)
    .or('is_active.eq.true,activation_state.eq.armed')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  const automations = (rows ?? []) as Array<{
    id: string;
    name: string;
    trigger_type: AutomationTriggerType;
    trigger_config: Record<string, unknown> | null;
    is_active?: boolean | null;
    activation_blockers?: Array<{ key?: string | null; message?: string | null }> | null;
  }>;
  if (automations.length === 0) {
    return { vars, automatizaciones: [], plataforma, whatsapp_conectado: whatsappConectado };
  }

  const [{ data: stepRows }, { data: tplRows }, { data: agentRows }] = await Promise.all([
    db
      .from('automation_steps')
      .select('*')
      .in(
        'automation_id',
        automations.map((a) => a.id)
      )
      .order('position', { ascending: true }),
    db
      .from('message_templates')
      .select('name, language, body_text, buttons, status')
      .eq('workspace_id', workspaceId),
    db.from('ai_agents').select('id, name').eq('workspace_id', workspaceId).is('deleted_at', null),
  ]);
  const steps = (stepRows ?? []) as AutomationStep[];
  const templates = (tplRows ?? []) as Array<{
    name: string;
    language: string | null;
    body_text: string | null;
    buttons: Array<{ text?: string; type?: string }> | null;
    status: string | null;
  }>;
  const agentes = new Map(
    ((agentRows ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name])
  );

  const automatizaciones: AutomacionSimulada[] = automations.map((a) => {
    const cfg = a.trigger_config ?? {};
    const handoff = String(cfg.handoff_ai_agent_id ?? '').trim();
    const rh = cfg.reminder_hours as
      | { start?: number; end?: number; timezone?: string }
      | undefined;
    const ctx: Record<string, string> = { ...vars };
    const propios = steps.filter((s) => s.automation_id === a.id);
    const pasos = recorrer(propios, null, null, ctx, templates, agentes);
    // El mismo filtro por plataforma que el despachador (`matchesEventConfig`).
    const soloEn = Array.isArray(cfg.platforms) ? (cfg.platforms as string[]) : [];
    const fueraDePlataforma = soloEn.length > 0 && plataforma !== null && !soloEn.includes(plataforma);
    // La barrera propia de DeUNA, con el mismo criterio que en vivo pero
    // sobre el pedido de mentira.
    const omitida = fueraDePlataforma
      ? `platform:${soloEn.join(',')}`
      : workspaceId === RIVERZOFICIAL_WORKSPACE && RIVERZ_FLOWS[a.id]
        ? riverzOrderSkipReason(RIVERZ_FLOWS[a.id], {
            financial_status: vars.financial_status,
            payment_gateway_names: [vars.payment_gateway],
            fulfillment_status: vars.fulfillment_status || null,
            fulfillments: vars.tracking_number
              ? [{ status: 'success', tracking_number: vars.tracking_number, shipment_status: trigger === 'shopify_order_delivered' ? 'delivered' : null }]
              : [],
            tags: '',
            cancelled_at: trigger === 'shopify_order_cancelled' ? new Date().toISOString() : null,
          })
        : null;
    return {
      id: a.id,
      nombre: a.name,
      agente: handoff ? { id: handoff, nombre: agentes.get(handoff) ?? handoff } : null,
      ventana:
        rh && typeof rh.start === 'number' && typeof rh.end === 'number'
          ? `${String(rh.start).padStart(2, '0')}:00–${String(rh.end).padStart(2, '0')}:00 ${rh.timezone ?? ''}`.trim()
          : null,
      se_detiene_si_responde: cfg.stop_on_inbound === true,
      pasos,
      omitida,
      contexto: ctx,
      armada: a.is_active
        ? null
        : (a.activation_blockers ?? [])
            .map((b) => String(b?.key || b?.message || '').trim())
            .filter(Boolean),
    };
  });
  return { vars, automatizaciones, plataforma, whatsapp_conectado: whatsappConectado };
}

function recorrer(
  steps: AutomationStep[],
  parentId: string | null,
  branch: 'yes' | 'no' | null,
  ctx: Record<string, string>,
  templates: Array<{ name: string; language: string | null; body_text: string | null; buttons: Array<{ text?: string; type?: string }> | null; status: string | null }>,
  agentes: Map<string, string>
): PasoSimulado[] {
  const propios = steps
    .filter((s) =>
      parentId === null
        ? s.parent_step_id == null
        : s.parent_step_id === parentId && (s.branch ?? 'yes') === branch
    )
    .sort((x, y) => x.position - y.position);
  const out: PasoSimulado[] = [];
  for (const step of propios) {
    switch (step.step_type) {
      case 'send_template': {
        const cfg = step.step_config as SendTemplateStepConfig;
        const tpl =
          templates.find(
            (t) => t.name === cfg.template_name && (!cfg.language || t.language === cfg.language)
          ) ?? templates.find((t) => t.name === cfg.template_name);
        const vacias: string[] = [];
        let texto = tpl?.body_text ?? `(plantilla ${cfg.template_name} no encontrada)`;
        for (const [k, v] of Object.entries(cfg.variables ?? {})) {
          const valor = interpolar(String(v), ctx);
          if (!valor.trim()) vacias.push(`{{${k}}} ← ${String(v)}`);
          texto = texto.split(`{{${k}}}`).join(valor || `{{${k}}}`);
        }
        out.push({
          tipo: 'plantilla',
          nombre: cfg.template_name,
          texto,
          botones: (tpl?.buttons ?? [])
            .filter((b) => b && typeof b.text === 'string')
            .map((b) => ({ text: String(b.text), type: String(b.type ?? '') })),
          vacias,
          estado: tpl?.status ?? null,
        });
        break;
      }
      case 'send_message': {
        const cfg = step.step_config as { text?: string };
        out.push({ tipo: 'mensaje', texto: interpolar(String(cfg.text ?? ''), ctx) });
        break;
      }
      case 'wait': {
        const cfg = step.step_config as WaitStepConfig;
        out.push({ tipo: 'espera', amount: Number(cfg.amount ?? 0), unit: String(cfg.unit ?? '') });
        break;
      }
      case 'set_context': {
        const cfg = step.step_config as { values?: Record<string, unknown> };
        for (const [k, v] of Object.entries(cfg.values ?? {})) ctx[k] = String(v);
        out.push({ tipo: 'contexto', valores: cfg.values ?? {} });
        break;
      }
      case 'voice_call': {
        const cfg = step.step_config as { agent_id?: string; objective_override?: string };
        out.push({
          tipo: 'llamada',
          agente: cfg.agent_id ? (agentes.get(cfg.agent_id) ?? cfg.agent_id) : null,
          objetivo: cfg.objective_override ?? null,
        });
        break;
      }
      case 'condition': {
        const cfg = step.step_config as ConditionStepConfig;
        const { camino, asumido, descripcion } = evaluar(cfg, ctx);
        out.push({ tipo: 'condicion', descripcion, camino, asumido });
        out.push(...recorrer(steps, step.id, camino, ctx, templates, agentes));
        break;
      }
      default:
        out.push({ tipo: 'otro', step_type: step.step_type });
    }
  }
  return out;
}

/**
 * La condición, con lo que hay a mano. `context_var` se evalúa de verdad
 * sobre las variables del pedido de mentira (es lo que el motor haría). Lo
 * que depende de datos vivos —compró mientras tanto, tiene la etiqueta, está
 * en el segmento— se asume "no" y se marca `asumido`.
 */
function evaluar(
  cfg: ConditionStepConfig,
  ctx: Record<string, string>
): { camino: 'yes' | 'no'; asumido: boolean; descripcion: string } {
  const op = cfg.op ?? 'eq';
  const valor = cfg.value ?? '';
  if (cfg.subject === 'context_var' && cfg.operand) {
    const actual = ctx[cfg.operand];
    const desc =
      op === 'empty' || op === 'not_empty'
        ? `${cfg.operand} ${op === 'empty' ? 'está vacío' : 'tiene valor'} (vale «${actual ?? ''}»)`
        : `${cfg.operand} ${op} «${valor}»${op === 'between' ? ` y «${cfg.value2 ?? ''}»` : ''} (vale «${actual ?? ''}»)`;
    if (op === 'empty' || op === 'not_empty') {
      const vacio = actual == null || String(actual).trim() === '';
      return { camino: (op === 'empty' ? vacio : !vacio) ? 'yes' : 'no', asumido: false, descripcion: desc };
    }
    if (actual == null) return { camino: 'no', asumido: false, descripcion: desc };
    if (op === 'eq') {
      return {
        camino:
          String(actual).trim().toLowerCase() === String(valor).trim().toLowerCase()
            ? 'yes'
            : 'no',
        asumido: false,
        descripcion: desc,
      };
    }
    const a = Number(actual);
    const b = Number(valor);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { camino: 'no', asumido: false, descripcion: desc };
    let ok = false;
    if (op === 'gt') ok = a > b;
    else if (op === 'gte') ok = a >= b;
    else if (op === 'lt') ok = a < b;
    else if (op === 'lte') ok = a <= b;
    else if (op === 'between') {
      const c = Number(cfg.value2);
      ok = Number.isFinite(c) && a >= Math.min(b, c) && a <= Math.max(b, c);
    }
    return { camino: ok ? 'yes' : 'no', asumido: false, descripcion: desc };
  }
  if (cfg.subject === 'time_of_day') {
    return { camino: 'yes', asumido: true, descripcion: `horario ${cfg.operand ?? ''}` };
  }
  // purchased, rejected_open, tag_presence, contact_field, in_segment,
  // message_content…: sin datos vivos, la historia más común es "no pasó".
  return {
    camino: 'no',
    asumido: true,
    descripcion: `${cfg.subject}${cfg.operand ? ` ${cfg.operand}` : ''}${valor ? ` = «${valor}»` : ''}`,
  };
}

function interpolar(s: string, ctx: Record<string, string>): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.');
    if (ns === 'vars' && prop) return ctx[prop] ?? '';
    return '';
  });
}
