import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  cambiarZonaHoraria,
  crearInvitacion,
  ErrorDeInvitacion,
  esZonaHorariaValida,
  leerAjustes,
  renombrarCuenta,
} from '@/lib/workspaces/settings'
import { WORKSPACE_CAPABILITIES } from './workspace'
import { esInerte } from './registry'
import type { CapabilityContext } from './types'

/**
 * Lo que se prueba acá es lo que el panel no podía romper y una llamada por API sí.
 *
 * La pantalla ofrece un <select> cerrado de zonas y un formulario de correo: por
 * ahí no entra "Bogotá" ni "no-es-un-correo". Del lado del servidor no hay
 * <select>, y una zona que `Intl` no entiende deja a la aplicación sin poder
 * formatear una sola fecha — el panel entero deja de dibujarse.
 */

const WS = 'ws-1'
const DUENO = 'owner-1'
const OTRO = 'otro-2'

interface Op {
  tabla: string
  accion: 'select' | 'insert' | 'update'
  metodo: 'lista' | 'maybeSingle' | 'single'
  payload?: Record<string, unknown>
  filtros: Array<[string, unknown]>
}

let log: Op[] = []

function responder(op: Op): { data: unknown; error: unknown } {
  switch (op.tabla) {
    case 'workspaces': {
      if (op.accion === 'update') return { data: { id: WS }, error: null }
      // `isWorkspaceAdmin` pregunta por dueño: sólo matchea el dueño real.
      const porDueno = op.filtros.find(([c]) => c === 'owner_id')
      if (porDueno) return { data: porDueno[1] === DUENO ? { id: WS } : null, error: null }
      return {
        data: {
          id: WS,
          name: 'Pilar',
          owner_id: DUENO,
          timezone: 'America/Argentina/Buenos_Aires',
        },
        error: null,
      }
    }
    case 'workspace_members':
      // Con maybeSingle es la comprobación de rol; sin él, la lista del equipo.
      if (op.metodo === 'maybeSingle') return { data: null, error: null }
      return {
        data: [
          { user_id: DUENO, role: 'admin', joined_at: '2026-01-01', allowed_sections: null },
          {
            user_id: OTRO,
            role: 'agent',
            joined_at: '2026-02-01',
            allowed_sections: ['/bandeja'],
          },
        ],
        error: null,
      }
    case 'workspace_invites':
      if (op.accion === 'insert') return { data: null, error: null }
      return {
        data: [
          {
            email: 'nueva@tienda.com',
            role: 'agent',
            expires_at: '2026-09-01',
            allowed_sections: [],
          },
        ],
        error: null,
      }
    case 'profiles':
      return {
        data: [
          { user_id: DUENO, full_name: 'Juan', email: 'juan@tienda.com' },
          { user_id: OTRO, full_name: 'Ana', email: 'ana@tienda.com' },
        ],
        error: null,
      }
    default:
      return { data: null, error: null }
  }
}

function fakeDb(correoFalla = false): SupabaseClient {
  const api = {
    from(tabla: string) {
      const op: Op = { tabla, accion: 'select', metodo: 'lista', filtros: [] }
      log.push(op)
      const chain: Record<string, unknown> = {}
      const self = () => chain
      const resolver = (metodo: Op['metodo']) => {
        op.metodo = metodo
        return Promise.resolve(responder(op))
      }
      Object.assign(chain, {
        select: self,
        order: self,
        limit: self,
        is: self,
        eq(columna: string, valor: unknown) {
          op.filtros.push([columna, valor])
          return chain
        },
        in(columna: string, valores: unknown) {
          op.filtros.push([columna, valores])
          return chain
        },
        update(payload: Record<string, unknown>) {
          op.accion = 'update'
          op.payload = payload
          return chain
        },
        insert(payload: Record<string, unknown>) {
          op.accion = 'insert'
          op.payload = payload
          return chain
        },
        maybeSingle: () => resolver('maybeSingle'),
        single: () => resolver('single'),
        then: (ok: unknown, err: unknown) =>
          resolver('lista').then(
            ok as (v: unknown) => unknown,
            err as (e: unknown) => unknown,
          ),
      })
      return chain
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => ({
          error: correoFalla ? { message: 'SMTP not configured' } : null,
        }),
      },
    },
  }
  return api as unknown as SupabaseClient
}

function ctx(actor: CapabilityContext['actor'], db = fakeDb()): CapabilityContext {
  return { db, workspaceId: WS, actor, locale: 'es' }
}

function capacidad(key: string) {
  const cap = WORKSPACE_CAPABILITIES.find((c) => c.key === key)
  if (!cap) throw new Error(`falta ${key}`)
  return cap
}

beforeEach(() => {
  log = []
})

// ---------------------------------------------------------------------------

describe('zona horaria', () => {
  it('acepta zonas IANA, incluidos los alias vivos', () => {
    expect(esZonaHorariaValida('America/Bogota')).toBe(true)
    expect(esZonaHorariaValida('UTC')).toBe(true)
    expect(esZonaHorariaValida('America/Argentina/Buenos_Aires')).toBe(true)
    // Alias: no está en supportedValuesOf pero formatea igual.
    expect(esZonaHorariaValida('Asia/Calcutta')).toBe(true)
  })

  it('rechaza lo que rompería todo formateo de fecha', () => {
    expect(esZonaHorariaValida('Bogotá')).toBe(false)
    expect(esZonaHorariaValida('Marte/Olimpo')).toBe(false)
    expect(esZonaHorariaValida('')).toBe(false)
    expect(esZonaHorariaValida(null)).toBe(false)
    // Intl lo acepta desde ES2024, pero el <select> del panel no lo tiene:
    // el comercio se quedaría sin poder ver ni cambiar lo que guardó.
    expect(esZonaHorariaValida('+05:00')).toBe(false)
  })

  it('una zona inválida no llega a la base', async () => {
    await expect(cambiarZonaHoraria(fakeDb(), WS, 'Marte/Olimpo')).rejects.toThrow(
      /no es una zona horaria válida/,
    )
    expect(log).toHaveLength(0)
  })

  it('guarda la nueva y dice cuál era la anterior', async () => {
    const res = await cambiarZonaHoraria(fakeDb(), WS, ' America/Bogota ')
    expect(res).toEqual({ antes: 'America/Argentina/Buenos_Aires', ahora: 'America/Bogota' })
    const update = log.find((o) => o.accion === 'update')
    expect(update?.payload?.timezone).toBe('America/Bogota')
  })
})

describe('nombre de la cuenta', () => {
  it('recorta y devuelve el anterior', async () => {
    const res = await renombrarCuenta(fakeDb(), WS, '  Pilar Skin  ')
    expect(res).toEqual({ antes: 'Pilar', ahora: 'Pilar Skin' })
    expect(log.find((o) => o.accion === 'update')?.payload?.name).toBe('Pilar Skin')
  })

  it('no deja la cuenta sin nombre', async () => {
    await expect(renombrarCuenta(fakeDb(), WS, '   ')).rejects.toThrow(/no puede quedar vacío/)
    expect(log.some((o) => o.accion === 'update')).toBe(false)
  })

  it('no deja un nombre que no entra en la barra lateral', async () => {
    await expect(renombrarCuenta(fakeDb(), WS, 'x'.repeat(81))).rejects.toThrow(/80/)
  })
})

describe('leer los ajustes', () => {
  it('arma el equipo con el dueño marcado y el perfil emparejado por user_id', async () => {
    const ajustes = await leerAjustes(fakeDb(), WS)
    expect(ajustes.nombre).toBe('Pilar')
    expect(ajustes.zona_horaria).toBe('America/Argentina/Buenos_Aires')
    expect(ajustes.equipo).toEqual([
      {
        nombre: 'Juan',
        email: 'juan@tienda.com',
        rol: 'admin',
        es_dueno: true,
        desde: '2026-01-01',
        secciones: null,
      },
      {
        nombre: 'Ana',
        email: 'ana@tienda.com',
        rol: 'agent',
        es_dueno: false,
        desde: '2026-02-01',
        secciones: ['/bandeja'],
      },
    ])
    expect(ajustes.invitaciones_pendientes).toEqual([
      { email: 'nueva@tienda.com', rol: 'agent', expira: '2026-09-01', secciones: [] },
    ])
    // El perfil se busca por user_id: `profiles.id` es otra columna y
    // emparejar por ahí devolvía el equipo entero sin nombre ni correo.
    expect(log.find((o) => o.tabla === 'profiles')?.filtros[0][0]).toBe('user_id')
  })
})

describe('invitar', () => {
  it('guarda el correo en minúsculas y devuelve el enlace de aceptación', async () => {
    const res = await crearInvitacion(fakeDb(), {
      workspaceId: WS,
      email: '  Nueva@Tienda.com ',
      invitadoPor: DUENO,
      baseUrl: 'https://riverz.co/api/workspace/invite',
    })
    expect(res.email).toBe('nueva@tienda.com')
    expect(res.rol).toBe('agent')
    expect(res.correoEntregado).toBe(true)
    expect(res.enlace).toMatch(/^https:\/\/riverz\.co\/invitacion\/[a-f0-9]{48}$/)
    const insert = log.find((o) => o.accion === 'insert')
    expect(insert?.payload?.invited_by).toBe(DUENO)
    expect(insert?.payload?.workspace_id).toBe(WS)
  })

  it('un admin entra a todo aunque le manden secciones', async () => {
    const res = await crearInvitacion(fakeDb(), {
      workspaceId: WS,
      email: 'jefe@tienda.com',
      rol: 'admin',
      secciones: ['/bandeja'],
      invitadoPor: DUENO,
    })
    expect(res.secciones).toBeNull()
  })

  it('a un agente le quedan sólo las secciones que existen', async () => {
    const res = await crearInvitacion(fakeDb(), {
      workspaceId: WS,
      email: 'agente@tienda.com',
      rol: 'agent',
      secciones: ['/bandeja', '/inventado', '/bandeja'],
      invitadoPor: DUENO,
    })
    expect(res.secciones).toEqual(['/bandeja'])
  })

  it('si el correo no sale, la invitación existe igual', async () => {
    const res = await crearInvitacion(fakeDb(true), {
      workspaceId: WS,
      email: 'nueva@tienda.com',
      invitadoPor: DUENO,
    })
    expect(res.correoEntregado).toBe(false)
    expect(res.enlace).toContain('/invitacion/')
  })

  it('un correo mal escrito no llega a guardarse', async () => {
    await expect(
      crearInvitacion(fakeDb(), {
        workspaceId: WS,
        email: 'no-es-un-correo',
        invitadoPor: DUENO,
      }),
    ).rejects.toBeInstanceOf(ErrorDeInvitacion)
    expect(log.some((o) => o.accion === 'insert')).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('capacidades de ajustes', () => {
  it('ninguna pide la cuenta como argumento', () => {
    for (const c of WORKSPACE_CAPABILITIES) {
      expect(Object.keys(c.schema.properties), c.key).not.toContain('workspace_id')
      expect(c.schema.required ?? [], c.key).not.toContain('workspace_id')
    }
  })

  it('invitar es irreversible y trae preview', () => {
    const cap = capacidad('ajustes.invitar')
    expect(cap.risk).toBe('irreversible')
    expect(typeof cap.preview).toBe('function')
  })

  it('lo que mueve horarios o le llega a alguien pide permiso', () => {
    // Cambiar la zona horaria mueve el horario de atención de las
    // automatizaciones que ya están corriendo, e invitar le llega a una persona
    // por correo. Renombrar la cuenta lo ve el equipo en su propia barra
    // lateral y nadie más, así que sí puede construirse dentro de un plan.
    expect(esInerte(capacidad('ajustes.zona_horaria'), {})).toBe(false)
    expect(esInerte(capacidad('ajustes.invitar'), {})).toBe(false)
    expect(esInerte(capacidad('ajustes.renombrar'), {})).toBe(true)
  })

  it('el preview de invitar dice a quién, a qué cuenta y con qué acceso', async () => {
    const cap = capacidad('ajustes.invitar')
    const texto = await cap.preview!(ctx({ type: 'ui', id: DUENO }), {
      email: 'Ana@Tienda.com',
      rol: 'agent',
      secciones: ['/bandeja'],
    })
    expect(texto).toContain('ana@tienda.com')
    expect(texto).toContain('Pilar')
    expect(texto).toContain('agente')
    expect(texto).toMatch(/no se puede cancelar/)
  })

  it('el preview de la zona horaria avisa que mueve toda la cuenta', async () => {
    const cap = capacidad('ajustes.zona_horaria')
    const texto = await cap.preview!(ctx({ type: 'operator', id: DUENO }), {
      zona_horaria: 'America/Bogota',
    })
    expect(texto).toContain('America/Argentina/Buenos_Aires')
    expect(texto).toContain('America/Bogota')
    expect(texto).toMatch(/automatizaciones/)
  })

  it('quien no manda en la cuenta no puede sumar gente', async () => {
    const cap = capacidad('ajustes.invitar')
    await expect(
      cap.run(ctx({ type: 'ui', id: OTRO }), { email: 'colado@tienda.com' }),
    ).rejects.toThrow(/admin/)
    expect(log.some((o) => o.accion === 'insert')).toBe(false)
  })

  it('por MCP la invitación queda a nombre del dueño', async () => {
    // No hay persona detrás de una llave, y `invited_by` es NOT NULL contra
    // auth.users: sin este fallback la invitación por MCP no se podía guardar.
    const cap = capacidad('ajustes.invitar')
    const res = (await cap.run(ctx({ type: 'mcp', id: 'llave-1' }), {
      email: 'nueva@tienda.com',
    })) as { correo_entregado: boolean; enlace: string | null }
    expect(res.correo_entregado).toBe(true)
    // El enlace lleva el token: con el correo entregado no se devuelve.
    expect(res.enlace).toBeNull()
    expect(log.find((o) => o.accion === 'insert')?.payload?.invited_by).toBe(DUENO)
  })
})
