import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import { recordAdminAction } from '@/lib/admin/audit';
import { estadoAlConfigurar, listarPlanes, leerSuscripcion, DIAS_DE_PRUEBA, type ModeloCobro } from '@/lib/billing/plan';
import { invalidatePlatformKeyCache } from '@/lib/ai/platform-key';
import { expirarCheckoutsDelAcuerdo, sincronizarPrecioSuscripcion } from '@/lib/billing/stripe';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { leerNegocio } from '@/lib/billing/negocio';
import { listarTarifas } from '@/lib/wallet/tarifas';
import { compatibleBillingPlan } from '@/lib/billing/admin-agreement';
import { validGraceHours } from '@/lib/billing/grace';
import { safeInvoiceUrl } from '@/lib/billing/pending-payment';

/**
 * El negocio y sus perillas, en un solo lugar.
 *
 *   GET  → MRR, clientes, costo y la lista de cuentas con lo que paga cada una.
 *   PUT  { plan }   → crea o edita un plan (precio, incluidas, excedente).
 *   PUT  { cuenta } → define qué se le cobra a UNA cuenta.
 *
 * Las dos escrituras existen porque el precio no puede vivir en el código: en
 * esta etapa se está descubriendo, y cada prueba costaría un despliegue. La
 * cuenta que todavía no pagó su link queda en `cortesia`: usa la app, pero no
 * la IA ni nada que se cobre, y sigue contando en el cuadro con MRR 0.
 *
 * Se auditan las dos: el trato de un comercio es una decisión que en seis
 * meses nadie recuerda haber tomado.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);
  return adminGet(request, { action: 'view.billing' }, async () => {
    const db = supabaseAdmin();
    const [planes, negocio, tarifas] = await Promise.all([
      listarPlanes(db),
      leerNegocio(db, { desde: from, hasta: to }),
      listarTarifas(db),
    ]);
    const invoices = await db.from('workspace_billing_invoices').select('workspace_id,grace_until,hosted_invoice_url')
      .in('status', ['open','uncollectible']).gt('amount_remaining', 0).lte('unpaid_since', new Date().toISOString())
      .order('grace_until');
    if (invoices.error) throw invoices.error;
    for (const account of negocio.cuentas) {
      const invoice = invoices.data?.find(i => i.workspace_id === account.workspaceId);
      account.graceUntil = invoice?.grace_until ?? (account.estado === 'vencida' && account.vencidaDesde
        ? new Date(Date.parse(account.vencidaDesde) + (account.graceHours ?? 24) * 3_600_000).toISOString() : null);
      account.readOnly = account.graceUntil != null && Date.parse(account.graceUntil) <= Date.now();
      account.invoiceUrl = safeInvoiceUrl(invoice?.hosted_invoice_url);
    }
    return { planes, negocio, tarifas, diasDePrueba: DIAS_DE_PRUEBA };
  });
}

interface CuerpoPlan {
  id?: string;
  slug: string;
  nombre: string;
  activo?: boolean;
  precio_centavos: number;
  moneda?: string;
  incluidas: number;
  excedente_centavos: number;
  stripe_price_id?: string | null;
  stripe_price_excedente_id?: string | null;
  orden?: number;
}

interface CuerpoCuenta {
  workspace_id: string;
  plan_id?: string | null;
  estado?: 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'cortesia';
  prueba_hasta?: string | null;
  precio_centavos_override?: number | null;
  incluidas_override?: number | null;
  excedente_centavos_override?: number | null;
  modelo_cobro?: ModeloCobro;
  nota?: string | null;
}

interface CuerpoSaldo {
  workspace_id: string;
  /** Firmado: positivo regala, negativo corrige de más. */
  centavos: number;
  tipo?: 'bono' | 'ajuste';
  motivo?: string | null;
  operation_id: string;
}

interface CuerpoTarifa {
  concepto: string;
  /** En milésimas de centavo. Una respuesta corta cuesta menos de un centavo. */
  precio_milicentavos: number;
  activo?: boolean;
}

interface CuerpoBilletera {
  workspace_id: string;
  bloquear_sin_saldo?: boolean;
  /** El consumo se le descuenta a costo, sin margen. */
  cobrar_a_costo?: boolean;
}

const ENTERO = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    plan?: CuerpoPlan;
    cuenta?: CuerpoCuenta;
    saldo?: CuerpoSaldo;
    billetera?: CuerpoBilletera;
    tarifa?: CuerpoTarifa;
    gracia?: { workspace_id: string; horas: number; horas_previas: number };
  } | null;
  const db = supabaseAdmin();
  if (!body || Object.keys(body).length !== 1) {
    return NextResponse.json({ error: translate(await getLocale(), 'admin.billingInvalidAgreement') }, { status: 400 });
  }

  if (body.gracia) {
    const g = body.gracia;
    if (!g.workspace_id || !validGraceHours(g.horas) || !validGraceHours(g.horas_previas)) {
      return NextResponse.json({ error: translate(await getLocale(), 'admin.billingInvalidGrace') }, { status: 400 });
    }
    const { data, error } = await db.rpc('admin_set_billing_grace', {
      p_workspace: g.workspace_id, p_hours: g.horas, p_expected: g.horas_previas, p_actor: gate.actor.userId, p_actor_email: gate.actor.email,
    });
    if (error) return NextResponse.json({ error: translate(await getLocale(),
      error.message.includes('billing_policy_conflict') ? 'admin.billingConcurrentChange' : 'admin.billingSaveFailed') }, { status: 409 });
    return NextResponse.json({ ok: true, ...data });
  }

  if (body?.plan) {
    const p = body.plan;
    if (!p.slug?.trim() || !p.nombre?.trim()) {
      return NextResponse.json({ error: 'falta slug o nombre' }, { status: 400 });
    }
    const { data: actual, error: planReadError } = await db.from('billing_plans')
      .select('id,activo,precio_centavos,incluidas,excedente_centavos,stripe_price_id,stripe_price_excedente_id,orden')
      .eq('slug', p.slug.trim()).maybeSingle();
    if (planReadError) return NextResponse.json({ error: planReadError.message }, { status: 400 });
    const fila = {
      slug: p.slug.trim(),
      nombre: p.nombre.trim(),
      activo: p.activo ?? actual?.activo ?? true,
      precio_centavos: ENTERO(p.precio_centavos) ?? 0,
      moneda: (p.moneda ?? 'usd').toLowerCase(),
      incluidas: ENTERO(p.incluidas) ?? 0,
      excedente_centavos: ENTERO(p.excedente_centavos) ?? 0,
      stripe_price_id: p.stripe_price_id === undefined
        ? actual?.stripe_price_id ?? null : p.stripe_price_id?.trim() || null,
      stripe_price_excedente_id: p.stripe_price_excedente_id === undefined
        ? actual?.stripe_price_excedente_id ?? null : p.stripe_price_excedente_id?.trim() || null,
      orden: ENTERO(p.orden) ?? actual?.orden ?? 999,
      updated_at: new Date().toISOString(),
    };
    if (actual && (
      actual.precio_centavos !== fila.precio_centavos ||
      actual.incluidas !== fila.incluidas ||
      actual.excedente_centavos !== fila.excedente_centavos
    )) {
      const { count, error: countError } = await db.from('workspace_subscriptions')
        .select('workspace_id', { count: 'exact', head: true })
        .eq('plan_id', actual.id)
        .in('estado', ['activa', 'vencida'])
        .not('stripe_subscription_id', 'is', null);
      if (countError) return NextResponse.json({ error: countError.message }, { status: 400 });
      if (count) return NextResponse.json({
        error: translate(await getLocale(), 'admin.billingPlanHasSubscribers'),
      }, { status: 409 });
    }
    // Por `slug` y no por id: es la clave estable del plan y deja que la misma
    // llamada sirva para crear y para editar.
    const { error } = await db
      .from('billing_plans')
      .upsert(fila, { onConflict: 'slug' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.billing_plan',
      targetType: 'billing_plan',
      targetId: fila.slug,
      meta: { precio_centavos: fila.precio_centavos, incluidas: fila.incluidas },
    });
    return NextResponse.json({ ok: true });
  }

  if (body?.cuenta) {
    const c = body.cuenta;
    if (!c.workspace_id) {
      return NextResponse.json({ error: 'falta workspace_id' }, { status: 400 });
    }
    const lock = await db.rpc('claim_billing_admin_lease', { p_workspace: c.workspace_id });
    if (lock.error || !lock.data) return NextResponse.json({ error: translate(await getLocale(), 'admin.billingConcurrentChange') }, { status: 409 });
    try {
    const previa = await leerSuscripcion(db, c.workspace_id);
    const { data: antes, error: antesError } = await db.from('workspace_subscriptions')
      .select('plan_id,estado,prueba_hasta,vencida_desde,precio_centavos_override,incluidas_override,excedente_centavos_override,modelo_cobro,nota')
      .eq('workspace_id', c.workspace_id).maybeSingle();
    if (antesError) return NextResponse.json({ error: antesError.message }, { status: 400 });
    const planes = await listarPlanes(db);
    const plan = c.plan_id
      ? planes.find((p) => p.id === c.plan_id)
      : previa?.plan;
    const modelo = c.modelo_cobro ?? previa?.modeloCobro ?? 'oficial';
    const invalidAmount = [c.precio_centavos_override, c.incluidas_override, c.excedente_centavos_override]
      .some(value => value !== undefined && value !== null &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0));
    if (c.plan_id === null || !compatibleBillingPlan(modelo, plan) || invalidAmount ||
        (modelo === 'oficial' && c.incluidas_override === 0)) {
      return NextResponse.json({ error: translate(await getLocale(), 'admin.billingInvalidAgreement') }, { status: 400 });
    }
    // Shopify must approve its own recurring charge; never only change our DB.
    if (previa?.billingProvider === 'shopify' && previa.shopifySubscriptionId &&
        ['plan_id', 'modelo_cobro', 'precio_centavos_override', 'incluidas_override', 'excedente_centavos_override', 'estado']
          .some(key => key in c)) {
      return NextResponse.json({ error: translate(await getLocale(), 'admin.billingShopifyManaged') }, { status: 409 });
    }
    if (modelo === 'oficial' && (!plan?.activo || plan.incluidas <= 0)) {
      return NextResponse.json({
        error: translate(await getLocale(), 'admin.billingOfficialPlanRequired'),
      }, { status: 400 });
    }
    if (plan?.slug === 'saldo-ilimitado' && modelo !== 'saldo') {
      return NextResponse.json({
        error: translate(await getLocale(), 'admin.billingUnlimitedRequiresBalance'),
      }, { status: 400 });
    }
    if ((plan?.slug === 'byok') !== (modelo === 'byok')) {
      return NextResponse.json({
        error: translate(await getLocale(), 'admin.billingByokPlanRequired'),
      }, { status: 400 });
    }
    const suscripcionStripeViva = previa?.billingProvider === 'stripe' &&
      Boolean(previa?.stripeSubscriptionId) &&
      (previa?.estado === 'activa' || previa?.estado === 'vencida');
    const resolvedPriceOverride = c.precio_centavos_override === undefined
      ? (antes as { precio_centavos_override?: number | null } | null)?.precio_centavos_override ?? null
      : c.precio_centavos_override;
    const nextPrice = resolvedPriceOverride ?? plan?.precioCentavos ?? 0;
    if (suscripcionStripeViva && nextPrice <= 0) return NextResponse.json({
      error: translate(await getLocale(), 'admin.billingActivePriceRequired'),
    }, { status: 400 });
    if (c.estado === 'cortesia' && suscripcionStripeViva) {
      return NextResponse.json({
        error: translate(await getLocale(), 'admin.billingCancelBeforeComping'),
      }, { status: 400 });
    }
    const fila: Record<string, unknown> = {
      workspace_id: c.workspace_id,
      updated_at: new Date().toISOString(),
    };
    // Sólo lo que vino: un PUT parcial no puede borrar el trato de una cuenta
    // porque el formulario no mandó un campo.
    if (c.plan_id !== undefined) fila.plan_id = c.plan_id || null;
    if (c.estado !== undefined) fila.estado = c.estado;
    else {
      // Con mensualidad, la cuenta espera su link para usar la IA; sin ella,
      // arranca ya.
      const override = c.precio_centavos_override !== undefined
        ? ENTERO(c.precio_centavos_override)
        : (antes as { precio_centavos_override?: number | null } | null)?.precio_centavos_override ?? null;
      const estado = estadoAlConfigurar(previa, override ?? plan?.precioCentavos ?? 0);
      if (estado) fila.estado = estado;
    }
    if (fila.estado === 'vencida' && !antes?.vencida_desde) fila.vencida_desde = new Date().toISOString();
    if (fila.estado === 'activa') fila.vencida_desde = null;
    if (c.prueba_hasta !== undefined) fila.prueba_hasta = c.prueba_hasta || null;
    else if (!previa && c.estado === 'prueba') {
      fila.prueba_hasta = new Date(Date.now() + DIAS_DE_PRUEBA * 24 * 60 * 60 * 1000).toISOString();
    }
    if (c.precio_centavos_override !== undefined)
      fila.precio_centavos_override = ENTERO(c.precio_centavos_override);
    if (c.incluidas_override !== undefined)
      fila.incluidas_override = ENTERO(c.incluidas_override);
    if (c.excedente_centavos_override !== undefined)
      fila.excedente_centavos_override = ENTERO(c.excedente_centavos_override);
    if (plan?.slug === 'saldo-ilimitado' || plan?.slug === 'byok') {
      fila.incluidas_override = null;
      fila.excedente_centavos_override = null;
    }
    if (c.modelo_cobro !== undefined) {
      if (c.modelo_cobro !== 'oficial' && c.modelo_cobro !== 'saldo' && c.modelo_cobro !== 'byok') {
        return NextResponse.json({ error: 'modelo de cobro inválido' }, { status: 400 });
      }
      fila.modelo_cobro = c.modelo_cobro;
    }
    if (c.nota !== undefined) fila.nota = c.nota?.trim() || null;

    if (previa && !suscripcionStripeViva && ['plan_id', 'modelo_cobro', 'precio_centavos_override', 'incluidas_override', 'excedente_centavos_override']
      .some(key => key in fila && fila[key] !== (antes as Record<string, unknown> | null)?.[key])) {
      try {
        await expirarCheckoutsDelAcuerdo(previa);
      } catch (error) {
        console.error('[billing] checkout expiration failed', error);
        return NextResponse.json({ error: translate(await getLocale(), 'admin.billingStripeSyncFailed') }, { status: 502 });
      }
    }

    let syncedStripe = false;
    if (previa && suscripcionStripeViva) {
      try {
        if (
          nextPrice !== previa.precioAcuerdoCentavos || modelo !== previa.modeloCobro ||
          plan?.moneda !== previa.plan?.moneda || plan?.id !== previa.plan?.id
        ) {
          await sincronizarPrecioSuscripcion(previa, nextPrice, plan?.moneda ?? 'usd', modelo,
            plan ? { planId: plan.id, planName: plan.nombre } : undefined, plan?.slug === 'saldo-ilimitado');
          syncedStripe = true;
        }
      } catch (stripeError) {
        console.error('[billing] no se pudo sincronizar Stripe', stripeError);
        return NextResponse.json({
          error: translate(await getLocale(), stripeError instanceof Error && stripeError.message === 'billing_schedule_managed'
            ? 'admin.billingScheduledAgreement' : 'admin.billingStripeSyncFailed'),
        }, { status: 502 });
      }
    }
    // Publish locally only after the provider accepts the agreement. The database
    // trigger clears auto-recharge atomically when leaving balance billing.
    const { error } = await db.from('workspace_subscriptions').upsert(fila, { onConflict: 'workspace_id' });
    if (error) return NextResponse.json({ error: translate(await getLocale(), syncedStripe
      ? 'admin.billingSyncNeedsReview' : 'admin.billingSaveFailed') }, { status: 502 });
    if (c.modelo_cobro !== undefined) invalidatePlatformKeyCache();

    await recordAdminAction(gate.actor, request, {
      action: 'update.billing_subscription',
      targetType: 'workspace',
      targetId: c.workspace_id,
      meta: { before: antes, after: fila },
    });
    return NextResponse.json({ ok: true });
    } finally {
      const release = await db.rpc('release_billing_admin_lease', { p_workspace: c.workspace_id, p_lease: lock.data });
      if (release.error) console.error('[billing] admin lease release failed', release.error.code);
    }
  }

  // Cargar saldo a mano: el bono del piloto, la disculpa por una falla, la
  // corrección de un cobro mal hecho. NO borra ni edita nada — el libro es
  // append-only, así que una corrección es otra línea. Auditado: regalar saldo
  // es regalar plata.
  if (body?.saldo) {
    const sa = body.saldo;
    const centavos = sa.centavos;
    if (!sa.workspace_id || !Number.isSafeInteger(centavos) || centavos === 0 || Math.abs(centavos) > 100000000 ||
        typeof sa.operation_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sa.operation_id) ||
        (sa.motivo != null && typeof sa.motivo !== 'string') || (sa.motivo?.length ?? 0) > 500 ||
        (centavos < 0 && !sa.motivo?.trim()) || (sa.tipo !== undefined && !['bono','ajuste'].includes(sa.tipo))) {
      return NextResponse.json({ error: translate(await getLocale(), 'admin.walletInvalidAdjustment') }, { status: 400 });
    }
    const { data, error } = await db.rpc('admin_adjust_wallet', {
      p_workspace: sa.workspace_id, p_centavos: centavos, p_operation: sa.operation_id,
      p_kind: centavos < 0 || sa.tipo === 'ajuste' ? 'ajuste' : 'bono',
      p_reason: sa.motivo?.trim() || null, p_actor: gate.actor.userId, p_actor_email: gate.actor.email,
    });
    if (error) return NextResponse.json({ error: translate(await getLocale(),
      error.message.includes('billing_balance_mode_required') ? 'admin.walletBalanceModeRequired' :
      error.message.includes('billing_insufficient_available_balance') ? 'admin.walletInsufficientAvailable' :
      error.message.includes('billing_adjustment_conflict') ? 'admin.billingConcurrentChange' : 'admin.walletInvalidAdjustment') }, { status: 409 });
    const fila = (Array.isArray(data) ? data[0] : data) as
      | { saldo_centavos?: number }
      | undefined;
    return NextResponse.json({ ok: true, saldoCentavos: fila?.saldo_centavos ?? null });
  }

  // El interruptor de "sin saldo se apaga". Se prende cuenta por cuenta: una
  // cuenta de piloto que todavía no cargó nunca no puede quedarse muda porque
  // se prendió una regla nueva.
  if (body?.billetera) {
    const bi = body.billetera;
    if ((bi.bloquear_sin_saldo !== undefined && bi.bloquear_sin_saldo !== true) ||
        (bi.cobrar_a_costo !== undefined && bi.cobrar_a_costo !== true)) return NextResponse.json({
      error: translate(await getLocale(), 'admin.walletPrepaidPolicy'),
    }, { status: 400 });
    if (!bi.workspace_id) {
      return NextResponse.json({ error: 'falta workspace_id' }, { status: 400 });
    }
    // Parcial a propósito: el formulario manda UN interruptor por vez, y un
    // upsert con el otro en `false` lo apagaría sin que nadie lo pidiera.
    const fila: Record<string, unknown> = {
      workspace_id: bi.workspace_id,
      updated_at: new Date().toISOString(),
    };
    if (bi.bloquear_sin_saldo !== undefined) {
      fila.bloquear_sin_saldo = bi.bloquear_sin_saldo === true;
    }
    if (bi.cobrar_a_costo !== undefined) {
      fila.cobrar_a_costo = bi.cobrar_a_costo === true;
    }
    const { error } = await db
      .from('wallet_accounts')
      .upsert(fila, { onConflict: 'workspace_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.wallet_blocking',
      targetType: 'workspace',
      targetId: bi.workspace_id,
      meta: {
        bloquear_sin_saldo: bi.bloquear_sin_saldo,
        cobrar_a_costo: bi.cobrar_a_costo,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // El precio de lo que consume la IA. Vive en filas justamente para esto: en
  // esta etapa se descubre probando, y compilarlo costaría un despliegue por
  // prueba. No crea conceptos nuevos — un concepto que el código no sabe cobrar
  // sería una fila que no cobra nada y nadie entendería por qué.
  if (body?.tarifa) {
    const ta = body.tarifa;
    const precio = Math.round(Number(ta.precio_milicentavos));
    if (!ta.concepto || !Number.isFinite(precio) || precio < 0) {
      return NextResponse.json({ error: 'concepto o precio inválido' }, { status: 400 });
    }
    const fila: Record<string, unknown> = {
      precio_milicentavos: precio,
      updated_at: new Date().toISOString(),
    };
    if (ta.activo !== undefined) fila.activo = ta.activo === true;
    const { error } = await db
      .from('wallet_tarifas')
      .update(fila)
      .eq('concepto', ta.concepto);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.wallet_rate',
      targetType: 'wallet_tarifa',
      targetId: ta.concepto,
      meta: { precio_milicentavos: precio, activo: ta.activo },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'nada que guardar' }, { status: 400 });
}
