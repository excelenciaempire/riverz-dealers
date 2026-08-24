import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ninguna redirección puede salir de `request.url`.
 *
 * Detrás del proxy de Render, `request.url` es la dirección INTERNA del
 * servicio: `https://localhost:10000/…`. Una redirección construida sobre eso
 * le manda al navegador de una persona un `localhost` que no existe en su
 * máquina, y lo que ve es ERR_CONNECTION_REFUSED.
 *
 * Medido en producción el 2026-08-24 sobre `/api/shopify/install`, que es
 * justamente el camino de instalar desde la tienda de aplicaciones de Shopify
 * —donde NADIE llega con la sesión abierta—: el comercio apretaba "instalar" y
 * caía en una página muerta. La misma línea estaba en el arranque del OAuth de
 * todos los canales.
 *
 * El destino sale de `publicBaseUrl()`, que es el único que sabe cuál es el
 * dominio de verdad.
 */

const RAIZ = join(process.cwd(), 'src', 'app', 'api')

/** `NextResponse.redirect(new URL('…', req.url))` en cualquiera de sus formas. */
const SOSPECHA = /NextResponse\.redirect\(\s*new URL\([^)]*,\s*(request|req)\.url\s*\)/

function rutas(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) rutas(ruta, acc)
    else if (nombre === 'route.ts') acc.push(ruta)
  }
  return acc
}

describe('las redirecciones salen al dominio público', () => {
  it('ninguna ruta redirige usando request.url', () => {
    const encontrado: string[] = []
    for (const ruta of rutas(RAIZ)) {
      const rel = ruta.slice(join(process.cwd(), 'src').length + 1).replace(/\\/g, '/')
      const lineas = readFileSync(ruta, 'utf8').split('\n')
      lineas.forEach((linea, i) => {
        const t = linea.trim()
        if (t.startsWith('//') || t.startsWith('*')) return
        if (SOSPECHA.test(linea)) encontrado.push(`${rel}:${i + 1}`)
      })
    }
    expect(
      encontrado,
      `Usa publicBaseUrl() como base:\n${encontrado.join('\n')}`,
    ).toEqual([])
  })
})
