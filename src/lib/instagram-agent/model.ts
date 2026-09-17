/**
 * Routing de modelos del Agente de Instagram.
 *
 * La calidad/margen mejora usando el modelo adecuado por tarea: un modelo
 * rápido y barato para triage en volumen (clasificar intención de cada
 * comentario/DM) y el modelo tope para las tareas de alto valor (planificar
 * la campaña, redactar el cierre de una conversación caliente).
 */

export const MODELS = {
  /** Triage en volumen: lead scoring, clasificación de spam. */
  triage: 'claude-haiku-4-5-20251001',
  /** Alto valor: planificación de campaña, cierre de conversación. */
  premium: 'claude-sonnet-5',
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
