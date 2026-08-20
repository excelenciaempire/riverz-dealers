import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AGENT_CAPABILITIES } from './agents'
import type { CapabilityContext } from './types'

/**
 * Lo que no se puede romper acá:
 *
 *  - la superficie de `agentes.editar`. Es lo único que separa "cambiale el
 *    tono" de "cambiale el modelo y el alcance": el PATCH de la pantalla acepta
 *    cuarenta columnas y el chat tiene que ver seis.
 *  - el horario, que falla callado. Una franja mal escrita o una zona horaria
 *    inventada no dan error en el runner: apagan o encienden al agente sin que
 *    nadie se entere. Se rechazan acá o no se rechazan nunca.
 *  - el recorte por cuenta. El cliente tiene llave de servicio, así que el
 *    único cerco es el filtro explícito por `workspace_id`.
 */

interface Consulta {
  tabla: string
  op?: 'update' | 'delete' | 'insert'
  patch?: Record<string, unknown>
}

/**
 * Cliente falso con filtros de verdad.
 *
 * Aplica `eq`/`neq`/`is` sobre las filas y, al actualizar, escribe sobre ellas:
 * sin eso la relectura posterior devolvería el agente viejo y un test podría
 * pasar con un UPDATE que nunca alcanzó ninguna fila.
 */
function fakeDb(
  tablas: Record<string, Record<string, unknown>[]>,
  registro: Consulta[] = [],
): SupabaseClient {
  return {
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])]
      const consulta: Consulta = { tabla }
      registro.push(consulta)
      const q: Record<string, unknown> = {}
      const aplicar = () => {
        if (consulta.op === 'update' && consulta.patch) {
          for (const f of filas) Object.assign(f, consulta.patch)
        }
      }
      Object.assign(q, {
        select: () => q,
        update: (patch: Record<string, unknown>) => {
          consulta.op = 'update'
          consulta.patch = patch
          return q
        },
        delete: () => {
          consulta.op = 'delete'
          return q
        },
        insert: () => {
          consulta.op = 'insert'
          return q
        },
        eq: (col: string, val: unknown) => {
          filas = filas.filter((f) => !(col in f) || f[col] === val)
          return q
        },
        neq: (col: string, val: unknown) => {
          filas = filas.filter((f) => f[col] !== val)
          return q
        },
        is: (col: string, val: unknown) => {
          filas = filas.filter((f) => (f[col] ?? null) === val)
          return q
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          aplicar()
          return { data: filas[0] ?? null, error: null }
        },
        single: async () => {
          aplicar()
          return { data: filas[0] ?? null, error: null }
        },
        then: (res: (v: unknown) => unknown) => {
          aplicar()
          return Promise.resolve({ data: filas, error: null }).then(res)
        },
      })
      return q
    },
  } as unknown as SupabaseClient
}

function ctxCon(db: SupabaseClient): CapabilityContext {
  return { db, workspaceId: 'ws-1', actor: { type: 'operator', id: 'u-1' } }
}

const cap = (key: string) => {
  const c = AGENT_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta ${key}`)
  return c
}

/** Un agente de ventas activo, con horario y permisos cargados. */
function agente(extra: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    workspace_id: 'ws-1',
    name: 'Vendedora',
    is_active: false,
    role: 'ventas',
    permissions: { crear_pedidos: false, crear_checkout: true },
    puede_crear_pedidos: false,
    persona: 'Habla corto y cierra la venta.',
    knowledge: null,
    knowledge_url: null,
    language: 'es',
    tone: 'friendly',
    scope: 'workspace',
    product_scope: 'all',
    priority: 0,
    requires_approval: false,
    reply_when_assigned: false,
    reply_outside_hours: false,
    business_hours: { timezone: 'America/Bogota', windows: { 1: ['09:00-18:00'] } },
    escalate_keywords: ['humano'],
    escalate_after_messages: null,
    followup_enabled: false,
    followup_delay_hours: 4,
    followup_max_count: 1,
    voice_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    ai_agent_channels: [],
    ...extra,
  }
}

// ---------------------------------------------------------------------------

describe('contrato', () => {
  it('ninguna pide workspace_id: la cuenta va en el contexto', () => {
    for (const c of AGENT_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
      expect(c.schema.required ?? [], c.key).not.toContain('workspace_id')
    }
  })

  it('editar expone seis cosas y nada más', () => {
    // El día que alguien sume `model`, `scope` o `inbound_debounce_seconds` a
    // este schema, el chat va a poder dejar mudo a un agente que está
    // atendiendo. Esa lista se amplía a mano y mirándola.
    expect(Object.keys(cap('agentes.editar').schema.properties).sort()).toEqual([
      'agent_id',
      'escalar_palabras',
      'horario',
      'nombre',
      'permisos',
      'persona',
      'tono',
    ])
  })
})

// ---------------------------------------------------------------------------

describe('agentes.detalle', () => {
  it('cuenta la configuración en palabras, no en columnas', async () => {
    const db = fakeDb({ ai_agents: [agente()] })
    const r = (await cap('agentes.detalle').run(ctxCon(db), {
      agent_id: 'a-1',
    })) as Record<string, unknown>

    expect(r.estado).toBe('pausado')
    expect(r.rol).toBe('ventas')
    expect(String(r.trabajo)).toContain('VENDER')
    expect(String(r.tono)).toContain('cercano')
    expect(r.horario).toMatchObject({
      atiende: 'lunes 09:00-18:00',
      zona_horaria: 'America/Bogota',
      fuera_de_horario: 'no contesta',
    })
    expect(r.canales).toBe('todos')
  })

  it('los permisos salen por agentCan, no por la columna cruda', async () => {
    // `permissions` manda sobre `puede_crear_pedidos`, y lo que no está
    // declarado queda permitido: es la conducta de los agentes viejos.
    const db = fakeDb({ ai_agents: [agente({ puede_crear_pedidos: true })] })
    const r = (await cap('agentes.detalle').run(ctxCon(db), {
      agent_id: 'a-1',
    })) as { puede: string[]; no_puede: string[] }

    expect(r.no_puede).toContain('crear pedidos')
    expect(r.puede).toContain('enviar link de pago')
    expect(r.puede).toContain('escribir primero')
  })

  it('avisa cuando el horario escrito no limita nada', async () => {
    // El caso que llegaba como "configuré 9 a 18 y contesta a las 3 AM":
    // `reply_outside_hours` en true anula la ventana entera.
    const db = fakeDb({ ai_agents: [agente({ reply_outside_hours: true })] })
    const r = (await cap('agentes.detalle').run(ctxCon(db), { agent_id: 'a-1' })) as {
      horario: { atiende: string; nota?: string }
    }
    expect(r.horario.atiende).toBe('a toda hora')
    expect(r.horario.nota).toContain('lunes 09:00-18:00')
  })

  it('no lee un agente de otra cuenta', async () => {
    const db = fakeDb({ ai_agents: [agente({ workspace_id: 'ws-2' })] })
    await expect(
      cap('agentes.detalle').run(ctxCon(db), { agent_id: 'a-1' }),
    ).rejects.toThrow(/no existe en esta cuenta/)
  })
})

// ---------------------------------------------------------------------------

describe('agentes.editar', () => {
  it('guarda nombre y tono, y deja el resto quieto', async () => {
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente()] }, registro)
    const r = (await cap('agentes.editar').run(ctxCon(db), {
      agent_id: 'a-1',
      nombre: 'Vendedora Pilar',
      tono: 'concise',
    })) as { nombre: string; cambios: string[] }

    const escrito = registro.find((c) => c.op === 'update')
    expect(escrito?.patch).toEqual({ name: 'Vendedora Pilar', tone: 'concise' })
    expect(r.nombre).toBe('Vendedora Pilar')
    expect(r.cambios.join(' ')).toContain('breve')
  })

  it('el horario enciende la columna que lo hace valer', async () => {
    // Guardar `business_hours` y no tocar `reply_outside_hours` deja un horario
    // decorativo: el runner sólo calla al agente si esa columna está en false.
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente({ reply_outside_hours: true })] }, registro)
    await cap('agentes.editar').run(ctxCon(db), {
      agent_id: 'a-1',
      horario: {
        zona_horaria: 'America/Argentina/Buenos_Aires',
        dias: { lunes: ['09:00-18:00'], sábado: ['10:00-13:00'] },
      },
    })

    expect(registro.find((c) => c.op === 'update')?.patch).toEqual({
      business_hours: {
        timezone: 'America/Argentina/Buenos_Aires',
        windows: { 1: ['09:00-18:00'], 6: ['10:00-13:00'] },
      },
      reply_outside_hours: false,
    })
  })

  it('un horario sin días vuelve a 24/7', async () => {
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente()] }, registro)
    await cap('agentes.editar').run(ctxCon(db), { agent_id: 'a-1', horario: { dias: {} } })
    expect(registro.find((c) => c.op === 'update')?.patch).toEqual({
      business_hours: null,
      reply_outside_hours: true,
    })
  })

  it('rechaza una franja que el runner no sabe leer', async () => {
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente()] }, registro)
    await expect(
      cap('agentes.editar').run(ctxCon(db), {
        agent_id: 'a-1',
        horario: { dias: { lunes: ['9 a 18'] } },
      }),
    ).rejects.toThrow(/HH:mm-HH:mm/)
    expect(registro.some((c) => c.op === 'update')).toBe(false)
  })

  it('rechaza una zona horaria que no existe', async () => {
    // "Bogota" a secas y "GMT-5" son las dos formas en que se escribe una zona
    // cuando no se sabe cómo se escriben. Si pasan, `withinBusinessHours` se
    // come el error de Intl y el agente vuelve a atender 24/7 sin avisar.
    const db = fakeDb({ ai_agents: [agente()] })
    for (const zona of ['Bogota', 'GMT-5']) {
      await expect(
        cap('agentes.editar').run(ctxCon(db), {
          agent_id: 'a-1',
          horario: { zona_horaria: zona, dias: { lunes: ['09:00-18:00'] } },
        }),
      ).rejects.toThrow(/no existe/)
    }
  })

  it('los permisos se mezclan y espejan la columna vieja', async () => {
    // Mandar uno no puede apagar los otros cinco. Y `puede_crear_pedidos` se
    // escribe igual porque la voz y el super-agente la leen directo: si sólo se
    // guardara `permissions`, el mismo agente cerraría pedidos por teléfono y
    // no por chat.
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente()] }, registro)
    await cap('agentes.editar').run(ctxCon(db), {
      agent_id: 'a-1',
      permisos: { crear_pedidos: true },
    })

    expect(registro.find((c) => c.op === 'update')?.patch).toEqual({
      permissions: { crear_pedidos: true, crear_checkout: true },
      puede_crear_pedidos: true,
    })
  })

  it('rechaza un permiso inventado', async () => {
    const db = fakeDb({ ai_agents: [agente()] })
    await expect(
      cap('agentes.editar').run(ctxCon(db), {
        agent_id: 'a-1',
        permisos: { borrar_todo: true },
      }),
    ).rejects.toThrow(/No existe el permiso/)
  })

  it('reemplaza la lista de palabras que escalan', async () => {
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente()] }, registro)
    await cap('agentes.editar').run(ctxCon(db), {
      agent_id: 'a-1',
      escalar_palabras: ['reclamo', '  ', 'reembolso'],
    })
    expect(registro.find((c) => c.op === 'update')?.patch).toEqual({
      escalate_keywords: ['reclamo', 'reembolso'],
    })
  })

  it('no vacía la persona', async () => {
    const db = fakeDb({ ai_agents: [agente()] })
    await expect(
      cap('agentes.editar').run(ctxCon(db), { agent_id: 'a-1', persona: '   ' }),
    ).rejects.toThrow(/no puede quedar vacía/)
  })

  it('una llamada sin cambios no escribe nada', async () => {
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente()] }, registro)
    await expect(
      cap('agentes.editar').run(ctxCon(db), { agent_id: 'a-1' }),
    ).rejects.toThrow(/nada que cambiar/)
    expect(registro.some((c) => c.op === 'update')).toBe(false)
  })

  it('no edita un agente de otra cuenta', async () => {
    const registro: Consulta[] = []
    const db = fakeDb({ ai_agents: [agente({ workspace_id: 'ws-2' })] }, registro)
    await expect(
      cap('agentes.editar').run(ctxCon(db), { agent_id: 'a-1', nombre: 'Mío' }),
    ).rejects.toThrow(/no existe en esta cuenta/)
    expect(registro.some((c) => c.op === 'update')).toBe(false)
  })

  it('frena si el cambio deja dos agentes del mismo rol en el mismo canal', async () => {
    // Un agente ACTIVO al que se le edita cualquier cosa vuelve a pasar por la
    // misma validación que la pantalla: si otro del mismo rol ya ocupa el
    // canal, no se guarda.
    const db = fakeDb({
      ai_agents: [
        agente({ is_active: true }),
        agente({ id: 'a-2', name: 'Otra vendedora', is_active: true }),
      ],
    })
    await expect(
      cap('agentes.editar').run(ctxCon(db), { agent_id: 'a-1', nombre: 'Nueva' }),
    ).rejects.toThrow(/Otra vendedora/)
  })

  it('el preview dice qué se mueve, con el nombre del agente', async () => {
    const db = fakeDb({ ai_agents: [agente()] })
    const texto = await cap('agentes.editar').preview?.(ctxCon(db), {
      agent_id: 'a-1',
      permisos: { crear_pedidos: true },
    })
    expect(texto).toContain('Vendedora')
    expect(texto).toContain('puede crear pedidos')
  })
})
