import { getLogger } from '@/lib/log/logger'

const log = getLogger('instrumentation')

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Validar la clave maestra de cifrado al arranque: si está mal configurada
  // (truncada, con prefijo, distinta entre entornos) Buffer.from(_, 'hex') la
  // aceptaría silenciosamente y degradaría el cifrado de tokens y la firma del
  // state OAuth. Mejor fallar fuerte al boot que tarde y por request.
  const { assertEncryptionKey } = await import('@/lib/whatsapp/encryption')
  if (!assertEncryptionKey()) {
    const msg =
      'ENCRYPTION_KEY inválida o ausente: debe ser 64 hex chars (32 bytes para AES-256).'
    if (process.env.NODE_ENV === 'production') {
      log.error(msg)
      throw new Error(msg)
    }
    log.warn(`${msg} (permitido fuera de producción)`)
  }

  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    log.info('Sentry disabled')
    return
  }

  try {
    const name = '@sentry/nextjs'
    const Sentry = (await import(/* webpackIgnore: true */ name)) as unknown as {
      init: (opts: { dsn: string }) => void
    }
    Sentry.init({ dsn })
    log.info('Sentry initialised')
  } catch (err) {
    log.warn('Sentry init skipped (package not installed)', {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
