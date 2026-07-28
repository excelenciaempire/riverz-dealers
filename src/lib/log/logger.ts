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
  // @sentry/node es nativo de Node (node:diagnostics_channel, OpenTelemetry).
  // logger.ts lo importan también client components (error.tsx / global-error.tsx)
  // e instrumentation edge; si el bundler intentara empaquetar @sentry/node en
  // esos grafos el build revienta. Dos defensas:
  //   1) NEXT_RUNTIME !== 'nodejs' → nunca se ejecuta el import fuera de Node.
  //   2) /* turbopackIgnore: true */ → Turbopack no lo mete en los bundles de
  //      cliente/edge; se resuelve en runtime desde node_modules sólo en Node.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return null
  if (!process.env.SENTRY_DSN) return null
  if (!sentryPromise) {
    sentryPromise = (async () => {
      try {
        // Si no está instalado (self-host sin observabilidad) el import falla
        // y caemos a null sin romper nada.
        const mod = (await import(/* turbopackIgnore: true */ '@sentry/node')) as unknown as {
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

/**
 * En el navegador, `loadSentry()` siempre devuelve null (la guarda de
 * NEXT_RUNTIME), así que hasta ahora un error de cliente moría en la consola
 * del usuario y no llegaba a ningún lado. Se reenvía al servidor, que sí puede
 * emitirlo por el canal normal.
 *
 * Best-effort y silencioso: si el reporte falla, no se reporta el fallo del
 * reporte — eso sería un bucle.
 */
function reportFromBrowser(err: unknown, ctx?: LogContext): void {
  try {
    const payload = JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      digest: typeof ctx?.digest === 'string' ? ctx.digest : undefined,
      scope: typeof ctx?.scope === 'string' ? ctx.scope : undefined,
      url: window.location?.href,
    })
    // sendBeacon sobrevive a que la pestaña se cierre justo después del error.
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(
        '/api/client-errors',
        new Blob([payload], { type: 'application/json' }),
      )
      return
    }
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* nunca dejar que el reporte de un error genere otro */
  }
}

export function captureException(err: unknown, ctx?: LogContext): void {
  const scope = typeof ctx?.scope === 'string' ? ctx.scope : 'app'
  emit('error', scope, 'exception', {
    ...(ctx ?? {}),
    error: serializeError(err),
  })
  if (typeof window !== 'undefined') {
    reportFromBrowser(err, ctx)
    return
  }
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
