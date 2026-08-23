import { describe, it, expect } from 'vitest'

import { COMMENT_CAPABILITIES } from './comments'
import type { AnyCapability, CapabilityContext } from './types'

/**
 * Lo que se prueba acá es lo que no se puede probar mirando: que el recorte por
 * cuenta esté en TODAS las consultas, que una regla nueva nazca apagada aunque
 * se pida lo contrario, y que el `preview` de prenderla diga la palabra clave y
 * el texto exacto que va a recibir una persona. Un preview vago es una
 * confirmación a ciegas.
 */

/**
 * Doble de Supabase: cada `from(tabla)` devuelve una cadena encadenable que
 * ignora los filtros y responde lo que se le configuró. Si a una tabla se le
 * pasa una lista, cada `from` consume la siguiente respuesta (la misma tabla se
 * consulta varias veces en una llamada); la última queda fija.
 */
function fakeDb(responses: Record<string, unknown>) {
  const calls: Array<{ table: string; m: string; args: unknown[] }> = []
  const queues: Record<string, unknown[]> = {}
  for (const [t, v] of Object.entries(responses)) {
    queues[t] = Array.isArray(v) ? [...v] : [v]
  }
  const make = (table: string) => {
    const cola = queues[table] ?? [{ data: [] }]
    const res = cola.length > 1 ? cola.shift() : cola[0]
    const chain: Record<string, unknown> = {}
    for (const m of [
      'select',
      'eq',
      'neq',
      'in',
      'is',
      'not',
      'gte',
      'order',
      'limit',
      'insert',
      'update',
      'delete',
    ]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, m, args })
        return chain
      }
    }
    for (const m of ['single', 'maybeSingle']) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, m, args })
        return Promise.resolve(res)
      }
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(res)
    return chain
  }
  return { db: { from: (t: string) => make(t) }, calls }
}

function ctxCon(db: unknown): CapabilityContext {
  return {
    db: db as CapabilityContext['db'],
    workspaceId: 'ws-1',
    actor: { type: 'operator', id: 'u-1' },
  }
}

function cap(key: string): AnyCapability {
  const found = COMMENT_CAPABILITIES.find((c) => c.key === key)
  if (!found) throw new Error(`falta ${key}`)
  return found as AnyCapability
}

const AJUSTES_IA = {
  data: {
    auto_reply_comments: false,
    comment_audience: 'all',
    comment_max_thread_replies: 3,
    comment_public_reply: true,
    comment_facebook: false,
  },
}

const REGLA = {
  id: 'r1',
  name: 'Sorteo',
  channel: 'ig_comment',
  post_id: null,
  keywords: ['envío', 'precio'],
  match_type: 'contains',
  case_sensitive: false,
  public_reply_enabled: true,
  public_reply_templates: ['¡Te escribimos por privado!'],
  dm_message: 'Hola, te paso el link',
  dm_button_label: 'Ver',
  dm_button_url: 'https://tienda.com/p',
  is_active: false,
  priority: 100,
  created_at: '2026-08-01T00:00:00Z',
}

describe('comentarios.pendientes', () => {
  const { db, calls } = fakeDb({
    conversations: [
      {
        data: [
          {
            id: 'c1',
            channel: 'ig_comment',
            last_message_at: '2026-08-19T10:00:00Z',
            last_message_text: '¿precio?',
            unread_count: 2,
            is_ad: true,
            contacts: { name: 'Ana' },
          },
        ],
      },
      { count: 4 },
      { count: 1 },
    ],
    messages: {
      data: [
        {
          conversation_id: 'c1',
          message_id: 'ig_1',
          content_text: '¿precio?',
          is_hidden: false,
          comments_meta: { permalink: 'https://instagram.com/p/1', post_id: 'post_1' },
        },
      ],
    },
    comment_to_dm_log: { data: [{ comment_external_id: 'ig_1', dm_status: 'sent' }] },
    ig_proactive_settings: AJUSTES_IA,
  })

  it('devuelve el comentario con su enlace, la espera y si ya salió el privado', async () => {
    const r = (await cap('comentarios.pendientes').run(ctxCon(db), {})) as {
      por_canal: Record<string, number>
      ia: { contesta: boolean; a_quien: string }
      comentarios: Array<Record<string, unknown>>
    }
    // El total por red NO es el largo de la lista: se cuenta aparte.
    expect(r.por_canal).toEqual({ Instagram: 4, Facebook: 1 })
    expect(r.comentarios).toHaveLength(1)
    expect(r.comentarios[0]).toMatchObject({
      conversation_id: 'c1',
      canal: 'Instagram',
      persona: 'Ana',
      comentario: '¿precio?',
      es_anuncio: true,
      publicacion: 'post_1',
      enlace: 'https://instagram.com/p/1',
      dm_de_regla: true,
      sin_leer: 2,
    })
    // Por qué se acumulan: el piso autónomo está apagado.
    expect(r.ia.contesta).toBe(false)
    expect(r.ia.a_quien).toBe('a todo el que pregunte')
  })

  it('toda consulta se recorta a la cuenta del contexto', () => {
    const ajenas = calls.filter(
      (c) => c.m === 'eq' && c.args[0] === 'workspace_id' && c.args[1] !== 'ws-1',
    )
    expect(ajenas).toHaveLength(0)
    expect(
      calls.some((c) => c.m === 'eq' && c.args[0] === 'workspace_id' && c.args[1] === 'ws-1'),
    ).toBe(true)
  })

  it('con canal mira una sola red', async () => {
    const { db: db2, calls: calls2 } = fakeDb({
      conversations: [{ data: [] }, { count: 0 }],
      ig_proactive_settings: AJUSTES_IA,
    })
    const r = (await cap('comentarios.pendientes').run(ctxCon(db2), {
      canal: 'facebook',
    })) as { por_canal: Record<string, number>; comentarios: unknown[] }
    expect(r.por_canal).toEqual({ Facebook: 0 })
    expect(r.comentarios).toEqual([])
    expect(
      calls2.some(
        (c) => c.m === 'in' && c.args[0] === 'channel' && JSON.stringify(c.args[1]) === '["fb_comment"]',
      ),
    ).toBe(true)
    // Sin hilos pendientes no se sale a buscar comentarios ni envíos.
    expect(calls2.some((c) => c.table === 'messages')).toBe(false)
  })
})

describe('comentarios.reglas', () => {
  it('dice la palabra clave, la prioridad y el privado ya armado', async () => {
    const { db } = fakeDb({
      comment_to_dm_rules: { data: [REGLA] },
      comment_to_dm_log: {
        data: [
          { rule_id: 'r1', dm_status: 'sent' },
          { rule_id: 'r1', dm_status: 'sent' },
        ],
      },
    })
    const r = (await cap('comentarios.reglas').run(ctxCon(db), {})) as {
      reglas: Array<Record<string, unknown>>
    }
    expect(r.reglas[0]).toMatchObject({
      nombre: 'Sorteo',
      canal: 'Instagram',
      activa: false,
      palabras_clave: ['envío', 'precio'],
      atiende: 'las palabras clave',
      prioridad: 100,
      dm_enviados: 2,
    })
    // El botón viaja pegado al texto, como lo manda el motor.
    expect(r.reglas[0].dm).toBe('Hola, te paso el link\n\n👉 Ver: https://tienda.com/p')
    expect(r.reglas[0].respuesta_publica).toEqual(['¡Te escribimos por privado!'])
  })

  it('sin palabras clave avisa que atiende cualquier comentario', async () => {
    const { db } = fakeDb({
      comment_to_dm_rules: { data: [{ ...REGLA, keywords: [] }] },
      comment_to_dm_log: { data: [] },
    })
    const r = (await cap('comentarios.reglas').run(ctxCon(db), {})) as {
      reglas: Array<{ atiende: string }>
    }
    expect(r.reglas[0].atiende).toBe('cualquier comentario')
  })
})

describe('comentarios.crear_regla', () => {
  it('nace apagada y en la cuenta del contexto', async () => {
    const { db, calls } = fakeDb({ comment_to_dm_rules: { data: { id: 'r9' } } })
    const r = (await cap('comentarios.crear_regla').run(ctxCon(db), {
      nombre: 'Lanzamiento',
      canal: 'instagram',
      dm: 'Te paso el link',
      palabras_clave: ['quiero', '  '],
      respuesta_publica: ['¡Ya te escribimos!'],
    })) as { id: string; activa: boolean }
    expect(r).toMatchObject({ id: 'r9', activa: false })

    const insert = calls.find((c) => c.m === 'insert')?.args[0] as Record<string, unknown>
    expect(insert.is_active).toBe(false)
    expect(insert.workspace_id).toBe('ws-1')
    expect(insert.channel).toBe('ig_comment')
    // Las palabras en blanco se caen: una cadena vacía haría match con todo.
    expect(insert.keywords).toEqual(['quiero'])
    expect(insert.public_reply_enabled).toBe(true)
  })

  it('sin respuesta pública no publica nada bajo el comentario', async () => {
    const { db, calls } = fakeDb({ comment_to_dm_rules: { data: { id: 'r9' } } })
    await cap('comentarios.crear_regla').run(ctxCon(db), {
      nombre: 'Solo privado',
      canal: 'facebook',
      dm: 'Hola',
    })
    const insert = calls.find((c) => c.m === 'insert')?.args[0] as Record<string, unknown>
    expect(insert.public_reply_enabled).toBe(false)
    expect(insert.public_reply_templates).toEqual([])
  })

  it('rechaza un canal que no existe', async () => {
    const { db } = fakeDb({})
    await expect(
      cap('comentarios.crear_regla').run(ctxCon(db), {
        nombre: 'x',
        canal: 'tiktok',
        dm: 'hola',
      }),
    ).rejects.toThrow(/instagram o facebook/)
  })
})

describe('comentarios.activar_regla', () => {
  it('el preview dice la palabra clave y el texto que va a recibir la persona', async () => {
    const { db } = fakeDb({
      comment_to_dm_rules: { data: REGLA },
      channel_connections: { count: 1 },
    })
    const texto = await cap('comentarios.activar_regla').preview!(ctxCon(db), {
      regla_id: 'r1',
      activa: true,
    })
    expect(texto).toContain('«envío»')
    expect(texto).toContain('Hola, te paso el link')
    expect(texto).toContain('https://tienda.com/p')
    // La respuesta pública se anuncia como pública, que es lo que la distingue.
    expect(texto).toContain('A LA VISTA DE TODOS')
    expect(texto).toContain('¡Te escribimos por privado!')
  })

  it('avisa cuando la regla atiende cualquier comentario', async () => {
    const { db } = fakeDb({
      comment_to_dm_rules: { data: { ...REGLA, keywords: [] } },
      channel_connections: { count: 1 },
    })
    const texto = await cap('comentarios.activar_regla').preview!(ctxCon(db), {
      regla_id: 'r1',
      activa: true,
    })
    expect(texto).toContain('CUALQUIER comentario')
  })

  it('avisa cuando esa red no está conectada', async () => {
    const { db } = fakeDb({
      comment_to_dm_rules: { data: REGLA },
      channel_connections: { count: 0 },
    })
    const texto = await cap('comentarios.activar_regla').preview!(ctxCon(db), {
      regla_id: 'r1',
      activa: true,
    })
    expect(texto).toContain('no hay ninguna cuenta de Instagram conectada')
  })

  it('apagar no promete nada sobre lo ya enviado', async () => {
    const { db, calls } = fakeDb({ comment_to_dm_rules: { data: REGLA } })
    const texto = await cap('comentarios.activar_regla').preview!(ctxCon(db), {
      regla_id: 'r1',
      activa: false,
    })
    expect(texto).toMatch(/^Apagaría/)
    expect(calls.some((c) => c.table === 'channel_connections')).toBe(false)
  })

  it('una regla de otra cuenta no existe', async () => {
    const { db } = fakeDb({ comment_to_dm_rules: { data: null } })
    await expect(
      cap('comentarios.activar_regla').preview!(ctxCon(db), {
        regla_id: 'ajena',
        activa: true,
      }),
    ).rejects.toThrow('Esa regla no existe en esta cuenta.')
    await expect(
      cap('comentarios.activar_regla').run(ctxCon(db), { regla_id: 'ajena', activa: true }),
    ).rejects.toThrow(/no existe en esta cuenta/)
  })

  it('el update se recorta por cuenta', async () => {
    const { db, calls } = fakeDb({
      comment_to_dm_rules: { data: { ...REGLA, is_active: true } },
    })
    const r = (await cap('comentarios.activar_regla').run(ctxCon(db), {
      regla_id: 'r1',
      activa: true,
    })) as { is_active: boolean }
    expect(r.is_active).toBe(true)
    expect(
      calls.some((c) => c.m === 'eq' && c.args[0] === 'workspace_id' && c.args[1] === 'ws-1'),
    ).toBe(true)
  })
})

describe('contrato del dominio', () => {
  it('ninguna pide workspace_id: la cuenta va en el contexto', () => {
    for (const c of COMMENT_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
      expect(c.schema.required ?? [], c.key).not.toContain('workspace_id')
    }
  })

  it('lo irreversible trae preview', () => {
    for (const c of COMMENT_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })

  it('prender una regla pide permiso; crearla apagada no', () => {
    // Prender es lo que hace que a alguien le empiece a llegar un mensaje.
    // Crearla nace apagada y no dispara nada mientras lo esté.
    const activar = cap('comentarios.activar_regla')
    expect(activar.risk).toBe('irreversible')
    expect(activar.inerte).toBeUndefined()
    expect(cap('comentarios.crear_regla').inerte).toBe(true)
  })
})
