import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { serverError } from '@/lib/api/errors';

/**
 * GET /api/whatsapp/templates/[id]/analytics
 * Métricas EN VIVO de una plantilla, desde la Template Analytics API de Meta
 * (enviados / entregados / leídos / clics de botón), agregadas sobre los últimos
 * 30 días. Para plantillas de carrito abandonado suma la tasa de conversión
 * (carritos con recuperación enviada que luego se completaron), desde
 * shopify_checkouts. Todo scoped al workspace del usuario.
 */
export const dynamic = 'force-dynamic';

const META_API = 'https://graph.facebook.com/v21.0';

/** Últimos 8 dígitos de un teléfono: los prefijos móviles difieren entre
 *  Shopify y WhatsApp (54911… vs 5411…), la cola no. */
function phoneKey(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : digits;
}

interface OrderRow {
  contact_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  total_price: number | string | null;
  status: string | null;
  created_at: string;
  checkout_token: string | null;
}

/**
 * Pedidos del workspace en la ventana. `checkout_token` llega con la migración
 * 128; hasta que se aplique, PostgREST rechaza el select entero por columna
 * desconocida, así que se reintenta sin ella. Sin token no se colapsa nada:
 * cada compra cuenta por separado, que es el lado seguro del error.
 */
async function selectOrders(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  sinceIso: string
): Promise<OrderRow[]> {
  const base =
    'contact_id, customer_name, customer_phone, total_price, status, created_at';
  const run = (columns: string) =>
    db
      .from('orders')
      .select(columns)
      .eq('workspace_id', workspaceId)
      .gte('created_at', sinceIso)
      .limit(5000);

  const withToken = await run(`${base}, checkout_token`);
  if (!withToken.error) return (withToken.data ?? []) as unknown as OrderRow[];

  const legacy = await run(base);
  return (
    (legacy.data ?? []) as unknown as Array<Omit<OrderRow, 'checkout_token'>>
  ).map((o) => ({
    ...o,
    checkout_token: null,
  }));
}

/**
 * ¿Esta plantilla es la que manda la recuperación de carrito de Shopify?
 * Es la condición para poder atribuir compras: sin el disparador
 * `shopify_abandoned_checkout` no hay abandono ni completado que observar.
 * No se filtra por `is_active` — si la automatización se pausó hoy, las
 * recuperaciones que ya ocurrieron siguen siendo reales.
 */
async function usedByAbandonedCartAutomation(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
  templateName: string
): Promise<boolean> {
  const { data: autos } = await db
    .from('automations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('trigger_type', 'shopify_abandoned_checkout');
  const ids = (autos ?? []).map((a) => (a as { id: string }).id);
  if (ids.length === 0) return false;

  const { data: steps } = await db
    .from('automation_steps')
    .select('step_config')
    .in('automation_id', ids)
    .eq('step_type', 'send_template');
  return (steps ?? []).some(
    (s) =>
      (s as { step_config?: { template_name?: string } }).step_config
        ?.template_name === templateName
  );
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const db = supabaseAdmin();
    const { data: tplRow } = await db
      .from('message_templates')
      .select(
        'id, workspace_id, name, meta_template_id, waba_id, buttons, category'
      )
      .eq('id', id)
      .maybeSingle();
    if (!tplRow)
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const tpl = tplRow as {
      workspace_id: string;
      name: string;
      meta_template_id: string | null;
      waba_id: string | null;
      buttons: unknown;
      category: string | null;
    };

    // Membership gate.
    const { data: member } = await db
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', tpl.workspace_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member)
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const hasButtons =
      Array.isArray(tpl.buttons) && (tpl.buttons as unknown[]).length > 0;

    // ── Meta template analytics (sent/delivered/read/clicked) ──
    let sent = 0;
    let delivered = 0;
    let read = 0;
    let clicked = 0;
    let metaOk = false;

    if (tpl.meta_template_id) {
      const { data: cfg } = await db
        .from('whatsapp_config')
        .select('waba_id, access_token')
        .eq('workspace_id', tpl.workspace_id)
        .maybeSingle();
      const wabaId = tpl.waba_id || (cfg?.waba_id ? String(cfg.waba_id) : null);
      let token: string | null = null;
      try {
        token = cfg?.access_token ? decrypt(cfg.access_token) : null;
      } catch {
        token = null;
      }
      if (wabaId && token) {
        const end = Math.floor(Date.now() / 1000);
        const start = end - 30 * 24 * 60 * 60;
        const url =
          `${META_API}/${wabaId}/template_analytics` +
          `?start=${start}&end=${end}&granularity=DAILY` +
          `&metric_types=${encodeURIComponent(JSON.stringify(['SENT', 'DELIVERED', 'READ', 'CLICKED']))}` +
          `&template_ids=${encodeURIComponent(JSON.stringify([tpl.meta_template_id]))}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (r.ok) {
          const j = (await r.json()) as {
            data?: Array<{ data_points?: Array<Record<string, unknown>> }>;
          };
          for (const block of j.data ?? []) {
            for (const dp of block.data_points ?? []) {
              sent += Number(dp.sent ?? 0);
              delivered += Number(dp.delivered ?? 0);
              read += Number(dp.read ?? 0);
              const clks = dp.clicked;
              if (Array.isArray(clks)) {
                for (const c of clks as Array<{ count?: number }>)
                  clicked += Number(c.count ?? 0);
              } else {
                clicked += Number(clks ?? 0);
              }
            }
          }
          metaOk = true;
        }
      }
    }

    // ── Recuperación de carrito ──
    // La atribución "compró gracias a este mensaje" sólo se puede calcular
    // cuando el recorrido entero es observable: el carrito abandonado es hoy el
    // único caso (queda registrado el abandono y su desenlace). Por eso el
    // bloque NO se muestra por el nombre de la plantilla, sino sólo si ESTA
    // plantilla es la que envía una automatización con disparador
    // `shopify_abandoned_checkout` de este workspace.
    //
    // La compra se busca por los dos caminos posibles: volver al checkout
    // (shopify_checkouts) o cerrar por la conversación (orders).
    let cart: {
      recovered: number;
      revenue: number;
      buyers: Array<{ name: string; amount: number; at: string | null }>;
    } | null = null;

    // Configurada hoy como la plantilla de recuperación. Alcanza para mostrar
    // el bloque aunque todavía no haya enviado nada (dice "aún nada", que es
    // información), pero NO alcanza como única condición: al cambiar la
    // plantilla de la automatización, la que hizo todo el trabajo dejaría de
    // mostrar sus recuperaciones y la nueva mostraría un cero.
    const isConfiguredForCart = await usedByAbandonedCartAutomation(
      db,
      tpl.workspace_id,
      tpl.name
    );

    {
      const sinceIso = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();

      // Envíos REALES de esta plantilla (no de otra plantilla de carrito del
      // mismo workspace), con el contacto que los recibió.
      const { data: sendRows } = await db
        .from('messages')
        .select('created_at, conversations!inner(workspace_id, contact_id)')
        .eq('template_name', tpl.name)
        .eq('conversations.workspace_id', tpl.workspace_id)
        .in('status', ['sent', 'delivered', 'read'])
        .gte('created_at', sinceIso)
        .limit(5000);
      const sends = (sendRows ?? []) as unknown as Array<{
        created_at: string;
        conversations: { contact_id: string } | { contact_id: string }[];
      }>;

      // contact_id → primer envío de esta plantilla.
      const firstSendByContact = new Map<string, number>();
      for (const s of sends) {
        const conv = Array.isArray(s.conversations)
          ? s.conversations[0]
          : s.conversations;
        const cid = conv?.contact_id;
        if (!cid) continue;
        const at = new Date(s.created_at).getTime();
        const prev = firstSendByContact.get(cid);
        if (prev === undefined || at < prev) firstSendByContact.set(cid, at);
      }

      if (firstSendByContact.size === 0) {
        // Sin envíos no hay nada que atribuir. El bloque en cero sólo tiene
        // sentido si la plantilla está enganchada esperando su primer disparo.
        cart = isConfiguredForCart
          ? { recovered: 0, revenue: 0, buyers: [] }
          : null;
      } else {
        // El checkout guarda teléfono, no contact_id: se emparejan por los
        // últimos 8 dígitos (mismo criterio que el resto del CRM, porque los
        // prefijos móviles varían entre Shopify y WhatsApp).
        const { data: contactRows } = await db
          .from('contacts')
          .select('id, name, phone')
          .in('id', [...firstSendByContact.keys()]);
        const contacts = (contactRows ?? []) as Array<{
          id: string;
          name: string | null;
          phone: string | null;
        }>;
        const sentAtByPhone = new Map<string, number>();
        const nameByContact = new Map<string, string>();
        for (const c of contacts) {
          nameByContact.set(c.id, (c.name ?? '').trim());
          const key = phoneKey(c.phone);
          const at = firstSendByContact.get(c.id);
          if (!key || at === undefined) continue;
          const prev = sentAtByPhone.get(key);
          if (prev === undefined || at < prev) sentAtByPhone.set(key, at);
        }

        // Carritos del workspace en la ventana: los que dispararon una
        // recuperación (para saber si esta plantilla ES la del carrito) y los
        // que terminaron comprados (para atribuir).
        const { data: checkoutRows } = await db
          .from('shopify_checkouts')
          .select(
            'checkout_id, customer_name, customer_email, customer_phone, completed_at, recovery_dispatched_at, total_price'
          )
          .eq('workspace_id', tpl.workspace_id)
          .or(
            `completed_at.gte.${sinceIso},recovery_dispatched_at.gte.${sinceIso}`
          )
          .limit(10000);
        const checkouts = (checkoutRows ?? []) as Array<{
          checkout_id: string | null;
          customer_name: string | null;
          customer_email: string | null;
          customer_phone: string | null;
          completed_at: string | null;
          recovery_dispatched_at: string | null;
          total_price: number | string | null;
        }>;

        // ¿Esta plantilla es de verdad la que sale a recuperar carritos? La
        // prueba está en los hechos, no en la configuración de hoy: el envío
        // ocurre en el mismo instante en que el cron despacha la recuperación
        // de ese cliente. Sin esto, cambiar la plantilla de la automatización
        // borra el historial de la anterior.
        const DISPATCH_WINDOW_MS = 15 * 60 * 1000;
        const hasCartRecoveryHistory = checkouts.some((c) => {
          if (!c.recovery_dispatched_at) return false;
          const sentAt = sentAtByPhone.get(phoneKey(c.customer_phone));
          if (sentAt === undefined) return false;
          return (
            Math.abs(new Date(c.recovery_dispatched_at).getTime() - sentAt) <
            DISPATCH_WINDOW_MS
          );
        });

        if (!isConfiguredForCart && !hasCartRecoveryHistory) {
          // Plantilla ajena al carrito: no hay recorrido observable, no hay
          // nada que atribuir.
          cart = null;
        } else {
          // Una compra atribuida, venga del checkout o del pedido. `token` es el
          // checkout que la originó: es lo que permite reconocer la misma compra
          // vista por los dos caminos sin confundirla con una segunda compra.
          type Purchase = {
            token: string;
            name: string;
            amount: number;
            at: string;
          };
          const purchases: Purchase[] = [];

          // 1) Volvió al checkout y lo completó (el camino normal del carrito).
          for (const c of checkouts) {
            if (!c.completed_at) continue;
            const sentAt = sentAtByPhone.get(phoneKey(c.customer_phone));
            if (sentAt === undefined) continue;
            if (new Date(c.completed_at).getTime() < sentAt) continue;
            purchases.push({
              token: (c.checkout_id ?? '').trim(),
              name:
                (c.customer_name ?? '').trim() ||
                (c.customer_email ?? '').trim() ||
                (c.customer_phone ?? '').trim(),
              amount: Number(c.total_price) || 0,
              at: c.completed_at,
            });
          }

          // 2) Cerró la compra por la conversación: el pedido lo crea el
          // asistente vía Admin API, no completa ningún carrito, y su única
          // huella está en `orders` (espejo de pedidos originados aquí).
          const orderPurchases = await selectOrders(
            db,
            tpl.workspace_id,
            sinceIso
          );
          for (const o of orderPurchases) {
            // Un pedido cancelado, devuelto o fallido no es una recuperación.
            if (
              ['cancelled', 'refunded', 'failed'].includes(
                String(o.status ?? '')
              )
            )
              continue;
            const sentAt =
              (o.contact_id
                ? firstSendByContact.get(o.contact_id)
                : undefined) ?? sentAtByPhone.get(phoneKey(o.customer_phone));
            if (sentAt === undefined) continue;
            if (new Date(o.created_at).getTime() < sentAt) continue;
            purchases.push({
              token: (o.checkout_token ?? '').trim(),
              name:
                (o.customer_name ?? '').trim() ||
                (o.contact_id ? (nameByContact.get(o.contact_id) ?? '') : '') ||
                (o.customer_phone ?? '').trim(),
              amount: Number(o.total_price) || 0,
              at: o.created_at,
            });
          }

          // Si el cliente compra dos veces son DOS recuperaciones. Lo único que
          // se colapsa es la misma compra leída por los dos caminos, y eso se
          // reconoce por el token del checkout que la originó (migración 128):
          // mismo token = misma compra. Sin token no hay nada que colapsar —
          // un pedido sin checkout no tiene contraparte posible.
          const seenTokens = new Set<string>();
          const recoveredRows: Purchase[] = [];
          for (const p of purchases.sort(
            (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
          )) {
            if (p.token) {
              if (seenTokens.has(p.token)) continue;
              seenTokens.add(p.token);
            }
            recoveredRows.push(p);
          }

          const revenue = recoveredRows.reduce((s, p) => s + p.amount, 0);
          const buyers = recoveredRows
            .slice()
            .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
            .slice(0, 20)
            .map((p) => ({ name: p.name, amount: p.amount, at: p.at }));
          cart = { recovered: recoveredRows.length, revenue, buyers };
        }
      }
    }

    return NextResponse.json({
      hasButtons,
      metaOk,
      metrics: { sent, delivered, read, clicked },
      cart,
    });
  } catch (err) {
    return serverError(err, 'template analytics failed');
  }
}
