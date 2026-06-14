import { getLogger } from '@/lib/log/logger'

const log = getLogger('instrumentation')

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

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
