import type { Instrumentation } from 'next'

import { getLogger } from '@/lib/log/logger'

const log = getLogger('instrumentation')

export async function register() {
  const dsn = process.env.SENTRY_DSN

  if (process.env.NEXT_RUNTIME === 'nodejs') {
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

    // Las llaves de los proveedores que se cargaron desde el panel, al entorno
    // del proceso. Va ANTES del reloj: el primer latido puede disparar un
    // trabajo que las use, y arrancar con la clave vieja de Render sería
    // exactamente lo que se acaba de cambiar en el panel para arreglar.
    //
    // Después se refresca en cada latido (ver `scheduler.ts`), así que un
    // cambio vale en todas las instancias en menos de un minuto y sin
    // redeploy. Ver `lib/admin/claves.ts`.
    try {
      const { hidratarClaves } = await import('@/lib/admin/claves')
      const n = await hidratarClaves()
      if (n > 0) log.info('claves del panel aplicadas al entorno', { n })
    } catch (e) {
      // Sin esto el proceso sigue con lo de Render, que es lo que había antes.
      log.warn('no se pudieron leer las claves del panel', {
        error: e instanceof Error ? e.message : String(e),
      })
    }

    if (dsn) {
      // Carga @sentry/node y ejecuta Sentry.init (ver sentry.server.config.ts).
      // El import es dinámico para no cargar el paquete sin SENTRY_DSN.
      // Usamos @sentry/node (no @sentry/nextjs) porque la SDK de Next aún no
      // soporta Next 16 (peer conflict); el runtime edge no usa @sentry/node.
      await import('../sentry.server.config')
      log.info('Sentry initialised', { runtime: 'nodejs' })
    } else {
      log.info('Sentry disabled (no SENTRY_DSN)')
    }
    const { initLatitudeTracing, flushLatitudeTracing } = await import('@/lib/observability/latitude')
    await initLatitudeTracing()

    // Reloj de los trabajos periódicos. Vive dentro del servicio web porque
    // los Render Cron Jobs cuestan un mínimo de 1 USD/mes cada uno y no tienen
    // plan gratuito; ver src/lib/cron/schedule.ts.
    const { startScheduler, stopScheduler } = await import('@/lib/cron/scheduler')
    startScheduler()

    // Al sacar la instancia de rotación, Render manda SIGTERM y espera a que el
    // proceso termine. Sin esto el reloj seguía despertando y disparando
    // trabajos, y cada fetch en vuelo mantiene vivo el bucle de eventos: el
    // proceso no se apagaba, el despliegue nuevo esperaba el drenaje y expiraba.
    // Sólo se deja de TOMAR trabajo; lo que ya está corriendo termina.
    for (const senal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(senal, () => {
        log.info('senal de apagado recibida', { senal })
        stopScheduler()
        void flushLatitudeTracing()
      })
    }

    return
  }
}

// Reenvía a Sentry los errores que Next.js captura al servir requests
// (Server Components, route handlers, server actions). Sin DSN es un no-op.
// Solo runtime Node (@sentry/node no corre en edge).
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
) => {
  if (!process.env.SENTRY_DSN) return
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    // turbopackIgnore: no bundlear @sentry/node en el grafo edge de
    // instrumentation; sólo se ejecuta en runtime Node (gate de arriba).
    const Sentry = await import(/* turbopackIgnore: true */ '@sentry/node')
    Sentry.captureException(err, {
      data: {
        path: (request as { path?: string } | undefined)?.path,
        method: (request as { method?: string } | undefined)?.method,
      },
    })
  } catch (e) {
    log.warn('Sentry onRequestError forwarding failed', {
      error: e instanceof Error ? e.message : String(e),
    })
  }
}
