import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { serverError } from '@/lib/api/errors';

/**
 * Configuración de checkout IA (por workspace) que alimenta la tool
 * `create_checkout` del runner (src/lib/shopify/create-checkout.ts).
 *
 *   GET — devuelve la fila de `workspace_checkout_config` del workspace.
 *   PUT — la crea/actualiza (upsert). RLS exige rol admin para escribir.
 *
 * La tabla la respalda la migración 077. RLS = member SELECT + admin
 * writes, así que el cliente cookie/RLS ya impone admin-only en el upsert.
 */

interface CheckoutOfferRow {
  key: string;
  label: string;
  qty: number;
  total: number;
  compare_at?: number | null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'Sin workspace' }, { status: 403 });
  }

  const { data } = await supabase
    .from('workspace_checkout_config')
    .select(
      'enabled, currency, offers, transfer_discount_amount, transfer_discount_label, payment_methods, default_variant_id',
    )
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  const row = data as {
    enabled: boolean;
    currency: string | null;
    offers: CheckoutOfferRow[] | null;
    transfer_discount_amount: number | null;
    transfer_discount_label: string | null;
    payment_methods: string[] | null;
    default_variant_id: string | null;
  } | null;

  return NextResponse.json({
    enabled: row?.enabled ?? false,
    currency: row?.currency ?? null,
    offers: row?.offers ?? null,
    transfer_discount_amount: row?.transfer_discount_amount ?? null,
    transfer_discount_label: row?.transfer_discount_label ?? null,
    payment_methods: row?.payment_methods ?? null,
    default_variant_id: row?.default_variant_id ?? null,
  });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'Sin workspace' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  // ── Validación ─────────────────────────────────────────────────────
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled debe ser booleano' }, { status: 400 });
  }

  const currency =
    body.currency == null
      ? null
      : typeof body.currency === 'string'
        ? body.currency.trim() || null
        : undefined;
  if (currency === undefined) {
    return NextResponse.json({ error: 'currency debe ser texto o null' }, { status: 400 });
  }

  if (!Array.isArray(body.offers)) {
    return NextResponse.json({ error: 'offers debe ser un arreglo' }, { status: 400 });
  }
  const offers: CheckoutOfferRow[] = [];
  for (const raw of body.offers) {
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'Oferta inválida' }, { status: 400 });
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.key !== 'string' || !o.key.trim()) {
      return NextResponse.json({ error: 'Cada oferta necesita una clave' }, { status: 400 });
    }
    if (typeof o.label !== 'string' || !o.label.trim()) {
      return NextResponse.json({ error: 'Cada oferta necesita una etiqueta' }, { status: 400 });
    }
    if (typeof o.qty !== 'number' || !Number.isFinite(o.qty) || o.qty <= 0) {
      return NextResponse.json(
        { error: 'La cantidad de cada oferta debe ser mayor a 0' },
        { status: 400 },
      );
    }
    if (typeof o.total !== 'number' || !Number.isFinite(o.total) || o.total < 0) {
      return NextResponse.json(
        { error: 'El total de cada oferta no puede ser negativo' },
        { status: 400 },
      );
    }
    let compareAt: number | null = null;
    if (o.compare_at != null) {
      if (typeof o.compare_at !== 'number' || !Number.isFinite(o.compare_at)) {
        return NextResponse.json(
          { error: 'El precio comparativo debe ser un número' },
          { status: 400 },
        );
      }
      compareAt = o.compare_at;
    }
    offers.push({
      key: o.key.trim(),
      label: o.label.trim(),
      qty: o.qty,
      total: o.total,
      compare_at: compareAt,
    });
  }

  let transferDiscountAmount: number | null = null;
  if (body.transfer_discount_amount != null) {
    if (
      typeof body.transfer_discount_amount !== 'number' ||
      !Number.isFinite(body.transfer_discount_amount)
    ) {
      return NextResponse.json(
        { error: 'transfer_discount_amount debe ser un número o null' },
        { status: 400 },
      );
    }
    transferDiscountAmount = body.transfer_discount_amount;
  }

  let transferDiscountLabel: string | null = null;
  if (body.transfer_discount_label != null) {
    if (typeof body.transfer_discount_label !== 'string') {
      return NextResponse.json(
        { error: 'transfer_discount_label debe ser texto o null' },
        { status: 400 },
      );
    }
    transferDiscountLabel = body.transfer_discount_label.trim() || null;
  }

  let paymentMethods: string[] | null = null;
  if (body.payment_methods != null) {
    if (
      !Array.isArray(body.payment_methods) ||
      !body.payment_methods.every((m: unknown) => typeof m === 'string')
    ) {
      return NextResponse.json(
        { error: 'payment_methods debe ser un arreglo de texto o null' },
        { status: 400 },
      );
    }
    paymentMethods = (body.payment_methods as string[])
      .map((m) => m.trim())
      .filter(Boolean);
  }

  let defaultVariantId: string | null = null;
  if (body.default_variant_id != null) {
    if (typeof body.default_variant_id !== 'string') {
      return NextResponse.json(
        { error: 'default_variant_id debe ser texto o null' },
        { status: 400 },
      );
    }
    defaultVariantId = body.default_variant_id.trim() || null;
  }

  const { error } = await supabase.from('workspace_checkout_config').upsert(
    {
      workspace_id: workspaceId,
      enabled: body.enabled,
      currency,
      offers,
      transfer_discount_amount: transferDiscountAmount,
      transfer_discount_label: transferDiscountLabel,
      payment_methods: paymentMethods,
      default_variant_id: defaultVariantId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );
  if (error) {
    return serverError(error, 'No se pudo guardar la configuración de checkout');
  }

  return NextResponse.json({ success: true });
}
