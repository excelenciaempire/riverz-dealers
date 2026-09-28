/**
 * Routing de modelos del Agente de Instagram.
 *
 * Sonnet es la base de calidad para todas las tareas, incluido el triage.
 */

export const MODELS = {
  /** Triage en volumen: lead scoring, clasificación de spam. */
  triage: 'claude-sonnet-5-5',
  /** Alto valor: planificación de campaña, cierre de conversación. */
  premium: 'claude-sonnet-5-5',
} as const;

export type AgentTask = 'plan' | 'lead_score' | 'spam' | 'close';

/** Elige el modelo según la tarea (y el valor del lead cuando aplica). */
export function pickModel(
  task: AgentTask,
  opts?: { leadScore?: 'high' | 'medium' | 'low' },
): string {
  switch (task) {
    case 'plan':
      return MODELS.premium;
    case 'close':
      // Conversación caliente (lead alto) → modelo tope; el resto, triage.
      return opts?.leadScore === 'high' ? MODELS.premium : MODELS.triage;
    case 'lead_score':
    case 'spam':
    default:
      return MODELS.triage;
  }
}
