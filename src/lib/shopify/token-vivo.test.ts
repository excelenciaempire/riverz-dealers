import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { venceProximo } from './token-vivo'

/**
 * El token de Shopify dura UNA HORA desde que dejaron de aceptar los que no
 * expiran. Renovarlo a tiempo es lo único que mantiene viva una tienda: sin
 * esto deja de contestar sesenta minutos después de conectarse, y en silencio.
 */
describe('cuándo hay que renovar', () => {
  const AHORA = Date.parse('2026-08-24T12:00:00Z')

  it('un token de los viejos no se renueva nunca', () => {
    // Sin fecha = token que no expira. Siguen andando hasta que Shopify los
    // corte, y no tienen refresh: forzarles una renovación los rompería antes
    // de tiempo.
    expect(venceProximo(null, AHORA)).toBe(false)
  })

  it('con media hora por delante, todavía no', () => {
    expect(venceProximo('2026-08-24T12:30:00Z', AHORA)).toBe(false)
  })

  it('a cinco minutos de vencer, sí', () => {
    // El margen no es cero a propósito: entre leer la fila y que Shopify
    // conteste pasa tiempo, y un token que vence a mitad de una sincronización
    // deja la mitad del catálogo adentro y la mitad afuera.
    expect(venceProximo('2026-08-24T12:04:00Z', AHORA)).toBe(true)
  })

  it('ya vencido, también', () => {
    expect(venceProximo('2026-08-24T11:00:00Z', AHORA)).toBe(true)
  })

  it('respeta la ventana preventiva del cron de quince minutos', () => {
    expect(venceProximo('2026-08-24T12:18:00Z', AHORA, 20 * 60_000)).toBe(true)
    expect(venceProximo('2026-08-24T12:21:00Z', AHORA, 20 * 60_000)).toBe(false)
  })

  it('una fecha ilegible no dispara una renovación a ciegas', () => {
    expect(venceProximo('cualquier cosa', AHORA)).toBe(false)
  })
})

describe('renovar', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('SHOPIFY_API_KEY', 'llave')
    vi.stubEnv('SHOPIFY_API_SECRET', 'secreto')
    vi.stubEnv(
      'ENCRYPTION_KEY',
      '0000000000000000000000000000000000000000000000000000000000000000',
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  /** Un cliente de Supabase mínimo que recuerda el UPDATE. */
  function baseFalsa() {
    const escrito: Record<string, unknown>[] = []
    return {
      escrito,
      from() {
        return {
          update(parche: Record<string, unknown>) {
            escrito.push(parche)
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      },
    }
  }

  it('guarda el refresh NUEVO, no sólo el access', async () => {
    // Shopify devuelve un refresh distinto en cada renovación. Quedarse con el
    // viejo funciona una vez y a la siguiente deja la tienda afuera, noventa
    // días después, sin que nadie haya tocado nada.
    const { encrypt } = await import('@/lib/whatsapp/encryption')
    const { tokenVivo } = await import('./token-vivo')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: 'shpua_nuevo',
            scope: 'read_orders',
            expires_in: 3600,
            refresh_token: 'refresh_nuevo',
            refresh_token_expires_in: 7776000,
          }),
          { status: 200 },
        ),
      ),
    )

    const db = baseFalsa()
    const r = await tokenVivo(db as never, {
      id: 'c1',
      shop_domain: 'demo.myshopify.com',
      access_token: encrypt('shpua_viejo'),
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_encrypted: encrypt('refresh_viejo'),
      refresh_token_expires_at: null,
      connection_method: 'oauth',
      client_id_encrypted: null,
      webhook_secret: null,
    })

    expect(r.renovado).toBe(true)
    expect(r.accessToken).toBe('shpua_nuevo')
    const parche = db.escrito[0]
    expect(parche.refresh_token_encrypted).toBeTruthy()
    expect(parche.token_expires_at).toBeTruthy()
    expect(parche.status).toBe('active')
  })

  it('si la renovación falla, devuelve el token viejo y no rompe la conversación', async () => {
    const { encrypt } = await import('@/lib/whatsapp/encryption')
    const { tokenVivo } = await import('./token-vivo')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 400 })))

    const db = baseFalsa()
    const r = await tokenVivo(db as never, {
      id: 'c1',
      shop_domain: 'demo.myshopify.com',
      access_token: encrypt('shpua_viejo'),
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_encrypted: encrypt('refresh_viejo'),
      refresh_token_expires_at: null,
      connection_method: 'oauth',
      client_id_encrypted: null,
      webhook_secret: null,
    })

    expect(r.renovado).toBe(false)
    expect(r.accessToken).toBe('shpua_viejo')
    // Y queda anotado por qué, que es lo único que después permite averiguarlo.
    expect(String(db.escrito[0]?.last_error)).toContain('renovar')
  })

  it('un token que no expira sale tal cual, sin pedirle nada a Shopify', async () => {
    const { encrypt } = await import('@/lib/whatsapp/encryption')
    const { tokenVivo } = await import('./token-vivo')
    const llamadas = vi.fn()
    vi.stubGlobal('fetch', llamadas)

    const db = baseFalsa()
    const r = await tokenVivo(db as never, {
      id: 'c1',
      shop_domain: 'demo.myshopify.com',
      access_token: encrypt('shpca_viejo'),
      token_expires_at: null,
      refresh_token_encrypted: null,
      refresh_token_expires_at: null,
      connection_method: 'admin_token',
      client_id_encrypted: null,
      webhook_secret: null,
    })

    expect(r.accessToken).toBe('shpca_viejo')
    expect(r.renovado).toBe(false)
    expect(llamadas).not.toHaveBeenCalled()
  })
})
