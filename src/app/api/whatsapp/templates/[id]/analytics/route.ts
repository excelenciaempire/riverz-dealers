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
  templateName: string,
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
    (s) => (s as { step_config?: { template_name?: string } }).step_config?.template_name === templateName,
  );
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const db = supabaseAdmin();
    const { data: tplRow } = await db
      .from('message_templates')
      .select('id, workspace_id, name, meta_template_id, waba_id, buttons, category')
      .eq('id', id)
      .maybeSingle();
    if (!tplRow) return NextResponse.json({ error: 'not_found' }, { status: 404 });
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
    if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

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
                for (const c of clks as Array<{ count?: number }>) clicked += Number(c.count ?? 0);
              } else {
                clicked += Number(clks ?? 0);
              }
            }
          }
          metaOk = true;
        }
      }
    }

    // ── Conversión de carrito abandonado ──
    // La atribución "compró gracias a este mensaje" sólo se puede calcular
    // cuando el recorrido entero es observable: el carrito abandonado de
    // Shopify es hoy el único caso (shopify_checkouts guarda el abandono y su
    // completado). Por eso el bloque NO se muestra por el nombre de la
    // plantilla, sino sólo si ESTA plantilla es la que envía una automatización
    // con disparador `shopify_abandoned_checkout` de este workspace.
    let cart: {
      recovered: number;
      revenue: number;
      buyers: Array<{ name: string; amount: number; at: string | null }>;
    } | null = null;

    const isCartRecoveryTemplate = await usedByAbandonedCartAutomation(
      db,
      tpl.workspace_id,
      tpl.name,
    );

    if (isCartRecoveryTemplate) {
      const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

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
        const conv = Array.isArray(s.conversations) ? s.conversations[0] : s.conversations;
        const cid = conv?.contact_id;
        if (!cid) continue;
        const at = new Date(s.created_at).getTime();
        const prev = firstSendByContact.get(cid);
        if (prev === undefined || at < prev) firstSendByContact.set(cid, at);
      }

      if (firstSendByContact.size > 0) {
        // El checkout guarda teléfono, no contact_id: se emparejan por los
        // últimos 8 dígitos (mismo criterio que el resto del CRM, porque los
        // prefijos móviles varían entre Shopify y WhatsApp).
        const { data: contactRows } = await db
          .from('contacts')
          .select('id, phone')
          .in('id', [...firstSendByContact.keys()]);
        const sentAtByPhone = new Map<string, number>();
        for (const c of (contactRows ?? []) as Array<{ id: string; phone: string | null }>) {
          const key = phoneKey(c.phone);
          const at = firstSendByContact.get(c.id);
          if (!key || at === undefined) continue;
          const prev = sentAtByPhone.get(key);
          if (prev === undefined || at < prev) sentAtByPhone.set(key, at);
        }

        const { data: checkoutRows } = await db
          .from('shopify_checkouts')
          .select('customer_name, customer_email, customer_phone, completed_at, total_price')
          .eq('workspace_id', tpl.workspace_id)
          .not('completed_at', 'is', null)
          .gte('completed_at', sinceIso)
          .limit(10000);

        // Recuperado = ese cliente recibió esta plantilla y COMPLETÓ el
        // checkout después. Sin las dos condiciones no hay atribución posible.
        const recoveredRows = (
          (checkoutRows ?? []) as Array<{
            customer_name: string | null;
            customer_email: string | null;
            customer_phone: string | null;
            completed_at: string;
            total_price: number | string | null;
          }>
        ).filter((c) => {
          const sentAt = sentAtByPhone.get(phoneKey(c.customer_phone));
          return sentAt !== undefined && new Date(c.completed_at).getTime() >= sentAt;
        });

        const revenue = recoveredRows.reduce((s, c) => s + (Number(c.total_price) || 0), 0);
        const buyers = recoveredRows
          .slice()
          .sort(
            (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime(),
          )
          .slice(0, 20)
          .map((c) => ({
            name:
              (c.customer_name ?? '').trim() ||
              (c.customer_email ?? '').trim() ||
              (c.customer_phone ?? '').trim(),
            amount: Number(c.total_price) || 0,
            at: c.completed_at,
          }));
        cart = { recovered: recoveredRows.length, revenue, buyers };
      } else {
        cart = { recovered: 0, revenue: 0, buyers: [] };
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
