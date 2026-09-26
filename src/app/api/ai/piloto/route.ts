import { NextResponse } from 'next/server';
import { serverError } from '@/lib/api/errors';
import { csrfGuard } from '@/lib/csrf';
import { COLUMNAS_PILOTO, leerLimite, leerNumeros, type Piloto } from '@/lib/piloto';
import { puertaDeIa } from '@/lib/wallet/puerta';
import { cuentaDeSesion } from '@/lib/workspaces/cuenta-de-sesion';

/**
 * El piloto en vivo del comercio (`lib/piloto`).
 *
 * GET   /api/ai/piloto → { piloto, estado }
 *       el piloto en curso (o el último) y qué más hace falta para que corra.
 * POST  /api/ai/piloto { canales, limite_mensajes, limite_comentarios,
 *       limite_automatizaciones, solo_numeros } → { piloto }
 *       guarda la configuración (borrador, o el piloto en curso).
 * PATCH /api/ai/piloto { accion: 'iniciar' | 'produccion' | 'descartar' }
 *       iniciar: empieza a contar. produccion: termina el piloto y todo sigue
 *       sin límites. descartar: borra un borrador.
 */

const CANALES_VALIDOS = new Set([
  'whatsapp',
  'instagram',
  'messenger',
  'webchat',
  'gmail',
  'outlook',
  'zoho',
  'mercadolibre',
  'ig_comment',
  'fb_comment',
  'tiktok_comment',
]);

export async function GET() {
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId } = c;
  const [{ data: piloto }, { data: ws }, { data: agentes }, { count: autos }, { data: canales }] = await Promise.all([
    admin
      .from('ai_pilotos')
      .select(COLUMNAS_PILOTO)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('workspaces').select('motor_apagado_at, suspended_at').eq('id', workspaceId).maybeSingle(),
    admin.from('ai_agents').select('name, is_active').eq('workspace_id', workspaceId).is('deleted_at', null),
    admin
      .from('automations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .is('deleted_at', null),
    admin.from('channel_connections').select('channel').eq('workspace_id', workspaceId).eq('status', 'connected'),
  ]);
  const cuenta = ws as { motor_apagado_at?: string | null; suspended_at?: string | null } | null;
  const puerta = await puertaDeIa(admin, workspaceId);
  return NextResponse.json(
    {
      piloto: (piloto as Piloto | null) ?? null,
      estado: {
        motor_encendido: !cuenta?.motor_apagado_at && !cuenta?.suspended_at,
        // Con la operación encendida la IA igual puede estar callada: sin
        // pagar, sin saldo, con la suscripción vencida.
        ia_habilitada: puerta.puede,
        ia_motivo: puerta.puede ? null : (puerta.motivo ?? null),
        asistentes: ((agentes ?? []) as Array<{ name: string; is_active: boolean }>).map((a) => ({
          nombre: a.name,
          activo: a.is_active,
        })),
        automatizaciones_activas: autos ?? 0,
        canales: [...new Set(((canales ?? []) as Array<{ channel: string }>).map((x) => x.channel))],
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId, userId } = c;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const config = {
    canales: (Array.isArray(body?.canales) ? body.canales : []).filter(
      (x): x is string => typeof x === 'string' && CANALES_VALIDOS.has(x)
    ),
    limite_mensajes: leerLimite(body?.limite_mensajes),
    limite_comentarios: leerLimite(body?.limite_comentarios),
    limite_automatizaciones: leerLimite(body?.limite_automatizaciones),
    solo_numeros: leerNumeros(body?.solo_numeros),
    updated_at: new Date().toISOString(),
  };

  const { data: vivo } = await admin
    .from('ai_pilotos')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('estado', ['borrador', 'activo', 'agotado'])
    .limit(1)
    .maybeSingle();
  const { data, error } = vivo
    ? await admin
        .from('ai_pilotos')
        .update(config)
        .eq('id', (vivo as { id: string }).id)
        .select(COLUMNAS_PILOTO)
        .single()
    : await admin
        .from('ai_pilotos')
        .insert({ ...config, workspace_id: workspaceId, created_by: userId })
        .select(COLUMNAS_PILOTO)
        .single();
  if (error) return serverError(error);
  return NextResponse.json({ piloto: data });
}

export async function PATCH(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const c = await cuentaDeSesion();
  if ('error' in c) return c.error;
  const { admin, workspaceId } = c;
  const body = (await request.json().catch(() => null)) as { accion?: unknown } | null;
  const ahora = new Date().toISOString();

  if (body?.accion === 'iniciar') {
    const { data, error } = await admin
      .from('ai_pilotos')
      .update({ estado: 'activo', iniciado_at: ahora, terminado_at: null, updated_at: ahora })
      .eq('workspace_id', workspaceId)
      .eq('estado', 'borrador')
      .select(COLUMNAS_PILOTO)
      .maybeSingle();
    if (error) return serverError(error);
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ piloto: data });
  }
  if (body?.accion === 'produccion') {
    const { data, error } = await admin
      .from('ai_pilotos')
      .update({ estado: 'terminado', terminado_at: ahora, updated_at: ahora })
      .eq('workspace_id', workspaceId)
      .in('estado', ['activo', 'agotado'])
      .select(COLUMNAS_PILOTO)
      .maybeSingle();
    if (error) return serverError(error);
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ piloto: data });
  }
  if (body?.accion === 'descartar') {
    const { error } = await admin.from('ai_pilotos').delete().eq('workspace_id', workspaceId).eq('estado', 'borrador');
    if (error) return serverError(error);
    return NextResponse.json({ piloto: null });
  }
  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}
