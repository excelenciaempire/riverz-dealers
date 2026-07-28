import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createZip, type ZipEntry } from '@/lib/commerce/zip'
import { getStoreForWorkspace, getStoreWebhookSecret } from '@/lib/commerce/connection'
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve'
import { getLogger } from '@/lib/log/logger'

const log = getLogger('woocommerce.plugin')

/**
 * Descarga del plugin de WordPress, ya configurado.
 *
 * El zip sale armado con la dirección de este servidor y el secreto de
 * ESTA tienda pre-cargados, así que el comercio lo instala y funciona:
 * no tiene que copiar credenciales entre dos paneles, que es donde se
 * pierde la mitad de la gente.
 *
 * Por eso la ruta exige sesión y resuelve el workspace desde ella. El
 * archivo lleva un secreto adentro: servirlo sin autenticar sería
 * publicar la credencial de la tienda.
 */

const PLUGIN_DIR = path.join(process.cwd(), 'wordpress-plugin', 'riverz-cart-recovery')

const FILES = [
  'riverz-cart-recovery.php',
  'readme.txt',
  path.join('assets', 'riverz-checkout.js'),
]

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id)
  if (!workspaceId) {
    return NextResponse.json({ error: 'no workspace' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const store = await getStoreForWorkspace(admin, 'woocommerce', workspaceId)
  if (!store || store.status !== 'active') {
    return NextResponse.json({ error: 'not_connected' }, { status: 400 })
  }

  const secret = await getStoreWebhookSecret(admin, 'woocommerce', store.shopDomain)
  if (!secret) {
    return NextResponse.json({ error: 'no_secret' }, { status: 500 })
  }

  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin

    const entries: ZipEntry[] = []
    for (const file of FILES) {
      let content = await readFile(path.join(PLUGIN_DIR, file), 'utf8')
      if (file === 'riverz-cart-recovery.php') {
        content = withDefaults(content, base, secret)
      }
      entries.push({
        path: `riverz-cart-recovery/${file.split(path.sep).join('/')}`,
        content,
      })
    }

    const zip = createZip(entries)

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="riverz-cart-recovery.zip"',
        'Content-Length': String(zip.length),
        // Lleva un secreto: que no quede en ninguna caché intermedia.
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    log.captureException(err, { workspaceId })
    return NextResponse.json({ error: 'build_failed' }, { status: 500 })
  }
}

/**
 * Deja la dirección y el secreto ya puestos como valores por defecto del
 * plugin. Se reemplaza el bloque de `$defaults` en lugar de inyectar
 * código nuevo, así el archivo distribuido sigue siendo el mismo que está
 * en el repositorio salvo esos dos valores.
 *
 * Si el bloque no se encuentra (alguien tocó el plugin y cambió su
 * forma), devolvemos el original: el comercio pega las credenciales a
 * mano, que es peor experiencia pero no un plugin roto.
 */
function withDefaults(php: string, endpoint: string, secret: string): string {
  const pattern = /\$defaults = array\(\s*'endpoint' => '[^']*',\s*'secret'\s*=> '[^']*',/
  if (!pattern.test(php)) {
    log.warn('plugin_defaults_pattern_missing')
    return php
  }
  // Escapamos comillas simples y barras: es lo único que puede romper una
  // cadena entre comillas simples en PHP.
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return php.replace(
    pattern,
    `$defaults = array(\n\t\t'endpoint' => '${esc(endpoint)}',\n\t\t'secret'   => '${esc(secret)}',`,
  )
}
