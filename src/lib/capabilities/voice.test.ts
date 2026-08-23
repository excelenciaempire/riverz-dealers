import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { EnqueueInput, EnqueueResult } from '@/lib/voice/queue'
import type { VoiceCallingHours } from '@/types'
import { VOICE_CAPABILITIES } from './voice'
import type { AnyCapability, CapabilityContext } from './types'

/**
 * Lo que tiene que seguir siendo cierto de las llamadas.
 *
 * Es el único dominio que le hace sonar el teléfono a una persona, así que las
 * pruebas miran dos cosas: que no exista un camino que se saltee las barreras
 * de `enqueueCall`, y que la franja horaria del comercio se respete aunque la
 * llamada la pida el chat a las tres de la mañana.
 */

const pedidos: EnqueueInput[] = []
let respuesta: EnqueueResult = {
  enqueued: true,
  callId: 'call-1',
  scheduledAt: '2026-08-20T14:00:00.000Z',
}

vi.mock('@/lib/voice/queue', async (importOriginal) => {
  // `nextAllowedTime` se usa de verdad: es la que decide qué dice el preview
  // sobre cuándo suena el teléfono.
  const real = await importOriginal<typeof import('@/lib/voice/queue')>()
  return {
    ...real,
    enqueueCall: vi.fn(async (input: EnqueueInput) => {
      pedidos.push(input)
      return respuesta
    }),
  }
})

const WS = '11111111-1111-1111-1111-111111111111'
const OTRO_WS = '22222222-2222-2222-2222-222222222222'

/** Franja de 24 horas: el fin <= inicio marca la vuelta completa del día. */
const SIEMPRE: VoiceCallingHours = { start: '00:00', end: '00:00', days: [1, 2, 3, 4, 5, 6, 7] }

/** Una franja que empieza dentro de dos horas: nunca incluye el ahora. */
function franjaMasTarde(tz = 'America/Bogota'): VoiceCallingHours {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(
      new Date(),
    ),
  )
  const inicio = String((h + 2) % 24).padStart(2, '0')
  const fin = String((h + 3) % 24).padStart(2, '0')
  return { start: `${inicio}:00`, end: `${fin}:00`, days: [1, 2, 3, 4, 5, 6, 7] }
}

/** Con qué columna y valor se filtró cada tabla: así se verifica el recorte por cuenta. */
let filtros: { tabla: string; columna: string; valor: unknown }[] = []

function fakeDb(tablas: Record<string, unknown[]>): SupabaseClient {
  const from = (tabla: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self,
      gte: self,
      in: self,
      is: self,
      order: self,
      limit: self,
      eq(columna: string, valor: unknown) {
        filtros.push({ tabla, columna, valor })
        return chain
      },
      maybeSingle: async () => ({ data: (tablas[tabla] ?? [])[0] ?? null, error: null }),
      // Las consultas de listado se resuelven con await sobre la cadena.
      then: (resolve: (v: unknown) => void) => resolve({ data: tablas[tabla] ?? [], error: null }),
    })
    return chain
  }
  return { from } as unknown as SupabaseClient
}

function ctx(tablas: Record<string, unknown[]>): CapabilityContext {
  return {
    db: fakeDb(tablas),
    workspaceId: WS,
    actor: { type: 'operator', id: 'u-1' },
  }
}

function cap(key: string): AnyCapability {
  const c = VOICE_CAPABILITIES.find((x) => x.key === key)
  if (!c) throw new Error(`falta ${key}`)
  return c as AnyCapability
}

const AGENTE = {
  id: 'ag-1',
  name: 'Sofía',
  voice_enabled: true,
  is_active: true,
  scope: 'workspace',
  priority: 10,
  voice_calling_hours: SIEMPRE,
}

const CONTACTO = { name: 'Juan Pérez', phone: '+5491122334455', voice_opt_out: false }

beforeEach(() => {
  pedidos.length = 0
  filtros = []
  respuesta = { enqueued: true, callId: 'call-1', scheduledAt: '2026-08-20T14:00:00.000Z' }
})

describe('contrato del dominio', () => {
  it('llamar es irreversible y trae preview', () => {
    const c = cap('voz.llamar')
    expect(c.risk).toBe('irreversible')
    expect(typeof c.preview).toBe('function')
  })

  it('ninguna pide la cuenta como argumento', () => {
    // La cuenta viaja en el contexto: como argumento, bastaría con escribir
    // otro uuid para llamarle a un contacto ajeno.
    for (const c of VOICE_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
    }
  })

  it('ninguna se declara inerte: llamar alcanza a una persona', () => {
    for (const c of VOICE_CAPABILITIES) {
      expect(c.inerte, c.key).toBeUndefined()
    }
  })
})

describe('voz.llamar', () => {
  it('encola por la puerta única, con el agente y el objetivo pedidos', async () => {
    const res = (await cap('voz.llamar').run(ctx({ ai_agents: [AGENTE] }), {
      contacto_id: 'ct-1',
      objetivo: 'confirmar el pedido 1023',
    })) as { llamada_id: string; agente: string }

    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].workspaceId).toBe(WS)
    expect(pedidos[0].contactId).toBe('ct-1')
    expect(pedidos[0].agentId).toBe('ag-1')
    expect(pedidos[0].callType).toBe('manual')
    expect(pedidos[0].context).toEqual({ objective_override: 'confirmar el pedido 1023' })
    expect(res.llamada_id).toBe('call-1')
    expect(res.agente).toBe('Sofía')
  })

  it('nunca pide llamar YA: la franja del comercio manda', async () => {
    // El botón del panel usa `immediate` porque hay alguien mirando la pantalla
    // en horario de trabajo. Una aprobación del chat puede llegar de madrugada.
    await cap('voz.llamar').run(ctx({ ai_agents: [AGENTE] }), { contacto_id: 'ct-1' })
    expect(pedidos[0].immediate).toBeFalsy()
  })

  it('el agente pedido tiene que ser de esta cuenta', async () => {
    await cap('voz.llamar')
      .run(ctx({ ai_agents: [AGENTE] }), { contacto_id: 'ct-1', agente_id: 'ag-9' })
      .catch(() => null)
    const cuenta = filtros.filter((f) => f.tabla === 'ai_agents' && f.columna === 'workspace_id')
    expect(cuenta).toHaveLength(1)
    expect(cuenta[0].valor).toBe(WS)
    expect(cuenta[0].valor).not.toBe(OTRO_WS)
  })

  it('sin agente con voz no inventa uno', async () => {
    await expect(
      cap('voz.llamar').run(ctx({ ai_agents: [] }), { contacto_id: 'ct-1' }),
    ).rejects.toThrow(/agente con voz/i)
    expect(pedidos).toHaveLength(0)
  })

  it('una barrera de la cola se cuenta en castellano', async () => {
    // `opt_out` es un código de log; quien lee esto se lo explica al comercio.
    respuesta = { enqueued: false, reason: 'opt_out' }
    await expect(
      cap('voz.llamar').run(ctx({ ai_agents: [AGENTE] }), { contacto_id: 'ct-1' }),
    ).rejects.toThrow(/no recibir llamadas/i)
  })
})

describe('preview de voz.llamar', () => {
  const preview = (tablas: Record<string, unknown[]>, args: Record<string, unknown>) =>
    cap('voz.llamar').preview!(ctx(tablas), args)

  it('dice a quién, a qué número y con qué agente', async () => {
    const texto = await preview(
      { contacts: [CONTACTO], ai_agents: [AGENTE], workspaces: [{ timezone: 'America/Bogota' }] },
      { contacto_id: 'ct-1' },
    )
    expect(texto).toContain('Juan Pérez')
    expect(texto).toContain('+5491122334455')
    expect(texto).toContain('Sofía')
    expect(texto).toMatch(/no se puede deshacer/i)
  })

  it('fuera de la franja avisa que queda agendada', async () => {
    const texto = await preview(
      {
        contacts: [CONTACTO],
        ai_agents: [{ ...AGENTE, voice_calling_hours: franjaMasTarde() }],
        workspaces: [{ timezone: 'America/Bogota' }],
      },
      { contacto_id: 'ct-1' },
    )
    expect(texto).toMatch(/fuera de la franja/i)
    expect(texto).not.toMatch(/suena en cuanto/i)
  })

  it('con el contacto dado de baja dice que no se le va a llamar', async () => {
    await expect(
      preview(
        { contacts: [{ ...CONTACTO, voice_opt_out: true }], ai_agents: [AGENTE] },
        { contacto_id: 'ct-1' },
      ),
    ).rejects.toThrow(/no recibir llamadas/i)
  })

  it('sin teléfono lo dice antes de que alguien apruebe', async () => {
    await expect(
      preview(
        { contacts: [{ ...CONTACTO, phone: null }], ai_agents: [AGENTE] },
        { contacto_id: 'ct-1' },
      ),
    ).rejects.toThrow(/no tiene teléfono/i)
  })

  it('un contacto de otra cuenta no existe', async () => {
    await expect(
      preview({ contacts: [], ai_agents: [AGENTE] }, { contacto_id: 'ct-1' }),
    ).rejects.toThrow(/no existe en esta cuenta/i)
  })
})

describe('voz.listar', () => {
  const LLAMADAS = [
    {
      id: 'c1',
      direction: 'outbound',
      status: 'completed',
      outcome: 'confirmed',
      answered_at: '2026-08-19T15:00:00.000Z',
      duration_seconds: 120,
      created_at: '2026-08-19T15:00:00.000Z',
      contacto: { name: 'Juan' },
      agente: { name: 'Sofía' },
    },
    {
      id: 'c2',
      direction: 'outbound',
      status: 'completed',
      outcome: 'declined',
      answered_at: '2026-08-19T16:00:00.000Z',
      duration_seconds: 60,
      created_at: '2026-08-19T16:00:00.000Z',
    },
    {
      id: 'c3',
      direction: 'outbound',
      status: 'no_answer',
      outcome: null,
      answered_at: null,
      duration_seconds: null,
      created_at: '2026-08-19T17:00:00.000Z',
    },
    {
      id: 'c4',
      direction: 'inbound',
      status: 'completed',
      outcome: 'no_outcome',
      answered_at: '2026-08-19T18:00:00.000Z',
      duration_seconds: 300,
      created_at: '2026-08-19T18:00:00.000Z',
    },
  ]

  it('resume sólo las salientes pero lista todo', async () => {
    // A una entrante siempre le atendió alguien: contarla subiría la tasa de
    // contestadas y el panel mostraría otra.
    const res = (await cap('voz.listar').run(
      ctx({ voice_calls: LLAMADAS, workspaces: [{ timezone: 'America/Bogota' }] }),
      {},
    )) as {
      total: number
      salientes: { llamadas: number; contestadas: number; contestadas_pct: number; minutos: number }
      llamadas: { id: string; contacto: string | null }[]
    }

    expect(res.total).toBe(4)
    expect(res.salientes.llamadas).toBe(3)
    expect(res.salientes.contestadas).toBe(2)
    expect(res.salientes.contestadas_pct).toBe(67)
    expect(res.salientes.minutos).toBe(3)
    expect(res.llamadas).toHaveLength(4)
    expect(res.llamadas[0].contacto).toBe('Juan')
  })

  it('lee sólo las llamadas de esta cuenta', async () => {
    await cap('voz.listar').run(ctx({ voice_calls: LLAMADAS, workspaces: [] }), {})
    const cuenta = filtros.filter((f) => f.tabla === 'voice_calls')
    expect(cuenta).toHaveLength(1)
    expect(cuenta[0]).toEqual({ tabla: 'voice_calls', columna: 'workspace_id', valor: WS })
  })
})

describe('voz.campanas', () => {
  it('dice cuánta gente falta y con qué agente y segmento', async () => {
    const res = (await cap('voz.campanas').run(
      ctx({
        voice_campaigns: [
          {
            id: 'ca-1',
            name: 'Recuperar carritos',
            status: 'running',
            call_type: 'cart_recovery',
            objective: null,
            agent_id: 'ag-1',
            segment_id: 'sg-1',
            stats: { total: 10, enqueued: 4 },
            created_at: '2026-08-18T10:00:00.000Z',
            updated_at: '2026-08-19T10:00:00.000Z',
          },
        ],
        ai_agents: [{ id: 'ag-1', name: 'Sofía' }],
        contact_segments: [{ id: 'sg-1', name: 'Carritos de 7 días' }],
      }),
      {},
    )) as { campanas: { agente: string; segmento: string; faltan: number }[] }

    expect(res.campanas[0].agente).toBe('Sofía')
    expect(res.campanas[0].segmento).toBe('Carritos de 7 días')
    expect(res.campanas[0].faltan).toBe(6)
  })
})
