import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import { recordAdminAction } from '@/lib/admin/audit';
import { listarPlanes, DIAS_DE_PRUEBA } from '@/lib/billing/plan';
import { leerNegocio } from '@/lib/billing/negocio';

/**
 * El negocio y sus perillas, en un solo lugar.
 *
 *   GET  → MRR, clientes, costo y la lista de cuentas con lo que paga cada una.
 *   PUT  { plan }   → crea o edita un plan (precio, incluidas, excedente).
 *   PUT  { cuenta } → define qué se le cobra a UNA cuenta.
 *
 * Las dos escrituras existen porque el precio no puede vivir en el código: en
 * esta etapa se está descubriendo, y cada prueba costaría un despliegue. Y
 * porque a los primeros comercios se les instala gratis, lo que no es apagar la
 * facturación sino ponerles `cortesia` — así siguen contando en el cuadro, con
 * su costo real y MRR 0, en vez de desaparecer de él.
 *
 * Se auditan las dos: «a este comercio se lo dejamos gratis» es una decisión
 * que en seis meses nadie recuerda haber tomado.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);
  return adminGet(request, { action: 'view.billing' }, async () => {
    const db = supabaseAdmin();
    const [planes, negocio] = await Promise.all([
      listarPlanes(db),
      leerNegocio(db, { desde: from, hasta: to }),
    ]);
    return { planes, negocio, diasDePrueba: DIAS_DE_PRUEBA };
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
  nota?: string | null;
}

interface CuerpoSaldo {
  workspace_id: string;
  /** Firmado: positivo regala, negativo corrige de más. */
  centavos: number;
  tipo?: 'bono' | 'ajuste';
  motivo?: string | null;
}

interface CuerpoBilletera {
  workspace_id: string;
  bloquear_sin_saldo: boolean;
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
  } | null;
  const db = supabaseAdmin();

  if (body?.plan) {
    const p = body.plan;
    if (!p.slug?.trim() || !p.nombre?.trim()) {
      return NextResponse.json({ error: 'falta slug o nombre' }, { status: 400 });
    }
    const fila = {
      slug: p.slug.trim(),
      nombre: p.nombre.trim(),
      activo: p.activo !== false,
      precio_centavos: ENTERO(p.precio_centavos) ?? 0,
      moneda: (p.moneda ?? 'usd').toLowerCase(),
      incluidas: ENTERO(p.incluidas) ?? 0,
      excedente_centavos: ENTERO(p.excedente_centavos) ?? 0,
      stripe_price_id: p.stripe_price_id?.trim() || null,
      stripe_price_excedente_id: p.stripe_price_excedente_id?.trim() || null,
      orden: ENTERO(p.orden) ?? 0,
      updated_at: new Date().toISOString(),
    };
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
    const fila: Record<string, unknown> = {
      workspace_id: c.workspace_id,
      updated_at: new Date().toISOString(),
    };
    // Sólo lo que vino: un PUT parcial no puede borrar el trato de una cuenta
    // porque el formulario no mandó un campo.
    if (c.plan_id !== undefined) fila.plan_id = c.plan_id || null;
    if (c.estado !== undefined) fila.estado = c.estado;
    if (c.prueba_hasta !== undefined) fila.prueba_hasta = c.prueba_hasta || null;
    if (c.precio_centavos_override !== undefined)
      fila.precio_centavos_override = ENTERO(c.precio_centavos_override);
    if (c.incluidas_override !== undefined)
      fila.incluidas_override = ENTERO(c.incluidas_override);
    if (c.excedente_centavos_override !== undefined)
      fila.excedente_centavos_override = ENTERO(c.excedente_centavos_override);
    if (c.nota !== undefined) fila.nota = c.nota?.trim() || null;

    const { error } = await db
      .from('workspace_subscriptions')
      .upsert(fila, { onConflict: 'workspace_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.billing_subscription',
      targetType: 'workspace',
      targetId: c.workspace_id,
      meta: { estado: c.estado, nota: c.nota },
    });
    return NextResponse.json({ ok: true });
  }

  // Cargar saldo a mano: el bono del piloto, la disculpa por una falla, la
  // corrección de un cobro mal hecho. NO borra ni edita nada — el libro es
  // append-only, así que una corrección es otra línea. Auditado: regalar saldo
  // es regalar plata.
  if (body?.saldo) {
    const sa = body.saldo;
    const centavos = Math.round(Number(sa.centavos));
    if (!sa.workspace_id || !Number.isFinite(centavos) || centavos === 0) {
      return NextResponse.json({ error: 'falta workspace_id o monto' }, { status: 400 });
    }
    const tipo = sa.tipo === 'ajuste' ? 'ajuste' : 'bono';
    const { data, error } = await db.rpc('wallet_mover', {
      p_workspace: sa.workspace_id,
      p_tipo: tipo,
      p_concepto: tipo,
      p_centavos: centavos,
      p_costo: 0,
      p_cantidad: null,
      p_unidad: null,
      p_referencia_tipo: 'admin',
      p_referencia_id: gate.actor?.userId ?? null,
      p_stripe_id: null,
      p_detalle: { motivo: sa.motivo?.trim() || null },
      p_creado_por: gate.actor?.userId ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.wallet_balance',
      targetType: 'workspace',
      targetId: sa.workspace_id,
      meta: { centavos, tipo, motivo: sa.motivo ?? null },
    });
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
    if (!bi.workspace_id) {
      return NextResponse.json({ error: 'falta workspace_id' }, { status: 400 });
    }
    const { error } = await db.from('wallet_accounts').upsert(
      {
        workspace_id: bi.workspace_id,
        bloquear_sin_saldo: bi.bloquear_sin_saldo === true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id' },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    await recordAdminAction(gate.actor, request, {
      action: 'update.wallet_blocking',
      targetType: 'workspace',
      targetId: bi.workspace_id,
      meta: { bloquear_sin_saldo: bi.bloquear_sin_saldo === true },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'nada que guardar' }, { status: 400 });
}
