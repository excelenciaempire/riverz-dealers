export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogContext = Record<string, unknown>

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? '').toLowerCase()
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel()]
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    }
  }
  return { value: String(err) }
}

function emit(level: LogLevel, scope: string, msg: string, ctx?: LogContext) {
  if (!shouldEmit(level)) return
  const payload = {
    level,
    scope,
    msg,
    ts: new Date().toISOString(),
    ...(ctx ?? {}),
  }
  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void
  info(msg: string, ctx?: LogContext): void
  warn(msg: string, ctx?: LogContext): void
  error(msg: string, ctx?: LogContext): void
  captureException(err: unknown, ctx?: LogContext): void
}

export function getLogger(scope: string): Logger {
  return {
    debug: (msg, ctx) => emit('debug', scope, msg, ctx),
    info: (msg, ctx) => emit('info', scope, msg, ctx),
    warn: (msg, ctx) => emit('warn', scope, msg, ctx),
    error: (msg, ctx) => emit('error', scope, msg, ctx),
    captureException: (err, ctx) => captureException(err, { scope, ...(ctx ?? {}) }),
  }
}

let sentryPromise: Promise<{ captureException: (e: unknown, hint?: unknown) => void } | null> | null =
  null

async function loadSentry() {
  if (!process.env.SENTRY_DSN) return null
  if (!sentryPromise) {
    sentryPromise = (async () => {
      try {
        // Import dinámico de @sentry/node. Si no está instalado (self-host
        // sin observabilidad) el import falla y caemos a null sin romper nada.
        const mod = (await import('@sentry/node')) as unknown as {
          captureException: (e: unknown, hint?: unknown) => void
        }
        return mod
      } catch {
        return null
      }
    })()
  }
  return sentryPromise
}

export function captureException(err: unknown, ctx?: LogContext): void {
  const scope = typeof ctx?.scope === 'string' ? ctx.scope : 'app'
  emit('error', scope, 'exception', {
    ...(ctx ?? {}),
    error: serializeError(err),
  })
  if (!process.env.SENTRY_DSN) return
  void loadSentry().then((sentry) => {
    if (!sentry) return
    try {
      sentry.captureException(err, ctx ? { extra: ctx } : undefined)
    } catch {
      // Sentry forwarding is best-effort; never let it crash the caller.
    }
  })
}
