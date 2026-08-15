import { supabaseAdmin } from '@/lib/channels/admin-client';
import { clientIp } from '@/lib/rate-limit';
import type { AdminActor } from './guard';

/**
 * Registro de lo que hace (y mira) el equipo en el panel de plataforma.
 *
 * El panel es de solo lectura sobre los datos de los comercios, pero puede
 * ver TODOS los comercios: por eso queda constancia de quién consultó qué.
 * Se escribe en `admin_audit_log` (migración 124).
 *
 * Fail-soft y sin `await` en el camino crítico: que la auditoría falle no
 * puede tumbar la pantalla que el admin está abriendo. Un fallo se loguea y
 * se sigue.
 */

export type AdminAction =
  | 'view.overview'
  | 'view.workspaces'
  | 'view.workspace'
  | 'view.users'
  | 'view.logs'
  | 'view.ops'
  | 'view.usage'
  | 'view.channels'
  | 'view.audit'
  | 'view.waitlist'
  | 'view.infrastructure'
  | 'update.feature_flag'
  | 'update.workspace_feature_flag'
  | 'update.voice_model'
  | 'view.ai_key'
  | 'view.feature_flags'
  | 'view.voice_model'
  | 'view.platform_whatsapp'
  | 'update.platform_ai_key'
  | 'update.platform_ai_workspace'
  // Credenciales del WhatsApp de la plataforma. Se auditan como todo lo demás:
  // eran las únicas dos escrituras del panel que no dejaban rastro.
  | 'update.platform_whatsapp'
  // Descarga de recursos que el equipo entrega a un comercio. No lleva
  // datos de nadie, pero queda registrada igual: es una salida de archivo
  // desde el panel y conviene poder decir quién la pidió.
  | 'download.woocommerce_plugin';

interface AuditEntry {
  action: AdminAction;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}

export async function recordAdminAction(
  actor: AdminActor,
  request: Request,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin()
      .from('admin_audit_log')
      .insert({
        actor_id: actor.userId,
        actor_email: actor.email,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        meta: entry.meta ?? {},
        ip: clientIp(request),
      });
    if (error) {
      console.warn('[admin/audit] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[admin/audit] insert threw:', err);
  }
}

/**
 * Versión "dispara y olvida" para las lecturas: no bloquea la respuesta.
 * Las escrituras de configuración sí usan `recordAdminAction` con await, para
 * que un cambio nunca quede sin rastro.
 */
export function recordAdminView(
  actor: AdminActor,
  request: Request,
  entry: AuditEntry,
): void {
  void recordAdminAction(actor, request, entry);
}
