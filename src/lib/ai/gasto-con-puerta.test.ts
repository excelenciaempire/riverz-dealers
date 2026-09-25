import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Nada llama al modelo con la llave de Riverz sin pasar por la puerta.
 *
 * Hay dos familias y cada una tiene su puerta:
 *
 *   - **A pedido de una persona** (los botones del panel): `aiBudgetGuard`, que
 *     limita la ráfaga y exige saldo, y devuelve un 402 que la pantalla
 *     convierte en el cartel de recargar. Hay alguien mirando y merece saber
 *     por qué no salió.
 *   - **Automático** (bandeja, comentarios, seguimientos, llamadas):
 *     `puedeUsarIa` / `puertaDeIa`. Se calla sin decir nada: el cliente del
 *     comercio no tiene por qué enterarse de que su proveedor se quedó sin
 *     saldo.
 *
 * El modo de falla es siempre el mismo y ya pasó dos veces: se agrega una ruta
 * nueva que llama al modelo y se olvida la puerta. Esa ruta es IA gratis que
 * paga Riverz, y no se nota hasta que llega la factura de Anthropic.
 */

const RUTAS = join(process.cwd(), 'src', 'app', 'api')

/** Las que llaman al modelo y NO necesitan puerta, con su motivo. */
const SIN_PUERTA = new Map([
  [
    join('internal', 'voice', 'tool', 'route.ts'),
    'la llama el trabajador de voz durante una llamada, y el minuto de llamada ' +
      'ya cobra el modelo, la voz y la transcripción juntos',
  ],
  [
    join('operacion', 'operator', 'planes', '[id]', 'correr', 'route.ts'),
    'ejecuta un plan que el Operador ya cobró al armarlo',
  ],
])

/** Cómo se ve una llamada al modelo. */
const LLAMA_AL_MODELO =
  /getAnthropic\(|messages\.create\(|completeText\(|completeTextConUso\(|completeTextMedido\(|runWithTools\(/

/** Cualquiera de las dos puertas. */
const TIENE_PUERTA = /aiBudgetGuard\(|exigirSaldo\(|puedeUsarIa\(|puertaDeIa\(/

function rutasTs(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) rutasTs(ruta, out)
    else if (nombre === 'route.ts') out.push(ruta)
  }
  return out
}

describe('toda ruta que llama al modelo pasa por una puerta', () => {
  it('ninguna gasta con la llave de Riverz sin control de saldo', () => {
    const culpables: string[] = []
    for (const ruta of rutasTs(RUTAS)) {
      const rel = relative(RUTAS, ruta)
      if (SIN_PUERTA.has(rel)) continue
      const src = readFileSync(ruta, 'utf8')
      if (!LLAMA_AL_MODELO.test(src)) continue
      if (!TIENE_PUERTA.test(src)) culpables.push(rel)
    }
    expect(
      culpables,
      `estas rutas llaman al modelo sin puerta de saldo — es IA gratis que ` +
        `paga Riverz:\n${culpables.join('\n')}\n\n` +
        `Usá aiBudgetGuard (a pedido de una persona) o puedeUsarIa (automático).`,
    ).toEqual([])
  })
})

describe('la clave del modelo se resuelve en un solo lugar', () => {
  it('nadie lee ANTHROPIC_API_KEY del entorno por su cuenta', () => {
    // Leyéndola directo se saltea la clave del agente y la de plataforma: un
    // comercio cubierto por la clave de plataforma quedaba mudo, y el triaje de
    // uno que trae SU clave corría con la de Riverz sin cobrarse.
    const PERMITIDOS = new Map([
      [join('lib', 'ai', 'platform-key.ts'), 'es quien la resuelve'],
      [join('lib', 'admin', 'proveedores.ts'), 'el panel de plataforma: mira el entorno a propósito'],
      // ── Deuda conocida ──────────────────────────────────────────────────
      // Estas gastan con la llave del entorno y no la resuelven. No es un
      // cobro mal hecho: `resolveAnthropicKey` sólo puede encontrar MÁS
      // llaves, nunca menos, así que convertirlas es aditivo. Lo que falta es
      // que el llamador tenga a mano el workspace, y en cada una hay que
      // enhebrarlo por una cadena distinta.
      //
      // El síntoma cuando muerde: un comercio cubierto por la clave de
      // PLATAFORMA —la que vive en la base, no en el entorno— ve esa función
      // apagada sin ningún error, y uno que trae SU PROPIA clave la ve correr
      // con la de Riverz.
      [join('lib', 'ai', 'borrador.ts'), 'PENDIENTE: sólo para la búsqueda de servidor'],
      [join('lib', 'instagram-agent', 'external-enrich.ts'), 'PENDIENTE: sin workspace en el alcance'],
      [join('lib', 'instagram-agent', 'profile-enrich.ts'), 'PENDIENTE: sin workspace en el alcance'],
      [join('lib', 'products', 'enrich.ts'), 'PENDIENTE: sólo comprueba que exista alguna'],
      [join('lib', 'products', 'model-provider.ts'), 'PENDIENTE: sin workspace en el alcance'],
      [join('app', 'api', 'ai', 'agents', 'generate-from-url', 'route.ts'), 'PENDIENTE'],
      [join('app', 'api', 'ai', 'agents', 'voice-setup', 'route.ts'), 'PENDIENTE'],
      [join('app', 'api', 'ai', 'instagram-agent', 'route.ts'), 'PENDIENTE'],
      [join('app', 'api', 'whatsapp', 'templates', 'generate', 'route.ts'), 'PENDIENTE'],
    ])
    const raiz = join(process.cwd(), 'src')
    const culpables: string[] = []
    const recorrer = (dir: string) => {
      for (const nombre of readdirSync(dir)) {
        const ruta = join(dir, nombre)
        if (statSync(ruta).isDirectory()) {
          if (nombre === 'node_modules' || nombre === '.next') continue
          recorrer(ruta)
        } else if (ruta.endsWith('.ts') && !ruta.endsWith('.test.ts')) {
          const rel = relative(raiz, ruta)
          if (PERMITIDOS.has(rel)) continue
          if (/process\.env\.ANTHROPIC_API_KEY/.test(readFileSync(ruta, 'utf8'))) {
            culpables.push(rel)
          }
        }
      }
    }
    recorrer(raiz)
    expect(
      culpables,
      `estos leen la clave del entorno salteándose resolveAnthropicKey:\n${culpables.join('\n')}`,
    ).toEqual([])
  })
})
