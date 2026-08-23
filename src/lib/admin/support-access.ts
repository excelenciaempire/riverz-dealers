import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * La única puerta por la que soporte lee una conversación ajena.
 *
 * El panel no puede leer mensajes de un comercio, y esa barrera
 * (`assertMetadataOnly`) es deliberada: los mensajes son de los clientes DE un
 * comercio, gente que nunca aceptó nada con Riverz. El precio de esa promesa es
 * que ante un «la IA no me contesta» hay que pedir capturas.
 *
 * Esto abre una ventana, y la abre **el comercio**. Nunca el equipo. Vence sola
 * —no existe la opción de dar permiso para siempre— y cada lectura queda
 * anotada.
 *
 * Va por su propia función y NO relajando `assertMetadataOnly`: la barrera tiene
 * que seguir siendo cierta para todo lo demás. Un permiso que afloja la regla
 * general convierte la excepción en la regla el día que alguien copia una
 * consulta.
 */

export interface PermisoDeSoporte {
  vigente: boolean;
  expiraEn: string | null;
  concedidoEn: string | null;
  motivo: string | null;
}

const SIN_PERMISO: PermisoDeSoporte = {
  vigente: false,
  expiraEn: null,
  concedidoEn: null,
  motivo: null,
};

export async function permisoDeSoporte(workspaceId: string): Promise<PermisoDeSoporte> {
  const { data } = await supabaseAdmin()
    .from('support_access')
    .select('granted_at, expires_at, reason')
    .eq('workspace_id', workspaceId)
    .is('revoked_at', null)
    .maybeSingle();
  const f = data as { granted_at: string; expires_at: string; reason: string | null } | null;
  if (!f) return SIN_PERMISO;
  return {
    vigente: Date.parse(f.expires_at) > Date.now(),
    expiraEn: f.expires_at,
    concedidoEn: f.granted_at,
    motivo: f.reason,
  };
}

export interface MensajeDeSoporte {
  id: string;
  direction: string | null;
  sender_type: string | null;
  content_text: string | null;
  created_at: string;
}

/**
 * Los mensajes de una conversación, si el comercio abrió la puerta.
 *
 * Lanza cuando no hay permiso. No devuelve una lista vacía: una lista vacía se
 * lee como «esta conversación no tiene mensajes», y esconder que faltó permiso
 * es peor que no poder verlos.
 */
export async function mensajesConPermiso(
  workspaceId: string,
  conversationId: string,
): Promise<MensajeDeSoporte[]> {
  const permiso = await permisoDeSoporte(workspaceId);
  if (!permiso.vigente) {
    throw new Error('Este comercio no autorizó que soporte lea sus conversaciones.');
  }

  const db = supabaseAdmin();
  // La conversación tiene que ser DE ese comercio: sin esta comprobación, un
  // permiso de una cuenta abriría las conversaciones de cualquier otra.
  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!conv) throw new Error('Esa conversación no es de este comercio.');

  const { data, error } = await db
    .from('messages')
    .select('id, direction, sender_type, content_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as MensajeDeSoporte[];
}
