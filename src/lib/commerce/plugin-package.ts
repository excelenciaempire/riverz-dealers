import { readFile } from 'fs/promises'
import path from 'path'
import { createZip, type ZipEntry } from './zip'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('commerce.plugin-package')

/**
 * Empaquetado del plugin de WooCommerce, compartido por las dos vías que
 * lo entregan:
 *
 *  - Ajustes del comercio: sale con SU dirección y SU secreto ya puestos,
 *    para que instalarlo sea un paso y no una copia de credenciales entre
 *    dos paneles.
 *  - Panel de plataforma: sale en limpio, SIN secreto. El panel es
 *    solo-metadatos por decisión, y un secreto de tienda no tiene nada que
 *    hacer ahí; el comercio lo pega desde sus propios Ajustes.
 */

const PLUGIN_DIR = path.join(process.cwd(), 'wordpress-plugin', 'riverz-cart-recovery')

const FILES = [
  'riverz-cart-recovery.php',
  'readme.txt',
  path.join('assets', 'riverz-checkout.js'),
]

export const PLUGIN_FILENAME = 'riverz-cart-recovery.zip'

/**
 * Arma el zip. Si `credentials` viene, deja la dirección y el secreto
 * como valores por defecto del plugin; si no, el archivo queda tal cual
 * está en el repositorio.
 */
export async function buildPluginZip(
  credentials?: { endpoint: string; secret: string },
): Promise<Buffer> {
  const entries: ZipEntry[] = []
  for (const file of FILES) {
    let content = await readFile(path.join(PLUGIN_DIR, file), 'utf8')
    if (credentials && file === 'riverz-cart-recovery.php') {
      content = withDefaults(content, credentials.endpoint, credentials.secret)
    }
    entries.push({
      path: `riverz-cart-recovery/${file.split(path.sep).join('/')}`,
      content,
    })
  }
  return createZip(entries)
}

/** Cabeceras de descarga. Sin caché cuando lleva credenciales adentro. */
export function pluginHeaders(size: number, hasSecret: boolean): HeadersInit {
  return {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${PLUGIN_FILENAME}"`,
    'Content-Length': String(size),
    'Cache-Control': hasSecret ? 'private, no-store' : 'private, max-age=300',
  }
}

/**
 * Reemplaza el bloque de `$defaults` en lugar de inyectar código nuevo,
 * así el archivo distribuido sigue siendo el mismo que está en el
 * repositorio salvo esos dos valores.
 *
 * Si el bloque no aparece (alguien cambió la forma del plugin) devolvemos
 * el original: el comercio pega las credenciales a mano, que es peor
 * experiencia pero no un plugin roto.
 */
function withDefaults(php: string, endpoint: string, secret: string): string {
  const pattern = /\$defaults = array\(\s*'endpoint' => '[^']*',\s*'secret'\s*=> '[^']*',/
  if (!pattern.test(php)) {
    log.warn('plugin_defaults_pattern_missing')
    return php
  }
  // Escapamos barras y comillas simples: es lo único capaz de romper una
  // cadena entre comillas simples en PHP.
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return php.replace(
    pattern,
    `$defaults = array(\n\t\t'endpoint' => '${esc(endpoint)}',\n\t\t'secret'   => '${esc(secret)}',`,
  )
}
