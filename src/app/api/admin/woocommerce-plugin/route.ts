import { NextResponse } from 'next/server'
import { adminGet } from '@/lib/admin/route'
import { buildPluginZip, pluginHeaders } from '@/lib/commerce/plugin-package'

export const dynamic = 'force-dynamic'

/**
 * Descarga del plugin de WooCommerce desde el panel de plataforma, para
 * que el equipo pueda pasárselo a un comercio que lo está montando.
 *
 * Sale EN LIMPIO, sin la dirección ni el secreto de ninguna tienda. El
 * panel es solo-metadatos por decisión: servir desde acá la credencial de
 * un comercio rompería esa garantía, y además el propio comercio ya tiene
 * su copia configurada en Ajustes → Canales. Quien reciba este archivo
 * pega su secreto una vez.
 *
 * `adminGet` resuelve la puerta del equipo, el límite de ritmo y el
 * registro en auditoría; el handler devuelve su propia respuesta porque
 * el cuerpo es binario y no JSON.
 */
export async function GET(request: Request) {
  return adminGet(
    request,
    { action: 'download.woocommerce_plugin' },
    async () => {
      const zip = await buildPluginZip()
      return new NextResponse(new Uint8Array(zip), {
        headers: pluginHeaders(zip.length, false),
      })
    },
  )
}
