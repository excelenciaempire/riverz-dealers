import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { isWorkspaceAdmin } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import {
  leerReglasDeCobro,
  normalizarTolerancia,
  TOLERANCIA_MAXIMA,
} from '@/lib/payments/reglas-de-cobro';

/**
 * Con qué pruebas la IA da un pedido por cobrado sola.
 *
 * Vive acá y no en los ajustes del agente porque es de la CUENTA: cuándo se da
 * la plata por recibida es una decisión del negocio y no cambia porque el
 * cliente haya escrito por Instagram en vez de por WhatsApp. Mismo lugar y
 * mismo criterio que el tope de descuento.
 */
export const dynamic = 'force-dynamic';

async function resolver(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }

  const workspaceId =
    new URL(request.url).searchParams.get('workspace_id') ??
    (await request
      .clone()
      .json()
      .then((b) => (b as { workspace_id?: string })?.workspace_id)
      .catch(() => null));
  if (!workspaceId) {
    return { error: NextResponse.json({ error: 'bad_request' }, { status: 400 }) };
  }

  const { data: miembro } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  // 404 y no 403: quien no es de la cuenta no tiene por qué enterarse de que
  // existe.
  if (!miembro) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }

  return { userId: user.id, workspaceId };
}

export async function GET(request: Request) {
  const r = await resolver(request);
  if ('error' in r) return r.error;

  const reglas = await leerReglasDeCobro(supabaseAdmin(), r.workspaceId);
  return NextResponse.json({ reglas, toleranciaMaxima: TOLERANCIA_MAXIMA });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const r = await resolver(request);
  if ('error' in r) return r.error;

  // Decidir con qué se da la plata por recibida es de administración, como
  // conectar un cobro o fijar cuánto se puede descontar.
  if (!(await isWorkspaceAdmin(supabaseAdmin(), r.userId, r.workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    exige_comprobante?: unknown;
    un_solo_pendiente?: unknown;
    exige_referencia?: unknown;
    tolerancia_pct?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Sólo lo que viene: la pantalla manda el bloque entero, pero un cliente que
  // toque un solo campo no tiene por qué reescribir los otros tres.
  const parche: Record<string, unknown> = { workspace_id: r.workspaceId };
  if (typeof body.exige_comprobante === 'boolean')
    parche.pago_exige_comprobante = body.exige_comprobante;
  if (typeof body.un_solo_pendiente === 'boolean')
    parche.pago_un_solo_pendiente = body.un_solo_pendiente;
  if (typeof body.exige_referencia === 'boolean')
    parche.pago_exige_referencia = body.exige_referencia;
  if (body.tolerancia_pct !== undefined)
    parche.pago_tolerancia_pct = normalizarTolerancia(body.tolerancia_pct);

  // `upsert` y no `update`: la fila de configuración de checkout se crea al
  // conectar la tienda, y esto tiene que poder fijarse antes.
  const { error } = await supabaseAdmin()
    .from('workspace_checkout_config')
    .upsert(parche, { onConflict: 'workspace_id' });
  if (error) {
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 502 });
  }

  const reglas = await leerReglasDeCobro(supabaseAdmin(), r.workspaceId);
  return NextResponse.json({ ok: true, reglas });
}
