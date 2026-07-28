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

    // ── Conversión de carrito abandonado (si la plantilla es de recuperación) ──
    // Sólo cuenta como recuperado el checkout que se completó DESPUÉS de que
    // salió el mensaje: es la única lectura honesta de "compró gracias a la
    // automatización". Se devuelven también los nombres, para poder mostrar
    // quién compró en vez de un número suelto.
    let cart: {
      recovered: number;
      revenue: number;
      buyers: Array<{ name: string; amount: number; at: string | null }>;
    } | null = null;
    if (/carrito|cart|abandon/i.test(tpl.name)) {
      const { data: dispatchedRows } = await db
        .from('shopify_checkouts')
        .select('customer_name, customer_email, customer_phone, completed_at, recovery_dispatched_at, total_price')
        .eq('workspace_id', tpl.workspace_id)
        .not('recovery_dispatched_at', 'is', null)
        .not('completed_at', 'is', null)
        .limit(10000);
      const rows = (dispatchedRows ?? []) as Array<{
        customer_name: string | null;
        customer_email: string | null;
        customer_phone: string | null;
        completed_at: string | null;
        recovery_dispatched_at: string | null;
        total_price: number | string | null;
      }>;
      const recoveredRows = rows.filter(
        (c) =>
          c.completed_at != null &&
          c.recovery_dispatched_at != null &&
          new Date(c.completed_at).getTime() >= new Date(c.recovery_dispatched_at).getTime(),
      );
      const revenue = recoveredRows.reduce((s, c) => s + (Number(c.total_price) || 0), 0);
      const buyers = recoveredRows
        .slice()
        .sort(
          (a, b) =>
            new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime(),
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
