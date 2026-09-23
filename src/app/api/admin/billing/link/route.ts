import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { aSuscripcion } from '@/lib/billing/plan';
import { eligibleForFirstMonthOffer, firstMonthCents, FIRST_MONTH_DISCOUNT_PERCENT } from '@/lib/billing/first-month-offer';
import {
  cuponesVigentes,
  stripeDisponible,
  urlDeCheckout,
} from '@/lib/billing/stripe';

/**
 * El link de pago de un comercio, hecho desde el panel.
 *
 * Hasta ahora cada cliente nuevo necesitaba que alguien armara la sesión de
 * Stripe a mano contra la API. Funciona una vez; a la tercera es un cuello de
 * botella con forma de persona, y el que cierra la venta no es el que tiene la
 * clave secreta.
 *
 * El link es una sesión de checkout de suscripción a nombre de ESE workspace:
 * el id viaja en la metadata, así que cuando el pago entra, el webhook sabe a
 * quién activarle la cuenta sin que nadie lo cruce después.
 *
 *   GET  ?workspace_id=… → los cupones que se pueden aplicar
 *   POST { workspace_id, cupon? } → la URL para mandarle
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Quién paga: el dueño de la cuenta. Es a quien Stripe le manda la factura. */
async function duenoDe(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
): Promise<{ email: string | null; nombre: string | null }> {
  const { data: ws } = await db
    .from('workspaces')
    .select('name, owner_id')
    .eq('id', workspaceId)
    .maybeSingle();
  const fila = ws as { name?: string | null; owner_id?: string | null } | null;
  if (!fila?.owner_id) return { email: null, nombre: fila?.name ?? null };
  const { data: p } = await db
    .from('profiles')
    .select('email')
    .eq('user_id', fila.owner_id)
    .maybeSingle();
  return {
    email: (p as { email?: string | null } | null)?.email ?? null,
    nombre: fila.name ?? null,
  };
}

async function suscripcionDe(
  db: ReturnType<typeof supabaseAdmin>,
  workspaceId: string,
) {
  const { data } = await db
    .from('workspace_subscriptions')
    .select(
      `workspace_id, plan_id, estado, prueba_hasta, periodo_desde, periodo_hasta,
       vencida_desde, precio_centavos_override, incluidas_override,
       excedente_centavos_override, nota, stripe_customer_id, stripe_subscription_id,
       cancelar_al_final, modelo_cobro,
       billing_plans ( id, slug, nombre, activo, precio_centavos, moneda, incluidas,
                       excedente_centavos, stripe_price_id, stripe_price_excedente_id, orden )`,
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return aSuscripcion(data as any);
}

export async function GET(request: Request) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const workspaceId = new URL(request.url).searchParams.get('workspace_id');
  const s = workspaceId ? await suscripcionDe(supabaseAdmin(), workspaceId) : null;
  const promo = s && eligibleForFirstMonthOffer(s)
    ? {
        percent: FIRST_MONTH_DISCOUNT_PERCENT,
        firstMonthCents: firstMonthCents(s.precioAcuerdoCentavos),
        monthlyCents: s.precioAcuerdoCentavos,
        currency: s.plan?.moneda ?? 'usd',
      }
    : null;
  if (!stripeDisponible()) {
    return NextResponse.json({ cupones: [], stripe: false, promo });
  }
  try {
    return NextResponse.json({ cupones: await cuponesVigentes(), stripe: true, promo });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'no se pudo leer Stripe';
    return NextResponse.json({ error: motivo }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    workspace_id?: string;
    cupon?: string | null;
  } | null;
  const workspaceId = body?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json({ error: 'falta la cuenta' }, { status: 400 });
  }
  if (!stripeDisponible()) {
    return NextResponse.json({ error: 'Stripe no está configurado.' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const s = await suscripcionDe(db, workspaceId);
  if (!s) {
    return NextResponse.json(
      { error: 'Esta cuenta todavía no tiene una suscripción cargada.' },
      { status: 400 },
    );
  }

  try {
    const url = await urlDeCheckout(db, workspaceId, s, await duenoDe(db, workspaceId), {
      cupon: body?.cupon || null,
    });
    await recordAdminAction(gate.actor, request, {
      action: 'update.billing_subscription',
      targetType: 'workspace',
      targetId: workspaceId,
      meta: { linkDePago: true, cupon: body?.cupon || null },
    });
    return NextResponse.json({ url });
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'no se pudo armar el link';
    return NextResponse.json({ error: motivo }, { status: 400 });
  }
}
