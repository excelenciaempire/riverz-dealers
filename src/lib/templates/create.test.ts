import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { crearPlantilla } from './create'
import { OUTBOUND_CAPABILITIES } from '@/lib/capabilities/outbound'
import type { CapabilityContext } from '@/lib/capabilities/types'

/**
 * Las dos mitades de una plantilla: escribirla y mandarla.
 *
 * Lo que se fija acá es la línea entre las dos. Un borrador NO puede tocar
 * Meta —ni siquiera necesita WhatsApp conectado— y mandarlo sí. Si esa línea se
 * corre, el Operador manda plantillas a aprobación creyendo que las guarda, y
 * en Meta el nombre queda tomado para siempre aunque la rechacen.
 *
 * También fija el orden de los errores, que es el contrato HTTP que la route
 * tenía inline: mismo código y mismo motivo para el mismo pedido mal armado.
 */

// `vi.mock` se iza arriba de todo: lo que usen las fábricas tiene que existir
// antes que ellas, y para eso está `vi.hoisted`.
const meta = vi.hoisted(() => {
  class MetaApiErrorFalso extends Error {
    detail?: string
    constructor(message: string, detail?: string) {
      super(message)
      this.detail = detail
    }
  }
  return {
    MetaApiErrorFalso,
    enviadas: [] as Array<Record<string, unknown>>,
    falla: null as Error | null,
    conexionDelWorkspace: null as Record<string, unknown> | null,
  }
})

vi.mock('@/lib/whatsapp/meta-api', () => ({
  MetaApiError: meta.MetaApiErrorFalso,
  createMessageTemplate: vi.fn(async (args: Record<string, unknown>) => {
    if (meta.falla) throw meta.falla
    meta.enviadas.push(args)
    return { id: 'meta-1', status: 'PENDING' }
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `claro:${v}`,
}))

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        neq: self,
        order: self,
        limit: self,
        maybeSingle: async () => ({ data: meta.conexionDelWorkspace, error: null }),
      })
      return chain
    },
  }),
}))

const enviadasAMeta = meta.enviadas

const WS = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'

interface Estado {
  plantillas: Array<Record<string, unknown>>
  config: Record<string, unknown> | null
  insertadas: Array<Record<string, unknown>>
  actualizadas: Array<{ id: unknown; row: Record<string, unknown> }>
  errorAlEscribir: { message: string } | null
}

let estado: Estado

/** Supabase de mentira: filtra por los `eq` que le vayan llegando. */
function fakeDb(): SupabaseClient {
  const api = {
    from(table: string) {
      const filtros: Record<string, unknown> = {}
      let escritura: { op: 'insert' | 'update'; row: Record<string, unknown> } | null = null

      const filas = () => {
        const fuente =
          table === 'message_templates'
            ? estado.plantillas
            : table === 'whatsapp_config'
              ? estado.config
                ? [{ user_id: USER, ...estado.config }]
                : []
              : table === 'workspaces'
                ? [{ id: WS, owner_id: USER }]
                : []
        return fuente.filter((f) =>
          Object.entries(filtros).every(([k, v]) => (f as Record<string, unknown>)[k] === v),
        )
      }

      const aplicarEscritura = () => {
        if (estado.errorAlEscribir) return { data: null, error: estado.errorAlEscribir }
        if (escritura?.op === 'insert') {
          const fila = { id: `pl-${estado.plantillas.length + 1}`, ...escritura.row }
          estado.plantillas.push(fila)
          estado.insertadas.push(escritura.row)
          return { data: { id: fila.id }, error: null }
        }
        const id = filtros.id
        estado.actualizadas.push({ id, row: escritura!.row })
        const actual = estado.plantillas.find((p) => p.id === id)
        if (actual) Object.assign(actual, escritura!.row)
        return { data: { id }, error: null }
      }

      const uno = async () =>
        escritura
          ? aplicarEscritura()
          : { data: (filas()[0] as Record<string, unknown> | undefined) ?? null, error: null }

      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        order: self,
        limit: self,
        neq: self,
        eq(col: string, val: unknown) {
          filtros[col] = val
          return chain
        },
        insert(row: Record<string, unknown>) {
          escritura = { op: 'insert', row }
          return chain
        },
        update(row: Record<string, unknown>) {
          escritura = { op: 'update', row }
          return chain
        },
        maybeSingle: uno,
        single: uno,
        // La búsqueda por nombre resuelve la cadena entera, sin `maybeSingle`.
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: filas(), error: null }).then(ok),
      })
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

function ctx(): CapabilityContext {
  return {
    db: fakeDb(),
    workspaceId: WS,
    actor: { type: 'operator', id: USER },
    locale: 'es',
  }
}

function capacidad(key: string) {
  const cap = OUTBOUND_CAPABILITIES.find((c) => c.key === key)
  if (!cap) throw new Error(`falta ${key}`)
  return cap
}

const BASE = {
  workspaceId: WS,
  userId: USER,
  nombre: 'Carrito Abandonado!',
  bodyText: 'Hola {{1}}, dejaste algo en el carrito.',
  bodySamples: ['Ana'],
}

beforeEach(() => {
  estado = {
    plantillas: [],
    config: { waba_id: 'waba-1', access_token: 'cifrado' },
    insertadas: [],
    actualizadas: [],
    errorAlEscribir: null,
  }
  enviadasAMeta.length = 0
  meta.falla = null
  meta.conexionDelWorkspace = null
})

describe('crearPlantilla', () => {
  it('el borrador se guarda y NO sale a Meta', async () => {
    const r = await crearPlantilla(fakeDb(), { ...BASE, enviarAMeta: false })
    expect(r.ok).toBe(true)
    expect(enviadasAMeta).toHaveLength(0)
    expect(estado.insertadas[0].status).toBe('Draft')
    expect(estado.insertadas[0].meta_template_id).toBeNull()
  })

  it('un borrador no exige WhatsApp conectado', async () => {
    estado.config = null
    const r = await crearPlantilla(fakeDb(), { ...BASE, enviarAMeta: false })
    expect(r.ok).toBe(true)
  })

  it('enviar exige WhatsApp conectado', async () => {
    estado.config = null
    const r = await crearPlantilla(fakeDb(), BASE)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
    expect(r.claveI18n).toBe('whatsappNotConnected')
  })

  it('enviado: viaja a Meta y queda Pending con el id que devolvió', async () => {
    const r = await crearPlantilla(fakeDb(), BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.estadoMeta).toBe('PENDING')
    expect(r.metaTemplateId).toBe('meta-1')
    expect(enviadasAMeta[0].wabaId).toBe('waba-1')
    // El token sale descifrado o Meta contesta 401.
    expect(enviadasAMeta[0].accessToken).toBe('claro:cifrado')
    expect(estado.insertadas[0].status).toBe('Pending')
  })

  it('el nombre se normaliza al snake_case que exige Meta', async () => {
    const r = await crearPlantilla(fakeDb(), BASE)
    expect(r.ok && r.name).toBe('carrito_abandonado')
  })

  it('sin conexión propia cae a la del workspace (Embedded Signup)', async () => {
    estado.config = null
    meta.conexionDelWorkspace = { config: { waba_id: 'waba-2' }, secrets: { access_token: 'c2' } }
    const r = await crearPlantilla(fakeDb(), BASE)
    expect(r.ok).toBe(true)
    expect(enviadasAMeta[0].wabaId).toBe('waba-2')
  })

  it('el motivo real de Meta gana sobre el mensaje genérico', async () => {
    meta.falla = new meta.MetaApiErrorFalso('Invalid parameter', 'El cuerpo no puede tener emojis')
    const r = await crearPlantilla(fakeDb(), BASE)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.mensaje).toBe('El cuerpo no puede tener emojis')
  })

  it('si Meta la aceptó y el espejo falló, lo dice con el id de Meta', async () => {
    estado.errorAlEscribir = { message: 'columna rara' }
    const r = await crearPlantilla(fakeDb(), BASE)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(500)
    expect(r.claveI18n).toBe('templateSentButMirrorFailed')
    expect(r.metaTemplateId).toBe('meta-1')
  })

  it('mantiene el orden de errores de la route: nombre antes que cuenta', async () => {
    const sinNombre = await crearPlantilla(fakeDb(), { ...BASE, nombre: '', workspaceId: null })
    expect(sinNombre.ok === false && sinNombre.claveI18n).toBe('templateNameRequired')

    const sinCuenta = await crearPlantilla(fakeDb(), { ...BASE, workspaceId: null })
    expect(sinCuenta.ok === false && sinCuenta.claveI18n).toBe('workspaceResolveFailed')

    const categoriaMala = await crearPlantilla(fakeDb(), { ...BASE, categoria: 'PROMO' })
    expect(categoriaMala.ok === false && categoriaMala.claveI18n).toBe('invalidCategory')

    // La validación de componentes trae su propio texto, no una clave.
    const sinEjemplo = await crearPlantilla(fakeDb(), { ...BASE, bodySamples: [] })
    expect(sinEjemplo.ok === false && sinEjemplo.status).toBe(400)
    expect(sinEjemplo.ok === false && sinEjemplo.mensaje).toMatch(/ejemplo/i)
  })

  it('pisa la fila que le indican en vez de insertar otra', async () => {
    estado.plantillas.push({
      id: 'pl-9',
      workspace_id: WS,
      user_id: 'otro-usuario',
      name: 'carrito_abandonado',
      language: 'es',
      status: 'Draft',
    })
    await crearPlantilla(fakeDb(), { ...BASE, plantillaExistenteId: 'pl-9' })
    expect(estado.insertadas).toHaveLength(0)
    expect(estado.actualizadas[0].id).toBe('pl-9')
  })
})

describe('capacidades de plantillas', () => {
  it('crear la escribe, la manda a Meta y la dibuja', async () => {
    // Eran dos aprobaciones para una sola cosa, y entre las dos quedaba una
    // plantilla a medias en la lista del comercio: no sirve para enviar, no
    // está en revisión, y hay que acordarse de volver.
    const cap = capacidad('plantillas.crear')
    const args = {
      nombre: 'Bienvenida VIP',
      cuerpo: 'Hola {{1}}, gracias por tu compra.',
      ejemplos: ['Ana'],
      pie: 'Riverz',
      botones: [{ texto: 'Ver pedido', tipo: 'url', url: 'https://riverz.co' }],
    }
    const c = ctx()
    const r = (await cap.run(c, args)) as Record<string, unknown>
    expect(r.estado).toBe('en_revision')
    expect(enviadasAMeta).toHaveLength(1)
    expect(estado.insertadas[0].name).toBe('bienvenida_vip')

    // El dibujo sale de los ARGUMENTOS: es lo que hace que el mensaje se lea
    // en su teléfono mientras esto todavía es una propuesta.
    const art = cap.artifact?.(c, args, r)
    expect(art?.kind).toBe('plantilla')
    expect(art).toMatchObject({ nombre: 'bienvenida_vip' })
  })

  it('es irreversible, y la linea dice cual es sin condicional', async () => {
    // El nombre queda tomado en ese WhatsApp aunque Meta la rechace, y quien
    // aprueba tiene que saberlo. Lo dice la TARJETA una vez al pie, no cada
    // renglon: el aviso repetido tres veces se lee como decoracion. Acá se
    // afirman las dos mitades de esa division — el riesgo, que es lo que hace
    // que la tarjeta avise, y la linea, que solo tiene que decir cual es.
    const cap = capacidad('plantillas.crear')
    expect(cap.risk).toBe('irreversible')
    const texto = await cap.preview!(ctx(), { nombre: 'Bienvenida VIP', cuerpo: 'Hola' })
    expect(texto).toContain('bienvenida_vip')
    expect(texto).not.toMatch(/ría/)
  })

  it('crear no pisa una plantilla que ya fue a Meta', async () => {
    estado.plantillas.push({
      id: 'pl-1',
      workspace_id: WS,
      name: 'bienvenida_vip',
      language: 'es',
      status: 'Approved',
      body_text: 'vieja',
    })
    const cap = capacidad('plantillas.crear')
    await expect(
      cap.run(ctx(), { nombre: 'Bienvenida VIP', cuerpo: 'nueva' }),
    ).rejects.toThrow(/no se puede reusar/i)
  })

  it('enviar_a_meta avisa qué manda antes de mandarlo', async () => {
    estado.plantillas.push({
      id: 'pl-1',
      workspace_id: WS,
      user_id: USER,
      name: 'bienvenida_vip',
      language: 'es',
      category: 'Utility',
      status: 'Draft',
      body_text: 'Hola, gracias por tu compra.',
      buttons: null,
      variable_samples: null,
    })
    const cap = capacidad('plantillas.enviar_a_meta')
    const preview = await cap.preview!(ctx(), { nombre: 'bienvenida vip' })
    expect(preview).toContain('bienvenida_vip')
    expect(preview).toContain('Utility')
    expect(preview).toContain('gracias por tu compra')

    const r = (await cap.run(ctx(), { nombre: 'bienvenida vip' })) as Record<string, unknown>
    expect(r.estado).toBe('en_revision')
    expect(enviadasAMeta).toHaveLength(1)
    expect(estado.actualizadas[0].row.status).toBe('Pending')
  })

  it('enviar_a_meta no manda dos veces lo mismo', async () => {
    estado.plantillas.push({
      id: 'pl-1',
      workspace_id: WS,
      name: 'bienvenida_vip',
      language: 'es',
      status: 'Pending',
      body_text: 'Hola',
    })
    const cap = capacidad('plantillas.enviar_a_meta')
    await expect(cap.run(ctx(), { nombre: 'bienvenida_vip' })).rejects.toThrow(/ya está en Meta/i)
    expect(enviadasAMeta).toHaveLength(0)
  })

  it('detalle devuelve el cuerpo, los botones y el motivo de rechazo', async () => {
    estado.plantillas.push({
      id: 'pl-1',
      workspace_id: WS,
      name: 'carrito_abandonado',
      language: 'es',
      category: 'Marketing',
      status: 'Rejected',
      body_text: 'Volvé por lo tuyo',
      rejected_reason: 'ABUSIVE_CONTENT',
      buttons: [{ type: 'URL', text: 'Comprar', url: 'https://x' }],
    })
    const cap = capacidad('plantillas.detalle')
    const r = (await cap.run(ctx(), { nombre: 'Carrito abandonado' })) as Record<string, unknown>
    expect(r.encontrada).toBe(true)
    expect(r.cuerpo).toBe('Volvé por lo tuyo')
    expect(r.motivo_rechazo).toBe('ABUSIVE_CONTENT')
    expect(r.botones).toEqual([{ texto: 'Comprar', tipo: 'enlace' }])
  })

  it('la cuenta nunca es un argumento, y lo irreversible siempre se avisa', () => {
    for (const cap of OUTBOUND_CAPABILITIES) {
      expect(Object.keys(cap.schema.properties), cap.key).not.toContain('workspace_id')
      if (cap.risk === 'irreversible') expect(cap.preview, cap.key).toBeTypeOf('function')
    }
  })
})
