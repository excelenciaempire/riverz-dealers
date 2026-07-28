import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { invalidatePlatformKeyCache } from '@/lib/ai/platform-key';
import { costForModel } from '@/lib/admin/cost';

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

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const db = supabaseAdmin();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const [settingsRes, enabledRes, workspacesRes, repliesRes] = await Promise.all([
    db
      .from('platform_ai_settings')
      .select('mode, anthropic_key_encrypted, updated_at')
      .eq('id', true)
      .maybeSingle(),
    db.from('platform_ai_workspaces').select('workspace_id, enabled'),
    db.from('workspaces').select('id, name').order('name'),
    db
      .from('ai_replies')
      .select('workspace_id, key_source, prompt_tokens, completion_tokens, status')
      .gte('created_at', since)
      .limit(50_000),
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

  // Gasto por comercio y por bolsillo. El modelo no se guarda por respuesta,
  // así que se tarifa con el modelo por defecto: sirve para comparar cuentas
  // entre sí y dimensionar el precio, que es para lo que se mira esta pantalla.
  const spend = new Map<string, { platform: number; own: number; calls: number }>();
  for (const r of (repliesRes.data ?? []) as {
    workspace_id: string;
    key_source: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    status: string;
  }[]) {
    if (r.status !== 'sent') continue;
    const cur = spend.get(r.workspace_id) ?? { platform: 0, own: 0, calls: 0 };
    const usd = costForModel(null, r.prompt_tokens ?? 0, r.completion_tokens ?? 0);
    if (r.key_source === 'platform') cur.platform += usd;
    else cur.own += usd;
    cur.calls += 1;
    spend.set(r.workspace_id, cur);
  }

  const mode = settings?.mode ?? 'selected';
  const encKey = settings?.anthropic_key_encrypted ?? null;

  const workspaces = ((workspacesRes.data ?? []) as { id: string; name: string }[]).map(
    (w) => {
      const s = spend.get(w.id);
      return {
        id: w.id,
        name: w.name,
        covered: mode === 'all' ? true : enabledSet.has(w.id),
        explicit: enabledSet.has(w.id),
        calls: s?.calls ?? 0,
        spend_platform_usd: Number((s?.platform ?? 0).toFixed(4)),
        spend_own_usd: Number((s?.own ?? 0).toFixed(4)),
      };
    },
  );

  return NextResponse.json({
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
  });
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
