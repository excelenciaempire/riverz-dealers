import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Un id externo NO identifica una fila.
 *
 * El wamid de WhatsApp, el mid de Meta y el id de un comentario son únicos en
 * la plataforma, pero no en nuestra base: la misma página, la misma cuenta de
 * Instagram o el mismo número pueden estar conectados en DOS workspaces a la
 * vez —está soportado a propósito, y el enrutador del webhook le entrega el
 * evento a los dos—. Buscar por `message_id` a secas devuelve las dos filas; y
 * un UPDATE con ese filtro escribe en las dos, que es cómo la reacción del
 * cliente de un comercio aterrizaba sobre el mensaje de otro.
 *
 * PostgREST no puede filtrar un UPDATE a través de una relación embebida, así
 * que la única salida es buscar primero, con alcance, y escribir por
 * `messages.id`. Eso vive en `message-lookup.ts`, y este test es lo que impide
 * que el atajo vuelva a aparecer en el sitio número trece.
 */

const RAIZ = join(process.cwd(), 'src')

/**
 * Excepciones, cada una con su motivo. La lista es corta a propósito: si crece,
 * es que el atajo volvió.
 */
const PERMITIDOS = new Map([
  [join('lib', 'channels', 'message-lookup.ts'), 'es el módulo que hace el alcance'],
  [
    join('lib', 'channels', 'comment-echo.ts'),
    'lee sin acotar y se queda SOLO con la conversación del workspace en la consulta siguiente',
  ],
  [
    join('app', 'api', 'whatsapp', 'webhook', 'route.ts'),
    'migración 076: whatsapp_config.phone_number_id es único a nivel global, ' +
      'así que un número pertenece a un solo comercio y el wamid no puede colisionar',
  ],
])

function archivosTs(dir: string, out: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) {
      if (nombre === 'node_modules' || nombre === '.next') continue
      archivosTs(ruta, out)
    } else if (
      (ruta.endsWith('.ts') || ruta.endsWith('.tsx')) &&
      !ruta.endsWith('.test.ts') &&
      !ruta.endsWith('.test.tsx')
    ) {
      out.push(ruta)
    }
  }
  return out
}

describe('nadie busca ni escribe en messages por el id externo, sin alcance', () => {
  it('`.eq("message_id", …)` sobre messages sólo existe en message-lookup.ts', () => {
    const culpables: string[] = []
    for (const ruta of archivosTs(RAIZ)) {
      const rel = relative(join(process.cwd(), 'src'), ruta)
      if (PERMITIDOS.has(rel)) continue
      const src = readFileSync(ruta, 'utf8')

      // Bloques que arrancan en `.from("messages")` / `.from('messages')` y
      // llegan hasta el próximo `.from(` o el final: el filtro tiene que estar
      // dentro de la misma consulta para contar.
      const partes = src.split(/\.from\(\s*['"]messages['"]\s*\)/)
      for (let i = 1; i < partes.length; i++) {
        const bloque = partes[i].split(/\.from\(/)[0]
        if (!/\.eq\(\s*['"]message_id['"]/.test(bloque)) continue
        // Dos formas válidas de acotar: el join a `conversations` con su
        // filtro por workspace (la de `message-lookup.ts`), o el filtro por
        // conversación — una conversación pertenece a un solo comercio.
        const conAlcance =
          (/conversations!inner\s*\(\s*workspace_id/.test(bloque) &&
            /\.eq\(\s*['"]conversations\.workspace_id['"]/.test(bloque)) ||
          /\.eq\(\s*['"]conversation_id['"]/.test(bloque)
        if (!conAlcance) {
          culpables.push(rel)
          break
        }
      }
    }

    expect(
      culpables,
      `estos leen o escriben messages por el id externo sin alcance de workspace:\n` +
        `${culpables.join('\n')}\n\n` +
        `Usá findMessageByExternalId / findMessagesByExternalIds de ` +
        `lib/channels/message-lookup.ts y escribí por .eq('id', …).`,
    ).toEqual([])
  })
})
