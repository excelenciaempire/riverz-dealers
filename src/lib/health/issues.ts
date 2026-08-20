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
 *
 * La detección vive en SQL (`admin_workspace_issues`, migración 152) y no acá.
 * El motivo es el alcance: eran seis consultas por cuenta, así que el panel de
 * plataforma no podía correrlas para todos los comercios y terminaba diciendo
 * "todo en orden" el mismo día en que un comercio recibía el correo con seis
 * problemas. Ahora la misma función contesta por una cuenta o por todas, y las
 * dos pantallas no se pueden contradecir.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type IssueSeverity = 'critical' | 'warning';

export type IssueKind =
  | 'automation_stuck'
  | 'automation_failed'
  | 'sends_failing'
  | 'whatsapp_blocked'
  | 'connection_error'
  | 'template_rejected'
  | 'broadcast_stalled'
  | 'nadie_atiende';

export interface Issue {
  /** Clave estable; la UI la traduce y decide el link. */
  kind: IssueKind;
  severity: IssueSeverity;
  /** Cuántas cosas caen bajo este aviso (mensajes, corridas, conexiones). */
  count: number;
  /** Detalle corto y concreto: un nombre, un motivo, un canal. */
  detail?: string | null;
  /** A dónde va el comercio a resolverlo (ruta canónica, en español). */
  href: string;
}

/** Fila cruda de la función SQL. */
export interface IssueRow {
  workspace_id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  count: number;
  detail: string | null;
  /** Id de la automatización, cuando el aviso apunta a una en particular. */
  ref_id: string | null;
}

/** A dónde se resuelve cada clase de problema. */
function hrefFor(row: Pick<IssueRow, 'kind' | 'ref_id'>): string {
  switch (row.kind) {
    case 'automation_stuck':
    case 'automation_failed':
      return row.ref_id ? `/automatizaciones/${row.ref_id}` : '/automatizaciones';
    case 'sends_failing':
      return '/bandeja';
    case 'connection_error':
    case 'whatsapp_blocked':
      return '/integraciones';
    case 'template_rejected':
      return '/plantillas';
    case 'broadcast_stalled':
      return '/campanas';
    case 'nadie_atiende':
      return '/asistente';
  }
}

/** Lo crítico primero: son las que cortan envíos. */
function porGravedad(a: Issue, b: Issue): number {
  if (a.severity === b.severity) return b.count - a.count;
  return a.severity === 'critical' ? -1 : 1;
}

export function toIssue(row: IssueRow): Issue {
  return {
    kind: row.kind,
    severity: row.severity,
    count: Number(row.count) || 0,
    detail: row.detail,
    href: hrefFor(row),
  };
}

/**
 * Canales conectados y nadie atendiendo.
 *
 * Es el modo de falla más caro que tuvo este producto y el más silencioso: el
 * 2026-08-05 se quedó sin saldo la clave de IA, alguien borró los cuatro
 * agentes de un comercio, y durante **quince días** los mensajes de sus
 * clientes entraron a una bandeja donde no contestaba nadie. Ninguna pantalla
 * lo decía. Se descubrió leyendo la base a mano.
 *
 * No está en el SQL de la migración 152 con los demás porque no es un error de
 * nada: es una AUSENCIA, y las ausencias no dejan filas. Hay que ir a buscarlas.
 *
 * La condición es la que importa: canales conectados —o sea, mensajes
 * entrando— y cero agentes vivos y activos. Un comercio sin canales todavía no
 * empezó y no necesita que le avisen nada.
 */
async function nadieAtiende(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue | null> {
  const [canales, agentes] = await Promise.all([
    db
      .from('channel_connections')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'connected'),
    db
      .from('ai_agents')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .is('deleted_at', null),
  ]);

  const conectados = canales.count ?? 0;
  if (conectados === 0 || (agentes.count ?? 0) > 0) return null;

  return {
    kind: 'nadie_atiende',
    severity: 'critical',
    count: conectados,
    detail: null,
    href: '/asistente',
  };
}

/** Lo que necesita atención en UN comercio. */
export async function collectWorkspaceIssues(
  db: SupabaseClient,
  workspaceId: string,
): Promise<Issue[]> {
  const { data, error } = await db.rpc('admin_workspace_issues', {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error(`[health] admin_workspace_issues: ${error.message}`);
  const issues = ((data ?? []) as IssueRow[]).map(toIssue);

  // Se busca aparte porque es una ausencia y las ausencias no dejan filas.
  // Fail-soft: que falle esta consulta no puede tapar los demás avisos.
  const sinAgente = await nadieAtiende(db, workspaceId).catch(() => null);
  if (sinAgente) issues.push(sinAgente);

  return issues.sort(porGravedad);
}

/**
 * Lo mismo para TODA la plataforma, agrupado por comercio. Es lo que mira el
 * panel: una sola consulta en vez de seis por cuenta.
 */
export async function collectPlatformIssues(
  db: SupabaseClient,
): Promise<Map<string, Issue[]>> {
  const { data, error } = await db.rpc('admin_workspace_issues', {
    p_workspace_id: null,
  });
  if (error) throw new Error(`[health] admin_workspace_issues: ${error.message}`);

  const out = new Map<string, Issue[]>();
  for (const row of (data ?? []) as IssueRow[]) {
    const list = out.get(row.workspace_id) ?? [];
    list.push(toIssue(row));
    out.set(row.workspace_id, list);
  }
  for (const list of out.values()) list.sort(porGravedad);
  return out;
}
