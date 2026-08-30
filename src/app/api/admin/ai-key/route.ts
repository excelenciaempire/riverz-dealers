import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { decrypt } from '@/lib/whatsapp/encryption';
import { invalidatePlatformKeyCache } from '@/lib/ai/platform-key';
import { adminGet } from '@/lib/admin/route';
import { leerCostoIa } from '@/lib/admin/costo-ia';
import { pistaDe } from '@/lib/admin/claves';
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

  const [settingsRes, enabledRes, usage, costo] = await Promise.all([
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
    // El gasto por bolsillo sale del desglose guardado, no de una regla de
    // tres. Ver migración 230.
    leerCostoIa(db, { desde: new Date(since), hasta: new Date() }),
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

  // Gasto por bolsillo, del desglose guardado.
  //
  // Antes se repartía el costo total del comercio en la PROPORCIÓN DE TOKENS de
  // cada bolsillo, y eso no es el costo: entre Haiku (1 USD/M) y Opus (5 USD/M)
  // la proporción de tokens no es la proporción de plata. Ahora cada respuesta
  // deja anotado su costo y su `key_source` al acumular el día, así que el
  // corte es exacto y coincide con /admin/uso porque salen del mismo lugar.
  //
  // Las filas anteriores a la migración 230 no traen desglose: ahí `platform`
  // vale cero y todo el costo aparece como del comercio. Es el sesgo honesto —
  // no se puede reconstruir quién puso una plata que nadie anotó.
  const workspaces = usage.map((row) => {
    const linea = costo.porCuenta.get(row.workspace_id);
    const total = linea?.costoUsd ?? 0;
    const bySource = row.tokens_by_source ?? {};
    const parte = (k: string) => (k === 'platform' ? (linea?.costoPlataformaUsd ?? 0) : 0);

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
    mcp: await mcpStatus(db),
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

/**
 * Estado de la puerta MCP.
 *
 * Es la otra vía por la que la IA toca las cuentas —un agente hablando con
 * `/api/mcp`— y no tenía ninguna superficie: no se veía si la clave estaba
 * puesta ni si alguien la había usado. Va en esta pantalla, que ya es "quién
 * paga la IA y qué hace", en vez de inventar una sección nueva.
 */
async function mcpStatus(db: ReturnType<typeof supabaseAdmin>) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  try {
    const { data } = await db
      .from('platform_audit_log')
      .select('tool, risk, ok, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    const rows = (data ?? []) as Array<{ tool: string; ok: boolean }>;
    const porHerramienta = new Map<string, number>();
    for (const r of rows) porHerramienta.set(r.tool, (porHerramienta.get(r.tool) ?? 0) + 1);
    return {
      // Sin token la puerta rechaza todo, que es el estado por defecto.
      enabled: Boolean(process.env.MCP_ADMIN_TOKEN),
      calls_7d: rows.length,
      failed_7d: rows.filter((r) => !r.ok).length,
      top_tools: [...porHerramienta.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tool, n]) => ({ tool, n })),
    };
  } catch {
    // La migración 150 puede no estar aplicada; no es motivo para tumbar la
    // pantalla entera.
    return { enabled: Boolean(process.env.MCP_ADMIN_TOKEN), calls_7d: 0, failed_7d: 0, top_tools: [] };
  }
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    mode?: string;
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

  // Esta ruta ya NO escribe la clave.
  //
  // La escribían dos: acá y `PUT /api/admin/claves`, las dos sobre la misma
  // columna `platform_ai_settings.anthropic_key_encrypted`, y cada pantalla
  // mostraba una pista distinta de la misma clave —«…7f2a» contra
  // «sk-ant-…7f2a»— así que parecían dos llaves diferentes. Dos escritores para
  // un dato es una discusión sobre cuál gana el día que se toquen a la vez.
  // Queda el de Llaves, que además valida el prefijo y refresca la caché.

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
    meta: { mode: body.mode ?? null },
  });

  return NextResponse.json({ ok: true });
}

/**
 * La pista de la clave, con el MISMO formato que la pantalla de Llaves.
 *
 * Devolvía «…7f2a» mientras Llaves mostraba «sk-ant-…7f2a» de la misma clave,
 * así que las dos pantallas del mismo panel parecían hablar de dos llaves
 * distintas. Una sola función, una sola pista.
 */
function keyHint(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    return pistaDe(decrypt(encrypted));
  } catch {
    return null;
  }
}
