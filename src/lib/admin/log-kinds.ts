/**
 * Contrato del visor de registros — puro, sin imports de servidor.
 *
 * La lectura vive en `logs.ts`, que usa el cliente service-role. Este archivo
 * está separado para que la pantalla (que corre en el navegador) pueda importar
 * los tipos y la lista de fuentes sin arrastrar ese cliente al bundle.
 */

export const LOG_KINDS = [
  'ai',
  'automations',
  'flows',
  'messages',
  // Plantillas y campañas no tenían ninguna superficie en el panel, aunque el
  // negocio dependa de que Meta apruebe las primeras y de que las segundas
  // terminen de enviarse.
  'templates',
  'broadcasts',
  'webhooks',
  // El historial de los trabajos de fondo. /admin/operacion muestra la última
  // corrida de cada uno; acá se ve si algo falla siempre o falló una vez.
  'crons',
  'approvals',
  'comment_to_dm',
  'ig_proactive',
  'voice',
] as const;

export type LogKind = (typeof LOG_KINDS)[number];

export function isLogKind(v: string): v is LogKind {
  return (LOG_KINDS as readonly string[]).includes(v);
}

export interface LogEntry {
  id: string;
  at: string;
  workspaceId: string | null;
  workspaceName: string | null;
  /** 'ok' | 'warn' | 'error' — cómo pintarlo. */
  level: 'ok' | 'warn' | 'error';
  /** Estado crudo de la fuente ('sent', 'skipped', 'failed', 'timed_out'…). */
  status: string | null;
  /** Qué pasó, en una línea: motivo de skip, código de error, evento. */
  detail: string | null;
  /**
   * Pares clave/valor extra para la fila expandida.
   *
   * Los booleanos van como booleanos y no como "sí"/"no": la tabla pinta este
   * objeto clave por clave, así que un literal en español acá sería texto en
   * español en una pantalla que se ve en dos idiomas.
   */
  extra: Record<string, string | number | boolean | null>;
}
