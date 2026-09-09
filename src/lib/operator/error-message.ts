import type { Locale } from '@/lib/i18n/config'
import { translate } from '@/lib/i18n/translate'

/** Stable billing codes are shared by HTTP responses and model-call failures. */
export function operatorErrorMessage(locale: Locale, error: unknown): string {
  return translate(locale, operatorErrorKey(error))
}

export function operatorErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : error
  return (
    code === 'sin_saldo' ? 'operation.operatorSaldoInsuficiente'
      : code === 'suscripcion_vencida' ? 'operation.operatorSuscripcionVencida'
        : code === 'rate_limited' ? 'operation.operatorRateLimited'
          : 'operation.operatorError')
}
