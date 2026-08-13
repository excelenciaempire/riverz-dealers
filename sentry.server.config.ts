// Sentry — runtime Node.js.
//
// Este archivo se importa desde src/instrumentation.ts (register) sólo
// cuando NEXT_RUNTIME === 'nodejs' y SENTRY_DSN está definido. Si el DSN
// está ausente, Sentry.init es un no-op (el SDK no envía nada), así que
// el archivo es seguro de importar incondicionalmente, pero igual lo
// gateamos en instrumentation.ts para no cargar el paquete sin necesidad.
import * as Sentry from '@sentry/node'

/**
 * Patrones de credencial que aparecen en los errores que más se reportan: los
 * intercambios de token de Meta y Shopify vuelcan la URL o el cuerpo del
 * request en el mensaje, y ahí viaja el token entero. Sentry es un tercero
 * más: lo que no necesita ver, no se le manda.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(access_token=)[^&\s"']+/gi, '$1[borrado]'],
  [/(client_secret=)[^&\s"']+/gi, '$1[borrado]'],
  [/(refresh_token=)[^&\s"']+/gi, '$1[borrado]'],
  [/(appsecret_proof=)[^&\s"']+/gi, '$1[borrado]'],
  [/("access_token"\s*:\s*")[^"]+/gi, '$1[borrado]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[borrado]'],
  // Firmas de webhook y tokens con prefijo propio (Shopify: shpat_/shpca_).
  [/\bsha(1|256)=[a-f0-9]{20,}/gi, 'sha$1=[borrado]'],
  [/\bshp(at|ca|pa|ss)_[A-Za-z0-9]+/g, 'shp$1_[borrado]'],
]

function scrub(value: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), value)
}

/** Recorre el evento borrando credenciales de cualquier string. */
function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return value
  if (typeof value === 'string') return scrub(value) as unknown as T
  if (Array.isArray(value)) {
    return value.map((v) => scrubDeep(v, depth + 1)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Cabeceras que son la credencial entera: no hay nada que conservar.
      out[k] = /^(authorization|cookie|x-cron-secret|x-hub-signature(-256)?)$/i.test(k)
        ? '[borrado]'
        : scrubDeep(v, depth + 1)
    }
    return out as unknown as T
  }
  return value
}

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Muestreo bajo de trazas de performance: suficiente para detectar
  // regresiones sin inflar el volumen (ni el costo) en producción.
  tracesSampleRate: 0.1,
  // Sólo reportar cuando hay DSN; sin él el SDK queda inactivo igual.
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV,
  // Explícito aunque sea el valor por defecto: que nadie lo active sin leer
  // el scrubbing de acá abajo.
  sendDefaultPii: false,
  beforeSend: (event) => scrubDeep(event),
  beforeSendTransaction: (event) => scrubDeep(event),
})
