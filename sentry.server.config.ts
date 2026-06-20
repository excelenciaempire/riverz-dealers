// Sentry — runtime Node.js.
//
// Este archivo se importa desde src/instrumentation.ts (register) sólo
// cuando NEXT_RUNTIME === 'nodejs' y SENTRY_DSN está definido. Si el DSN
// está ausente, Sentry.init es un no-op (el SDK no envía nada), así que
// el archivo es seguro de importar incondicionalmente, pero igual lo
// gateamos en instrumentation.ts para no cargar el paquete sin necesidad.
import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Muestreo bajo de trazas de performance: suficiente para detectar
  // regresiones sin inflar el volumen (ni el costo) en producción.
  tracesSampleRate: 0.1,
  // Sólo reportar cuando hay DSN; sin él el SDK queda inactivo igual.
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV,
})
