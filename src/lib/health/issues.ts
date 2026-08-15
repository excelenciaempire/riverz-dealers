/**
 * Lo que se rompió sin que nadie se entere.
 *
 * El peor modo de falla de Riverz no es un error en pantalla: es el mensaje
 * que nunca salió. Pasó el 2026-08-14 con dos carritos abandonados — la espera
 * no se pudo encolar, las corridas quedaron dormidas en "parcial" y los dos
 * clientes nunca recibieron nada. Se descubrió porque alguien abrió la pantalla
 * de la automatización y le pareció rara. Eso no es un sistema de avisos.
 *
 * Acá se junta, en un solo lugar y sobre las tablas que ya existen, todo lo que
 * significa "esto necesita tu atención". Sin tabla nueva a propósito: un
 * inventario de problemas que hay que mantener al día se desincroniza; esto se
 * calcula cada vez que se pregunta, así que no puede mentir.
 *
 * Regla de qué entra: sólo lo accionable por el comercio y lo que ya pasó. Un
 * aviso que no se puede atender es ruido, y a la tercera vez que aparece deja
 * de leerse — con él, todos los demás.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type IssueSeverity = 'critical' | 'warning';

export interface Issue {
  /** Clave estable; la UI la traduce y decide el link. */
  kind:
    | 'automation_stuck'
    | 'automation_failed'
    | 'sends_failing'
    | 'whatsapp_blocked'
    | 'connection_error'
    | 'template_rejected'
    | 'broadcast_stalled'
    | 'system_error';
  severity: IssueSeverity;
  /** Cuántas cosas caen bajo este aviso (mensajes, corridas, conexiones). */
  count: number;
  /** Detalle corto y concreto: un nombre, un motivo, un canal. */
  detail?: string | null;
  /** A dónde va el comercio a resolverlo (ruta canónica, en español). */
  href: string;
}

/** Una corrida dormida más de esto ya no está esperando: está trabada. */
const STUCK_RUN_HOURS = 2;
/** Ventana para contar fallas de envío. */
const FAILURE_WINDOW_HOURS = 6;
/** Menos que esto es ruido normal (un número mal escrito, un bloqueo puntual). */
const FAILURE_MIN = 3;

export async function collectWorkspaceIssues(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue[]> {
  const now = Date.now();
  const issues: Issue[] = [];

  const [stuck, failed, failing, connections, templates, broadcasts, system] =
    await Promise.all([
      stuckRuns(db, workspaceId, now),
      failedRuns(db, workspaceId, now),
      failingSends(db, workspaceId, now),
      brokenConnections(db, workspaceId),
      rejectedTemplates(db, workspaceId),
      stalledBroadcasts(db, workspaceId, now),
      systemErrors(db, now),
    ]);

  if (stuck) issues.push(stuck);
  if (failed) issues.push(failed);
  if (failing) issues.push(failing);
  issues.push(...connections);
  if (templates) issues.push(templates);
  if (broadcasts) issues.push(broadcasts);
  if (system) issues.push(system);

  // Lo crítico primero: son las que cortan envíos.
  return issues.sort((a, b) =>
    a.severity === b.severity ? b.count - a.count : a.severity === 'critical' ? -1 : 1,
  );
}

/**
 * Corridas que se quedaron a mitad de camino. "Parcial" es normal mientras la
 * automatización espera; deja de serlo cuando pasaron horas y no hay ninguna
 * reanudación encolada — ahí el mensaje no va a salir nunca solo.
 */
async function stuckRuns(
  db: SupabaseClient,
  workspaceId: string,
  now: number,
): Promise<Issue | null> {
  const cutoff = new Date(now - STUCK_RUN_HOURS * 3600_000).toISOString();
  const { data } = await db
    .from('automation_logs')
    .select('id, automation_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'partial')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Array<{ id: string; automation_id: string }>;
  if (rows.length === 0) return null;

  // Una espera encolada (pendiente o corriendo) significa que el sistema
  // todavía la tiene en la mano: no es un problema del comercio.
  const { data: queued } = await db
    .from('automation_pending_executions')
    .select('log_id')
    .in('status', ['pending', 'running'])
    .in(
      'log_id',
      rows.map((r) => r.id),
    );
  const alive = new Set(
    ((queued ?? []) as Array<{ log_id: string | null }>).map((q) => q.log_id),
  );
  const dead = rows.filter((r) => !alive.has(r.id));
  if (dead.length === 0) return null;

  // El nombre de la automatización dice más que un conteo suelto.
  const { data: automation } = await db
    .from('automations')
    .select('name')
    .eq('id', dead[0].automation_id)
    .maybeSingle();

  return {
    kind: 'automation_stuck',
    severity: 'critical',
    count: dead.length,
    detail: (automation as { name?: string } | null)?.name ?? null,
    href: `/automatizaciones/${dead[0].automation_id}`,
  };
}

/**
 * Corridas que reventaron, con el error tal cual quedó anotado.
 *
 * Es el aviso más literal de todos: una automatización que tira una excepción
 * escribe `status: failed` y su `error_message`, y hasta ahora eso vivía dentro
 * del detalle de la automatización — había que entrar a buscarlo sabiendo que
 * existía. El mensaje del error se muestra crudo a propósito: "template not
 * found: carrito_v3" le dice al comercio exactamente qué arreglar, mucho mejor
 * que un "algo falló" traducido.
 */
async function failedRuns(
  db: SupabaseClient,
  workspaceId: string,
  now: number,
): Promise<Issue | null> {
  const since = new Date(now - 24 * 3600_000).toISOString();
  const { data } = await db
    .from('automation_logs')
    .select('id, automation_id, error_message')
    .eq('workspace_id', workspaceId)
    .eq('status', 'failed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Array<{
    automation_id: string;
    error_message: string | null;
  }>;
  if (rows.length === 0) return null;

  const message = rows.find((r) => r.error_message)?.error_message ?? null;
  return {
    kind: 'automation_failed',
    severity: 'critical',
    count: rows.length,
    detail: message ? message.slice(0, 120) : null,
    href: `/automatizaciones/${rows[0].automation_id}`,
  };
}

/**
 * El motor de fondo falló. No es del comercio, pero le pega de lleno: si el
 * cron de campañas viene reventando, sus mensajes no salen y todo lo demás en
 * pantalla se ve normal. Se muestra igual, con el nombre del trabajo y su
 * error, porque el silencio es peor que la jerga.
 */
async function systemErrors(db: SupabaseClient, now: number): Promise<Issue | null> {
  const since = new Date(now - 2 * 3600_000).toISOString();
  const { data } = await db
    .from('cron_runs')
    .select('name, status, error, started_at')
    .eq('status', 'error')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(50);
  const rows = (data ?? []) as Array<{ name: string; error: string | null }>;
  if (rows.length === 0) return null;

  // Si el mismo trabajo ya volvió a correr bien, fue un tropiezo puntual y no
  // hay nada que atender: sólo cuenta lo que sigue roto ahora.
  const names = [...new Set(rows.map((r) => r.name))];
  const { data: recovered } = await db
    .from('cron_runs')
    .select('name')
    .in('name', names)
    .eq('status', 'ok')
    .gte('started_at', rows[0] ? since : since);
  const healthy = new Set(((recovered ?? []) as Array<{ name: string }>).map((r) => r.name));
  const broken = rows.filter((r) => !healthy.has(r.name));
  if (broken.length === 0) return null;

  return {
    kind: 'system_error',
    severity: 'critical',
    count: new Set(broken.map((b) => b.name)).size,
    detail: `${broken[0].name}${broken[0].error ? `: ${broken[0].error.slice(0, 100)}` : ''}`,
    href: '/inicio',
  };
}

/** Mensajes que Meta rechazó en las últimas horas, con el motivo más repetido. */
async function failingSends(
  db: SupabaseClient,
  workspaceId: string,
  now: number,
): Promise<Issue | null> {
  const since = new Date(now - FAILURE_WINDOW_HOURS * 3600_000).toISOString();
  const { data } = await db
    .from('messages')
    .select('id, error_reason, conversations!inner(workspace_id)')
    .eq('conversations.workspace_id', workspaceId)
    .eq('status', 'failed')
    .gte('created_at', since)
    .limit(500);
  const rows = (data ?? []) as Array<{ error_reason: string | null }>;
  if (rows.length < FAILURE_MIN) return null;

  const byReason = new Map<string, number>();
  for (const r of rows) {
    const reason = (r.error_reason ?? '').trim() || 'sin motivo';
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  const top = [...byReason.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    kind: 'sends_failing',
    severity: 'critical',
    count: rows.length,
    detail: top?.[0] ?? null,
    href: '/bandeja',
  };
}

/**
 * Conexiones caídas y WhatsApp bloqueado. Son distintas cosas para el comercio:
 * una conexión en error se arregla reconectando; un WABA bloqueado se arregla
 * en el panel de Meta (impuestos, medio de pago) y ninguna plantilla sale hasta
 * entonces.
 */
async function brokenConnections(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue[]> {
  const { data } = await db
    .from('channel_connections')
    .select('channel, status, config')
    .eq('workspace_id', workspaceId);
  const rows = (data ?? []) as Array<{
    channel: string;
    status: string;
    config?: { health_status?: string | null } | null;
  }>;

  const out: Issue[] = [];

  const broken = rows.filter((r) => r.status === 'error' || r.status === 'expired');
  if (broken.length > 0) {
    out.push({
      kind: 'connection_error',
      severity: 'critical',
      count: broken.length,
      detail: broken.map((b) => b.channel).join(', '),
      href: '/integraciones',
    });
  }

  // Tiendas cuya credencial dejó de servir. Viven en otra tabla que los
  // canales de mensajería, pero para el comercio es el mismo problema: algo
  // que conectó una vez y hoy no funciona.
  const { data: stores } = await db
    .from('shopify_connections')
    .select('platform, shop_domain, status')
    .eq('workspace_id', workspaceId)
    .neq('status', 'active');
  const deadStores = (stores ?? []) as Array<{
    platform: string | null;
    shop_domain: string;
  }>;
  if (deadStores.length > 0) {
    out.push({
      kind: 'connection_error',
      severity: 'critical',
      count: deadStores.length,
      detail: deadStores.map((s) => s.shop_domain).join(', '),
      href: '/integraciones',
    });
  }

  const blocked = rows.filter(
    (r) =>
      r.channel === 'whatsapp' &&
      String(r.config?.health_status ?? '').toUpperCase() === 'BLOCKED',
  );
  if (blocked.length > 0) {
    out.push({
      kind: 'whatsapp_blocked',
      severity: 'critical',
      count: blocked.length,
      detail: null,
      href: '/integraciones',
    });
  }

  return out;
}

/** Plantillas que Meta rechazó: no se pueden usar en campañas ni automatizaciones. */
async function rejectedTemplates(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue | null> {
  const { data } = await db
    .from('message_templates')
    .select('id, name, status')
    .eq('workspace_id', workspaceId)
    .ilike('status', 'rejected')
    .limit(50);
  const rows = (data ?? []) as Array<{ name: string }>;
  if (rows.length === 0) return null;
  return {
    kind: 'template_rejected',
    severity: 'warning',
    count: rows.length,
    detail: rows[0]?.name ?? null,
    href: '/plantillas',
  };
}

/** Campañas que quedaron "enviando" y no terminaron. */
async function stalledBroadcasts(
  db: SupabaseClient,
  workspaceId: string,
  now: number,
): Promise<Issue | null> {
  const cutoff = new Date(now - 2 * 3600_000).toISOString();
  const { data } = await db
    .from('broadcasts')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .eq('status', 'sending')
    .lt('updated_at', cutoff)
    .limit(20);
  const rows = (data ?? []) as Array<{ id: string; name: string | null }>;
  if (rows.length === 0) return null;
  return {
    kind: 'broadcast_stalled',
    severity: 'warning',
    count: rows.length,
    detail: rows[0]?.name ?? null,
    href: '/campanas',
  };
}
