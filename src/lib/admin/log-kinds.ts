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
  'webhooks',
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
  /** Pares clave/valor extra para la fila expandida. */
  extra: Record<string, string | number | null>;
}
