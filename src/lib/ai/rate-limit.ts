import { NextResponse } from 'next/server';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { exigirSaldo, puertaDeIa } from '@/lib/wallet/puerta';

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
 * Devuelve 429 si el workspace agotó su cupo, 402 si se quedó sin saldo, o null
 * si puede seguir. Se usa igual que `csrfGuard`:
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
  if (!result.success) return rateLimitResponse(result);

  // Y el saldo.
  //
  // Va acá y no en cada ruta porque es exactamente el mismo conjunto: las siete
  // rutas que llaman al modelo a pedido de una persona ya pasan por esta
  // guardia. Poner el cheque en cada una era garantizar que la octava se
  // olvidara — y esa octava seria IA gratis que paga Riverz.
  //
  // Devuelve 402 con el motivo, que la pantalla convierte en el cartel con el
  // boton de recargar. Lo automatico no pasa por acá: eso se calla y ya está.
  return await exigirSaldo(supabaseAdmin(), workspaceId);
}

/**
 * La guardia de las PRUEBAS ("Probar" por asistente y "Probar como cliente").
 *
 * Es `aiBudgetGuard` con una sola excepción: la cuenta que todavía no pagó su
 * link (`sin_pagar`) puede probar. Probar antes de pagar es justo lo que hace
 * falta para decidir, la prueba no envía nada y la cubre Riverz; en vivo esa
 * cuenta sigue sin contestar hasta que paga. Sin saldo o con la suscripción
 * vencida se frena igual que siempre, y el cupo por minutos es el mismo.
 *
 * Las rutas corren además dentro de `probandoSinPagar`, para que lo que la
 * prueba llama por dentro —triaje, verificación, spam— tampoco se saltee.
 */
export async function aiTestGuard(
  workspaceId: string | null | undefined,
): Promise<NextResponse | null> {
  if (!workspaceId) return null;
  const result = await limitByKey(
    `ai:standard:${workspaceId}`,
    AI_RATE_LIMITS.standard,
  );
  if (!result.success) return rateLimitResponse(result);
  const puerta = await puertaDeIa(supabaseAdmin(), workspaceId);
  if (puerta.puede || puerta.motivo === 'sin_pagar') return null;
  return NextResponse.json(
    { error: puerta.motivo ?? 'sin_saldo', saldoCentavos: puerta.saldoCentavos },
    { status: 402 },
  );
}
