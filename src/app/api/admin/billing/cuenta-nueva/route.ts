import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { ensureWorkspace } from '@/lib/workspaces/ensure';
import { planPorDefecto } from '@/lib/billing/plan';

/**
 * Dar de alta un comercio desde el panel, con su trato ya definido.
 *
 * En esta etapa las cuentas no se crean solas: se le instala Riverz a un
 * comercio concreto, casi siempre sin cargo. Hasta ahora eso significaba pedirle
 * que se registrara y después buscarlo en una lista para configurarlo — dos
 * pasos y una ventana en la que la cuenta existe con un trato que nadie eligió.
 *
 * Acá se hace de una: se invita al correo, se le arma el workspace y se le deja
 * la suscripción escrita en el mismo movimiento.
 *
 * La invitación la manda Supabase Auth. NO se le fija contraseña a nadie desde
 * el panel: quien entra a una cuenta tiene que ser quien recibió el correo, y
 * una contraseña puesta por el equipo es una cuenta que el equipo puede abrir.
 */
export const dynamic = 'force-dynamic';

interface Cuerpo {
  email: string;
  nombre?: string;
  estado?: 'prueba' | 'activa' | 'cortesia';
  nota?: string;
  precio_centavos?: number | null;
  plan_id?: string;
  modelo_cobro?: 'oficial' | 'saldo';
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as Cuerpo | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'correo inválido' }, { status: 400 });
  }

  const db = supabaseAdmin();
  const plan = body?.plan_id
    ? (await db.from('billing_plans').select('id,activo').eq('id', body.plan_id).maybeSingle()).data
    : await planPorDefecto(db);
  if (!plan?.activo) {
    return NextResponse.json({ error: 'plan inválido' }, { status: 400 });
  }
  const nombre = body?.nombre?.trim() || `${email.split('@')[0]}'s workspace`;

  // Si el correo ya tiene cuenta, se reusa: invitar de nuevo daría error y
  // dejaría al operador sin saber si el comercio existe o no.
  const { data: lista } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const ya = lista?.users.find((u) => u.email?.toLowerCase() === email);

  let userId = ya?.id ?? null;
  let invitado = false;
  if (!userId) {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { workspace_name: nombre },
    });
    if (error || !data?.user) {
      return NextResponse.json(
        { error: error?.message ?? 'no se pudo invitar' },
        { status: 400 },
      );
    }
    userId = data.user.id;
    invitado = true;
  }

  const workspaceId = await ensureWorkspace(db, userId, email, {
    workspace_name: nombre,
  });
  if (!workspaceId) {
    return NextResponse.json({ error: 'no se pudo crear la cuenta' }, { status: 500 });
  }

  const estado = body?.estado ?? 'cortesia';
  const { error: subErr } = await db.from('workspace_subscriptions').upsert(
    {
      workspace_id: workspaceId,
      plan_id: plan?.id ?? null,
      estado,
      modelo_cobro: body?.modelo_cobro === 'saldo' ? 'saldo' : 'oficial',
      // La prueba sólo tiene sentido si el estado es prueba. En cortesía, una
      // fecha de vencimiento guardada es una bomba de tiempo escrita al lado
      // de un acuerdo que dice lo contrario.
      prueba_hasta:
        estado === 'prueba'
          ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
          : null,
      precio_centavos_override:
        typeof body?.precio_centavos === 'number' ? body.precio_centavos : null,
      nota: body?.nota?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id' },
  );
  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 400 });

  await recordAdminAction(gate.actor, request, {
    action: 'update.billing_subscription',
    targetType: 'workspace',
    targetId: workspaceId,
    meta: {
      alta: true,
      email,
      estado,
      modelo_cobro: body?.modelo_cobro === 'saldo' ? 'saldo' : 'oficial',
      invitado,
    },
  });

  return NextResponse.json({ ok: true, workspaceId, invitado });
}
