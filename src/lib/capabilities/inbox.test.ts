import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { INBOX_CAPABILITIES } from './inbox'
import type { CapabilityContext } from './types'

/**
 * Lo que estas pruebas cuidan.
 *
 * 1. Que la bandeja NO le escriba a nadie. La regla del dominio es que mandar
 *    un mensaje lo abre una persona; si mañana alguien agrega un envío acá, el
 *    registro de tablas tocadas lo delata.
 * 2. Que las columnas laterales se muevan con el estado. `closed_at` y
 *    `needs_human_*` son las que hacen que el panel cuente bien, y son
 *    exactamente las que un caller nuevo se olvida.
 * 3. Que asignar exija ser del equipo. Sin eso alcanzaba con inventar un uuid
 *    para dejar un hilo a nombre de alguien de otra cuenta.
 */

const WS = '11111111-1111-1111-1111-111111111111'
const CONV = '22222222-2222-2222-2222-222222222222'
const ANA = '33333333-3333-3333-3333-333333333333'
const LUIS = '44444444-4444-4444-4444-444444444444'

interface Llamada {
  tabla: string
  op: 'select' | 'update'
  filtros: Record<string, unknown>
  patch?: Record<string, unknown>
}

let llamadas: Llamada[] = []

/** Datos por tabla; `maybeSingle()` devuelve la primera fila. */
function fakeDb(datos: Record<string, unknown[]>): SupabaseClient {
  const api = {
    from(tabla: string) {
      const registro: Llamada = { tabla, op: 'select', filtros: {} }
      llamadas.push(registro)
      const chain: Record<string, unknown> = {}
      const self = () => chain
      const resultado = () => ({ data: datos[tabla] ?? [], error: null })
      Object.assign(chain, {
        select: self,
        order: self,
        limit: self,
        is: self,
        or(filtro: string) {
          registro.filtros.or = filtro
          return chain
        },
        in(columna: string, valores: unknown[]) {
          registro.filtros[columna] = valores
          return chain
        },
        eq(columna: string, valor: unknown) {
          registro.filtros[columna] = valor
          return chain
        },
        update(patch: Record<string, unknown>) {
          registro.op = 'update'
          registro.patch = patch
          return chain
        },
        maybeSingle: async () => ({ data: (datos[tabla] ?? [])[0] ?? null, error: null }),
        then: (resolver: (v: unknown) => unknown) => Promise.resolve(resolver(resultado())),
      })
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

const CONVERSACION = {
  id: CONV,
  workspace_id: WS,
  channel: 'whatsapp',
  status: 'open',
  ai_enabled: true,
  assigned_agent_id: null,
  contact_id: 'c-1',
  contacts: { name: 'Marta', phone: '5491100000000' },
}

const EQUIPO = {
  workspace_members: [
    { user_id: ANA, role: 'admin' },
    { user_id: LUIS, role: 'agent' },
  ],
  profiles: [
    { user_id: ANA, full_name: 'Ana Pérez', email: 'ana@tienda.com' },
    { user_id: LUIS, full_name: 'Luis Gómez', email: 'luis@tienda.com' },
  ],
}

function ctx(datos: Record<string, unknown[]>): CapabilityContext {
  return {
    db: fakeDb(datos),
    workspaceId: WS,
    actor: { type: 'operator', id: 'u-1' },
    locale: 'es',
  }
}

function cap(key: string) {
  const c = INBOX_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta ${key}`)
  return c
}

/** El UPDATE que se mandó a `conversations`, que es lo que se quiere verificar. */
function updateDeConversacion(): Llamada {
  const u = llamadas.find((l) => l.tabla === 'conversations' && l.op === 'update')
  if (!u) throw new Error('no se escribió ninguna conversación')
  return u
}

beforeEach(() => {
  llamadas = []
})

describe('la bandeja no le escribe a nadie', () => {
  it('ninguna capacidad es irreversible', () => {
    // Irreversible en esta capa significa "le llega a una persona". Gestionar la
    // bandeja nunca debería llegar a eso: si aparece una, alguien metió un envío.
    for (const c of INBOX_CAPABILITIES) {
      expect(c.risk, c.key).not.toBe('irreversible')
    }
  })

  it('gestionar la bandeja no toca la tabla de mensajes', async () => {
    const datos = { conversations: [CONVERSACION], ...EQUIPO }
    await cap('conversaciones.cerrar').run(ctx(datos), { conversacion_id: CONV })
    await cap('conversaciones.ia').run(ctx(datos), { conversacion_id: CONV, activa: false })
    await cap('conversaciones.asignar').run(ctx(datos), {
      conversacion_id: CONV,
      miembro: 'Ana',
    })
    const tablas = new Set(llamadas.map((l) => l.tabla))
    expect([...tablas]).not.toContain('messages')
    expect([...tablas].sort()).toEqual(['conversations', 'profiles', 'workspace_members'])
  })

  it('ninguna pide workspace_id: la cuenta va en el contexto', () => {
    for (const c of INBOX_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
    }
  })
})

describe('conversaciones.buscar', () => {
  it('recorta por cuenta, estado y canal', async () => {
    await cap('conversaciones.buscar').run(ctx({ conversations: [CONVERSACION] }), {
      estado: 'pending',
      canal: 'instagram',
    })
    const q = llamadas.find((l) => l.tabla === 'conversations')!
    expect(q.filtros).toMatchObject({
      workspace_id: WS,
      status: 'pending',
      channel: 'instagram',
    })
  })

  it('con texto filtra por los contactos que matchean', async () => {
    await cap('conversaciones.buscar').run(
      ctx({ contacts: [{ id: 'c-1' }, { id: 'c-2' }], conversations: [CONVERSACION] }),
      { texto: 'marta' },
    )
    const q = llamadas.find((l) => l.tabla === 'conversations')!
    expect(q.filtros.contact_id).toEqual(['c-1', 'c-2'])
  })

  it('si ningún contacto matchea devuelve vacío sin barrer la bandeja', async () => {
    // El riesgo real de la búsqueda por texto es devolver TODO cuando el filtro
    // no se aplicó. Cero contactos tiene que dar cero conversaciones, no todas.
    const r = (await cap('conversaciones.buscar').run(
      ctx({ contacts: [], conversations: [CONVERSACION] }),
      { texto: 'nadie' },
    )) as { conversaciones: unknown[] }
    expect(r.conversaciones).toEqual([])
    expect(llamadas.some((l) => l.tabla === 'conversations')).toBe(false)
  })

  it('muestra el nombre de quien la tiene, no su uuid', async () => {
    const r = (await cap('conversaciones.buscar').run(
      ctx({ conversations: [{ ...CONVERSACION, assigned_agent_id: LUIS }], ...EQUIPO }),
      {},
    )) as { conversaciones: { asignada_a: string | null }[] }
    expect(r.conversaciones[0].asignada_a).toBe('Luis Gómez')
  })
})

describe('conversaciones.cerrar', () => {
  it('sella closed_at y cierra el escalamiento', async () => {
    await cap('conversaciones.cerrar').run(ctx({ conversations: [CONVERSACION] }), {
      conversacion_id: CONV,
    })
    const u = updateDeConversacion()
    expect(u.patch).toMatchObject({ status: 'closed', needs_human_reason: null, needs_human_at: null })
    expect(u.patch?.closed_at).toBeTypeOf('string')
    // El recorte por cuenta va en el UPDATE y no sólo en la lectura previa.
    expect(u.filtros).toMatchObject({ id: CONV, workspace_id: WS })
  })

  it('reabrir borra closed_at para no contar dos veces en "Resueltas hoy"', async () => {
    await cap('conversaciones.cerrar').run(ctx({ conversations: [CONVERSACION] }), {
      conversacion_id: CONV,
      reabrir: true,
    })
    expect(updateDeConversacion().patch).toMatchObject({ status: 'open', closed_at: null })
  })

  it('una conversación de otra cuenta no existe', async () => {
    await expect(
      cap('conversaciones.cerrar').run(ctx({ conversations: [] }), { conversacion_id: CONV }),
    ).rejects.toThrow(/no existe en esta cuenta/)
  })
})

describe('conversaciones.ia', () => {
  it('prenderla cierra el pedido de intervención humana', async () => {
    await cap('conversaciones.ia').run(ctx({ conversations: [CONVERSACION] }), {
      conversacion_id: CONV,
      activa: true,
    })
    expect(updateDeConversacion().patch).toMatchObject({
      ai_enabled: true,
      needs_human_reason: null,
      needs_human_at: null,
    })
  })

  it('apagarla no borra la marca: describe la verdad de ese hilo', async () => {
    await cap('conversaciones.ia').run(ctx({ conversations: [CONVERSACION] }), {
      conversacion_id: CONV,
      activa: false,
    })
    const patch = updateDeConversacion().patch!
    expect(patch.ai_enabled).toBe(false)
    expect(patch).not.toHaveProperty('needs_human_reason')
  })
})

describe('conversaciones.asignar', () => {
  it('resuelve al compañero por nombre', async () => {
    const r = (await cap('conversaciones.asignar').run(
      ctx({ conversations: [CONVERSACION], ...EQUIPO }),
      { conversacion_id: CONV, miembro: 'ana' },
    )) as { asignada_a: string | null }
    expect(r.asignada_a).toBe('Ana Pérez')
    expect(updateDeConversacion().patch).toMatchObject({ assigned_agent_id: ANA })
  })

  it('también por correo y por id', async () => {
    for (const quien of ['luis@tienda.com', LUIS]) {
      llamadas = []
      await cap('conversaciones.asignar').run(ctx({ conversations: [CONVERSACION], ...EQUIPO }), {
        conversacion_id: CONV,
        miembro: quien,
      })
      expect(updateDeConversacion().patch).toMatchObject({ assigned_agent_id: LUIS })
    }
  })

  it('sin miembro la desasigna', async () => {
    await cap('conversaciones.asignar').run(ctx({ conversations: [CONVERSACION], ...EQUIPO }), {
      conversacion_id: CONV,
    })
    expect(updateDeConversacion().patch).toMatchObject({ assigned_agent_id: null })
  })

  it('un uuid que no es del equipo no se asigna', async () => {
    await expect(
      cap('conversaciones.asignar').run(ctx({ conversations: [CONVERSACION], ...EQUIPO }), {
        conversacion_id: CONV,
        miembro: '99999999-9999-9999-9999-999999999999',
      }),
    ).rejects.toThrow(/no es del equipo/)
  })

  it('un nombre ambiguo corta en vez de elegir', async () => {
    // Asignarle el hilo a quien no era se descubre tarde: el compañero que sí
    // debía atenderlo nunca lo ve.
    const equipoAmbiguo = {
      workspace_members: EQUIPO.workspace_members,
      profiles: [
        { user_id: ANA, full_name: 'Ana Pérez', email: 'ana@tienda.com' },
        { user_id: LUIS, full_name: 'Ana Gómez', email: 'anag@tienda.com' },
      ],
    }
    await expect(
      cap('conversaciones.asignar').run(ctx({ conversations: [CONVERSACION], ...equipoAmbiguo }), {
        conversacion_id: CONV,
        miembro: 'Ana',
      }),
    ).rejects.toThrow(/alcanza a varias personas/)
  })
})

describe('lo que lee quien aprueba', () => {
  it('cada escritura dice en castellano qué le pasa a qué conversación', async () => {
    const datos = { conversations: [CONVERSACION], ...EQUIPO }
    const textos = await Promise.all([
      cap('conversaciones.cerrar').preview!(ctx(datos), { conversacion_id: CONV }),
      cap('conversaciones.ia').preview!(ctx(datos), { conversacion_id: CONV, activa: false }),
      cap('conversaciones.asignar').preview!(ctx(datos), {
        conversacion_id: CONV,
        miembro: 'Ana',
      }),
    ])
    for (const texto of textos) {
      expect(texto).toContain('Marta')
      expect(texto.length).toBeGreaterThan(30)
    }
  })

  it('prender y apagar la IA no dicen lo mismo', async () => {
    const datos = { conversations: [CONVERSACION], ...EQUIPO }
    const prender = await cap('conversaciones.ia').preview!(ctx(datos), {
      conversacion_id: CONV,
      activa: true,
    })
    const apagar = await cap('conversaciones.ia').preview!(ctx(datos), {
      conversacion_id: CONV,
      activa: false,
    })
    expect(prender).not.toBe(apagar)
  })
})
