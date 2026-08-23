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

  return NextResponse.json({ error: 'nada que guardar' }, { status: 400 });
}
