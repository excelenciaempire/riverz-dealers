import { NextResponse } from 'next/server';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';

/**
 * Techo de uso para las rutas que llaman al modelo.
 *
 * Acá el límite no es de seguridad clásica: es la factura. Una cuenta que
 * dispara `generar desde mi web` o `probar agente` en bucle vacía el saldo de
 * Anthropic de la plataforma en minutos, y cuando eso pasa **todos** los
 * comercios se quedan sin respuestas automáticas. El daño no cae sobre quien
 * abusa, cae sobre los demás.
 *
 * Por workspace y no por usuario: el gasto se cobra al workspace y sus
 * miembros comparten el mismo saldo. Por IP tampoco sirve — una cuenta con
 * varias personas trabajando comparte salida a internet.
 *
 * Dos presupuestos:
 *   - `heavy`: rastrear un sitio entero y resumirlo. Minutos de trabajo y
 *     decenas de miles de tokens por llamada; nadie necesita hacerlo seguido.
 *   - `standard`: una respuesta suelta del modelo (probar el agente, redactar
 *     una plantilla). Barata de a una, cara en bucle.
 */
export const AI_RATE_LIMITS = {
  heavy: { limit: 5, windowMs: 60 * 60_000 },
  standard: { limit: 30, windowMs: 5 * 60_000 },
} as const;

export type AiBudget = keyof typeof AI_RATE_LIMITS;

/**
 * Devuelve una respuesta 429 si el workspace agotó su cupo, o null si puede
 * seguir. Se usa igual que `csrfGuard`:
 *
 *   const over = await aiBudgetGuard(workspaceId, 'heavy');
 *   if (over) return over;
 *
 * Sin workspace resuelto no se limita: llamar con undefined significa que el
 * caller todavía no comprobó pertenencia, y ahí el problema es otro.
 */
export async function aiBudgetGuard(
  workspaceId: string | null | undefined,
  budget: AiBudget = 'standard',
): Promise<NextResponse | null> {
  if (!workspaceId) return null;
  const result = await limitByKey(
    `ai:${budget}:${workspaceId}`,
    AI_RATE_LIMITS[budget],
  );
  return result.success ? null : rateLimitResponse(result);
}
