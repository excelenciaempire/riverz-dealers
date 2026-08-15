import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { invalidatePlatformKeyCache } from '@/lib/ai/platform-key';
import { adminGet } from '@/lib/admin/route';
import { estimateAiCostUsd } from '@/lib/admin/cost';
import { listUsage } from '@/lib/admin/queries';

/**
 * Clave de IA de la plataforma (solo equipo Riverz).
 *
 *   GET → modo, si hay clave cargada (nunca la clave), y una fila por comercio
 *         con si está cubierto y cuánto lleva gastado con cada bolsillo.
 *   PUT → cambia el modo y/o carga una clave nueva.
 *
 * La clave SÓLO viaja hacia adentro. Al salir se devuelven los últimos cuatro
 * caracteres, lo justo para reconocer cuál está puesta sin que el panel
 * convierta un acceso de lectura en una filtración de credenciales.
 */

const DAYS = 30;

export async function GET(request: Request) {
  return adminGet(request, { action: 'view.ai_key' }, () => aiKeyPayload());
}

/** El cuerpo de la pantalla: modo, si hay clave, y el gasto por comercio. */
async function aiKeyPayload() {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const [settingsRes, enabledRes, usage] = await Promise.all([
    db
      .from('platform_ai_settings')
      .select('mode, anthropic_key_encrypted, updated_at')
      .eq('id', true)
      .maybeSingle(),
    db.from('platform_ai_workspaces').select('workspace_id, enabled'),
    // El mismo RPC que /admin/uso, en vez de un barrido propio.
    //
    // Antes esta ruta se traía hasta 50.000 filas de `ai_replies` a Node y las
    // sumaba en JS con `costForModel(null, …)`, o sea tarifando TODO al modelo
    // más barato: el mismo comercio mostraba dos costos distintos en dos
    // pantallas del mismo panel, y pasadas las 50.000 filas el número quedaba
    // corto sin avisar. Además listaba `workspaces` sin filtrar `deleted_at`.
    listUsage(new Date(since), new Date()),
  ]);

  const settings = settingsRes.data as {
    mode?: string;
    anthropic_key_encrypted?: string | null;
    updated_at?: string;
  } | null;

  const enabledSet = new Set(
    ((enabledRes.data ?? []) as { workspace_id: string; enabled: boolean }[])
      .filter((r) => r.enabled)
      .map((r) => r.workspace_id),
  );

  const mode = settings?.mode ?? 'selected';
  const encKey = settings?.anthropic_key_encrypted ?? null;

  // Gasto por bolsillo, con la MISMA tarifa por modelo que /admin/uso.
  //
  // El desglose por modelo y el desglose por bolsillo son dos cortes de los
  // mismos tokens, así que se reparte el costo total del comercio en la
  // proporción de tokens de cada bolsillo. Es una estimación —igual que todo
  // este número, que son precios de lista sin descuento por caché— pero es UNA,
  // y coincide con la otra pantalla.
  const workspaces = usage.map((row) => {
    const total = estimateAiCostUsd(
      row.prompt_tokens,
      row.completion_tokens,
      row.tokens_by_model,
    );
    const bySource = row.tokens_by_source ?? {};
    const tokensDe = (k: string) =>
      (bySource[k]?.prompt ?? 0) + (bySource[k]?.completion ?? 0);
    const tokensTotal = Object.values(bySource).reduce(
      (a, v) => a + (v?.prompt ?? 0) + (v?.completion ?? 0),
      0,
    );
    const parte = (k: string) =>
      tokensTotal > 0 ? (total * tokensDe(k)) / tokensTotal : 0;

    return {
      id: row.workspace_id,
      name: row.workspace_name,
      covered: mode === 'all' ? true : enabledSet.has(row.workspace_id),
      explicit: enabledSet.has(row.workspace_id),
      calls: Object.values(bySource).reduce((a, v) => a + (v?.calls ?? 0), 0),
      spend_platform_usd: Number(parte('platform').toFixed(4)),
      spend_own_usd: Number((total - parte('platform')).toFixed(4)),
    };
  });

  return {
    mode,
    has_key: !!encKey,
    key_hint: keyHint(encKey),
    updated_at: settings?.updated_at ?? null,
    days: DAYS,
    workspaces,
    totals: {
      platform_usd: Number(
        workspaces.reduce((a, w) => a + w.spend_platform_usd, 0).toFixed(4),
      ),
      own_usd: Number(workspaces.reduce((a, w) => a + w.spend_own_usd, 0).toFixed(4)),
      covered: workspaces.filter((w) => w.covered).length,
    },
  };
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    mode?: string;
    key?: string;
  } | null;
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 });

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: gate.actor.userId,
  };

  if (body.mode !== undefined) {
    if (!['all', 'selected', 'off'].includes(body.mode)) {
      return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
    }
    patch.mode = body.mode;
  }

  if (body.key !== undefined) {
    const key = body.key.trim();
    // Vacío = quitar la clave. Cualquier otra cosa tiene que parecerse a una
    // clave de Anthropic: pegar por error un token de otro servicio dejaría la
    // plataforma sin IA y el fallo aparecería recién en la próxima respuesta.
    if (key && !key.startsWith('sk-ant-')) {
      return NextResponse.json(
        { error: 'la clave de Anthropic empieza por sk-ant-' },
        { status: 400 },
      );
    }
    patch.anthropic_key_encrypted = key ? encrypt(key) : null;
  }

  const { error } = await supabaseAdmin()
    .from('platform_ai_settings')
    .update(patch)
    .eq('id', true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidatePlatformKeyCache();

  await recordAdminAction(gate.actor, request, {
    action: 'update.platform_ai_key',
    targetType: 'platform_ai_settings',
    targetId: 'singleton',
    // Nunca la clave, ni un fragmento: sólo que se tocó.
    meta: { mode: body.mode ?? null, key_changed: body.key !== undefined },
  });

  return NextResponse.json({ ok: true });
}

/** Últimos cuatro caracteres, para reconocer cuál está puesta. */
function keyHint(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    const k = decrypt(encrypted);
    return k.length > 4 ? `…${k.slice(-4)}` : null;
  } catch {
    return null;
  }
}
