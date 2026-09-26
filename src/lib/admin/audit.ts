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
  | 'reconcile.wallet_usage'
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
  // Códigos de invitación: son la puerta del alta, así que emitir uno o
  // revocarlo deja rastro de quién lo hizo.
  | 'view.signup_codes'
  | 'create.signup_code'
  | 'revoke.signup_code'
  | 'view.infrastructure'
  // Qué llaves pueden operar una cuenta desde afuera. Mirar quién tiene acceso
  // es en sí mismo un acto que conviene que quede registrado.
  | 'view.keys'
  // Las llaves globales de IA y voz: con ellas trabajan todos los comercios y
  // su consumo se le cobra a la billetera de cada uno, así que cambiar una es
  // de lo más sensible que se puede hacer desde el panel. Queda el proveedor,
  // nunca el valor.
  | 'update.platform_key'
  | 'delete.platform_key'
  | 'update.feature_flag'
  | 'update.workspace_feature_flag'
  | 'update.voice_model'
  // Probar las llaves del stack de voz: no cambia nada, pero sale a la red
  // hacia terceros con la llave de la plataforma, asi que deja rastro.
  | 'test.voice_model'
  | 'view.ai_key'
  | 'view.feature_flags'
  | 'view.voice_model'
  | 'view.platform_whatsapp'
  | 'update.platform_ai_key'
  | 'update.platform_ai_workspace'
  // Credenciales del WhatsApp de la plataforma. Se auditan como todo lo demás:
  // eran las únicas dos escrituras del panel que no dejaban rastro.
  | 'update.platform_whatsapp'
  // El interruptor del cobro manual: prender y apagar el acceso de un
  // comercio. Es la escritura del panel con más consecuencias — deja al
  // comercio afuera del producto— así que se audita como todo lo demás.
  | 'update.workspace_suspend'
  | 'update.workspace_resume'
  // El otro interruptor: deja al comercio mudo hacia afuera, pero con panel.
  | 'update.workspace_motor_on'
  | 'update.workspace_motor_off'
  | 'prepare.workspace_operation'
  | 'view.workspace_operation_health'
  // Descarga de recursos que el equipo entrega a un comercio. No lleva
  // datos de nadie, pero queda registrada igual: es una salida de archivo
  // desde el panel y conviene poder decir quién la pidió.
  // Facturacion. Es la escritura del panel que decide cuanta plata entra: se
  // audita quien cambio un precio y a quien le cambio el trato, porque "a este
  // comercio se lo dejamos gratis" es una decision que en seis meses nadie
  // recuerda haber tomado.
  | 'view.conversations'
  // Las pruebas y el feedback de un comercio (y la cola de lo que hay que
  // arreglar en la plataforma). El feedback real trae tramos de conversaciones
  // de sus clientes, con los datos de contacto tapados.
  | 'view.mejoras'
  | 'update.mejora_plataforma'
  // Leer una conversacion de un comercio. Es la lectura mas sensible del panel
  // —son mensajes de compradores reales— y solo se puede con una ventana que
  // abrio el propio comercio. Queda escrito quien miro que, y cuando.
  | 'view.conversation_content'
  | 'view.billing'
  // El saldo de cada proveedor. Es una lectura cara —le pregunta a seis APIs
  // externas— y ademas dispara una llamada cobrada a Anthropic: conviene poder
  // ver quien la pidio si alguien la deja recargando en bucle.
  | 'view.provider_balances'
  // La caja: lo que hay en Stripe, lo que hay en los proveedores y lo que se
  // debe. Reusa la ronda cacheada de proveedores, pero además le pregunta a
  // Stripe por el saldo y las transferencias en camino, así que queda rastro.
  | 'view.cash'
  // Lo que se paga todos los meses. Sale a preguntarle a los tableros de
  // Render, Supabase y Telnyx, asi que es una lectura hacia afuera.
  | 'view.fixed_costs'
  | 'update.billing_plan'
  | 'update.billing_subscription'
  // Cargar saldo a mano y prender el corte por saldo. Regalar saldo es regalar
  // plata, y dejar a una cuenta sin IA es tocarle la operacion: las dos tienen
  // que poder rastrearse hasta quien las hizo.
  | 'update.wallet_balance'
  | 'update.wallet_blocking'
  | 'update.wallet_rate'
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
  entry: AuditEntry
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
  entry: AuditEntry
): void {
  void recordAdminAction(actor, request, entry);
}
