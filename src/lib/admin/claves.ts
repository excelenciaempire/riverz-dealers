import { supabaseAdmin } from '@/lib/channels/admin-client'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { invalidatePlatformKeyCache } from '@/lib/ai/platform-key'
import type { Concepto } from '@/lib/wallet/tarifas'

/**
 * Las llaves GLOBALES: las que Riverz pone y con las que trabajan los comercios.
 *
 * Son la otra mitad de la billetera. Cuando un comercio contesta con la llave
 * de Riverz, el consumo se le cobra a su saldo (`runner.ts` cobra siempre que
 * la fuente no sea `agent`, o sea siempre que no traiga la suya). Así que estas
 * llaves no son configuración: son el insumo que se revende, y por eso cada una
 * declara **qué conceptos de la billetera deja de poder cobrar si falta**.
 *
 * Hasta ahora vivían sólo en variables de entorno de Render, y cambiar una era
 * entrar al dashboard, editarla y esperar un redeploy. El 2026-08-28 eso se
 * notó de golpe: Gemini tenía una clave que no era una clave y OpenAI no tenía
 * ninguna, sin forma de arreglarlo desde donde se veía el problema.
 *
 * Cómo se resuelve una llave, en orden:
 *
 *   1. La del agente del comercio (BYOK) — sólo Anthropic, y la paga él.
 *   2. La que se cargó en el panel, cifrada en la base.
 *   3. La variable de entorno de Render, que queda de respaldo.
 *
 * El paso 2 no obliga a tocar un solo lugar donde hoy se lee `process.env`:
 * `hidratarClaves()` las vuelca al entorno del proceso al arrancar y en cada
 * latido del reloj, así que un cambio se aplica en menos de un minuto sin
 * redeploy y todo el código existente sigue leyendo lo de siempre.
 */

export type AlmacenDeClave = 'platform_keys' | 'platform_ai_settings'

export interface ProveedorConClave {
  id: string
  /** Nombre propio. No se traduce. */
  nombre: string
  /** La variable que lee el código hoy. Es la que se hidrata. */
  envVar: string
  /**
   * Cómo empieza la clave, cuando el proveedor usa un prefijo estable.
   *
   * Sirve para atajar el error más caro: pegar la llave de otro servicio deja
   * la plataforma sin ese proveedor y el fallo aparece recién en la próxima
   * respuesta a un cliente.
   */
  prefijo?: string
  /** Clave i18n de para qué se usa. */
  paraQueKey: string
  /**
   * Qué deja de poder cobrarse si esta llave falta.
   *
   * Es el vínculo con la billetera: sin Fish no hay `voz_tts`, sin Deepgram no
   * hay `voz_stt`. Una tarifa cuyo proveedor está caído es una tarifa que no se
   * puede facturar, y verlo acá evita cobrar por algo que no salió.
   */
  conceptos: Concepto[]
  /**
   * Dónde se guarda.
   *
   * Anthropic ya tenía la suya en `platform_ai_settings` desde que existe
   * /admin/ia, y ahí es donde la busca el resolvedor de BYOK. Moverla sería
   * tocar el camino más caliente del producto para no ganar nada: se escribe
   * donde ya vive, y las dos pantallas muestran el mismo valor.
   */
  almacen: AlmacenDeClave
}

/**
 * Los proveedores de IA y voz: los que se agotan y los que el comercio consume.
 *
 * Fuera quedan a propósito los circulares —Supabase y `ENCRYPTION_KEY`— que
 * hacen falta para leer y descifrar esta misma tabla, y los de comercio
 * (Shopify, Meta, Mercado Pago), que no se agotan y se conectan por OAuth desde
 * la cuenta de cada comercio.
 */
export const PROVEEDORES_CON_CLAVE: ProveedorConClave[] = [
  {
    id: 'anthropic',
    nombre: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    prefijo: 'sk-ant-',
    paraQueKey: 'admin.svcTextBot',
    conceptos: ['ia_respuesta', 'ia_operador', 'busqueda_web', 'investigacion'],
    almacen: 'platform_ai_settings',
  },
  {
    id: 'openai',
    nombre: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    prefijo: 'sk-',
    paraQueKey: 'admin.svcGpt',
    conceptos: [],
    almacen: 'platform_keys',
  },
  {
    id: 'groq',
    nombre: 'Groq',
    envVar: 'GROQ_API_KEY',
    prefijo: 'gsk_',
    paraQueKey: 'admin.svcBackupLlm',
    // Whisper: es el que transcribe las notas de voz que entran por chat.
    conceptos: ['voz_stt'],
    almacen: 'platform_keys',
  },
  {
    id: 'cerebras',
    nombre: 'Cerebras',
    envVar: 'CEREBRAS_API_KEY',
    prefijo: 'csk-',
    paraQueKey: 'admin.svcVoiceLlm',
    conceptos: ['llamada_voz'],
    almacen: 'platform_keys',
  },
  {
    id: 'gemini',
    nombre: 'Google Gemini',
    envVar: 'GEMINI_API_KEY',
    // Las de AI Studio empiezan con AIza. La que había puesta era un token de
    // otro tipo (`AQ.…`) y Google contestaba «Expected OAuth 2 access token».
    prefijo: 'AIza',
    paraQueKey: 'admin.svcNoBalanceApi',
    conceptos: ['llamada_voz'],
    almacen: 'platform_keys',
  },
  {
    id: 'telnyx',
    nombre: 'Telnyx',
    envVar: 'TELNYX_API_KEY',
    prefijo: 'KEY',
    paraQueKey: 'admin.svcTelephony',
    conceptos: ['llamada_voz'],
    almacen: 'platform_keys',
  },
  {
    id: 'deepgram',
    nombre: 'Deepgram',
    envVar: 'DEEPGRAM_API_KEY',
    paraQueKey: 'admin.svcStt',
    conceptos: ['voz_stt', 'llamada_voz'],
    almacen: 'platform_keys',
  },
  {
    id: 'fish',
    nombre: 'Fish Audio',
    envVar: 'FISH_API_KEY',
    paraQueKey: 'admin.svcTts',
    conceptos: ['voz_tts', 'llamada_voz'],
    almacen: 'platform_keys',
  },
  {
    id: 'elevenlabs',
    nombre: 'ElevenLabs',
    envVar: 'ELEVENLABS_API_KEY',
    prefijo: 'sk_',
    paraQueKey: 'admin.svcTtsPremium',
    conceptos: ['voz_tts'],
    almacen: 'platform_keys',
  },
  {
    id: 'apify',
    nombre: 'Apify',
    envVar: 'APIFY_TOKEN',
    prefijo: 'apify_api_',
    paraQueKey: 'admin.cronInstagramEnrich',
    conceptos: [],
    almacen: 'platform_keys',
  },
]

export function proveedorConClave(id: string): ProveedorConClave | undefined {
  return PROVEEDORES_CON_CLAVE.find((p) => p.id === id)
}

/** De dónde salió la clave que está usando el proceso. */
export type OrigenDeClave = 'panel' | 'render' | 'falta'

export interface EstadoDeClave {
  id: string
  nombre: string
  envVar: string
  paraQueKey: string
  conceptos: Concepto[]
  origen: OrigenDeClave
  /**
   * Prefijo y últimos cuatro: alcanza para reconocer una clave y no para
   * usarla. El texto plano NUNCA sale de acá.
   */
  pista: string | null
  actualizadaEn: string | null
}

/** `sk-ant-api03-abc…7f2a`, sin el medio. */
export function pistaDe(clave: string): string {
  const limpia = clave.trim()
  if (limpia.length <= 10) return '…'
  return `${limpia.slice(0, 7)}…${limpia.slice(-4)}`
}

// ────────────────────────────── Leer ──────────────────────────────

interface FilaClave {
  proveedor: string
  pista: string
  updated_at: string | null
}

/** Qué hay cargado en el panel, sin descifrar nada. */
async function filasDelPanel(): Promise<Map<string, FilaClave>> {
  const mapa = new Map<string, FilaClave>()
  try {
    const { data } = await supabaseAdmin()
      .from('platform_keys')
      .select('proveedor, pista, updated_at')
    for (const f of (data ?? []) as FilaClave[]) mapa.set(f.proveedor, f)
  } catch {
    // La migración 219 puede no estar aplicada todavía: sin tabla, todas las
    // llaves vienen de Render y la pantalla lo dice.
  }
  return mapa
}

/** La de Anthropic, que vive en su propia tabla desde /admin/ia. */
async function anthropicDelPanel(): Promise<{
  pista: string
  updated_at: string | null
} | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('platform_ai_settings')
      .select('anthropic_key_encrypted, updated_at')
      .eq('id', true)
      .maybeSingle()
    const row = data as {
      anthropic_key_encrypted?: string | null
      updated_at?: string
    } | null
    if (!row?.anthropic_key_encrypted) return null
    return {
      pista: pistaDe(decrypt(row.anthropic_key_encrypted)),
      updated_at: row.updated_at ?? null,
    }
  } catch {
    return null
  }
}

/**
 * El estado de cada llave, para el panel.
 *
 * `origen` contesta la pregunta que importa antes de borrar nada: si esta
 * llave sale del panel o de Render. Sin eso, «eliminar» sería una sorpresa —
 * borrar la del panel devuelve el control a la variable de entorno, y a veces
 * ahí hay una vieja que vuelve a estar activa.
 */
export async function leerEstadoDeClaves(): Promise<EstadoDeClave[]> {
  const [panel, anthropic] = await Promise.all([filasDelPanel(), anthropicDelPanel()])

  return PROVEEDORES_CON_CLAVE.map((p) => {
    const propia =
      p.almacen === 'platform_ai_settings'
        ? anthropic && {
            pista: anthropic.pista,
            updated_at: anthropic.updated_at,
          }
        : panel.get(p.id)
    const enRender = Boolean(process.env[p.envVar])

    const origen: OrigenDeClave = propia ? 'panel' : enRender ? 'render' : 'falta'
    return {
      id: p.id,
      nombre: p.nombre,
      envVar: p.envVar,
      paraQueKey: p.paraQueKey,
      conceptos: p.conceptos,
      origen,
      pista: propia ? propia.pista : enRender ? pistaDe(process.env[p.envVar] as string) : null,
      actualizadaEn: propia?.updated_at ?? null,
    }
  })
}

// ────────────────────────────── Escribir ──────────────────────────────

export type ResultadoGuardar = { ok: true } | { ok: false; error: string }

/**
 * Cargar o cambiar una llave.
 *
 * Se valida el prefijo antes de guardar. No es burocracia: pegar la llave de
 * otro servicio deja al proveedor caído y el fallo no aparece acá, aparece en
 * la próxima respuesta a un cliente.
 */
export async function guardarClave(
  id: string,
  valor: string,
  usuario: string | null
): Promise<ResultadoGuardar> {
  const p = proveedorConClave(id)
  if (!p) return { ok: false, error: 'proveedor desconocido' }

  const clave = valor.trim()
  if (!clave) return { ok: false, error: 'clave vacía' }
  if (p.prefijo && !clave.startsWith(p.prefijo)) {
    return {
      ok: false,
      error: `la clave de ${p.nombre} empieza por ${p.prefijo}`,
    }
  }

  const cifrada = encrypt(clave)
  const db = supabaseAdmin()

  if (p.almacen === 'platform_ai_settings') {
    const { error } = await db
      .from('platform_ai_settings')
      .update({
        anthropic_key_encrypted: cifrada,
        updated_at: new Date().toISOString(),
        updated_by: usuario,
      })
      .eq('id', true)
    if (error) return { ok: false, error: error.message }
    invalidatePlatformKeyCache()
  } else {
    const { error } = await db.from('platform_keys').upsert(
      {
        proveedor: p.id,
        clave_cifrada: cifrada,
        pista: pistaDe(clave),
        updated_at: new Date().toISOString(),
        updated_by: usuario,
      },
      { onConflict: 'proveedor' }
    )
    if (error) return { ok: false, error: error.message }
  }

  // Que valga YA en este proceso, sin esperar al próximo latido.
  process.env[p.envVar] = clave
  return { ok: true }
}

/**
 * Quitar la llave del panel.
 *
 * No apaga al proveedor: lo devuelve a la variable de entorno de Render, que es
 * lo que había antes. La pantalla muestra el origen justamente para que eso no
 * sorprenda.
 */
export async function borrarClave(id: string): Promise<ResultadoGuardar> {
  const p = proveedorConClave(id)
  if (!p) return { ok: false, error: 'proveedor desconocido' }
  const db = supabaseAdmin()

  if (p.almacen === 'platform_ai_settings') {
    const { error } = await db
      .from('platform_ai_settings')
      .update({
        anthropic_key_encrypted: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    if (error) return { ok: false, error: error.message }
    invalidatePlatformKeyCache()
  } else {
    const { error } = await db.from('platform_keys').delete().eq('proveedor', p.id)
    if (error) return { ok: false, error: error.message }
  }

  // El proceso vuelve a lo que haya en Render. `RENDER_ENV` guarda el valor
  // original justamente para poder volver: una vez que se pisó `process.env`,
  // el valor de arranque ya no está en ningún lado.
  const original = RENDER_ENV.get(p.envVar)
  if (original) process.env[p.envVar] = original
  else delete process.env[p.envVar]
  return { ok: true }
}

// ────────────────────────────── Hidratar ──────────────────────────────

/**
 * Lo que Render puso al arrancar, antes de que nadie lo pise.
 *
 * Se congela en el primer `hidratarClaves()`: sin esto, borrar una llave del
 * panel dejaría al proceso con la del panel puesta y sin forma de recuperar la
 * de Render hasta el próximo reinicio.
 */
const RENDER_ENV = new Map<string, string>()

/**
 * Volcar al entorno del proceso las llaves cargadas en el panel.
 *
 * Es lo que hace que no haya que tocar ni un `process.env.X` de los que ya
 * existen: se corre al arrancar (`instrumentation.ts`) y en cada latido del
 * reloj, así que un cambio tarda como mucho un minuto en valer en todas las
 * instancias.
 */
export async function hidratarClaves(): Promise<number> {
  if (RENDER_ENV.size === 0) {
    for (const p of PROVEEDORES_CON_CLAVE) {
      const v = process.env[p.envVar]
      if (v) RENDER_ENV.set(p.envVar, v)
    }
  }

  let puestas = 0
  try {
    const { data } = await supabaseAdmin().from('platform_keys').select('proveedor, clave_cifrada')
    for (const f of (data ?? []) as {
      proveedor: string
      clave_cifrada: string
    }[]) {
      const p = proveedorConClave(f.proveedor)
      if (!p) continue
      try {
        process.env[p.envVar] = decrypt(f.clave_cifrada)
        puestas++
      } catch {
        // Clave ilegible (se rotó ENCRYPTION_KEY): mejor quedarse con la de
        // Render que dejar al proveedor sin ninguna.
      }
    }
  } catch {
    // Sin tabla o sin base, el proceso sigue con lo de Render.
  }
  return puestas
}
