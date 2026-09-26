import { describe, expect, it } from 'vitest'
import { decidir, leerLimite, leerNumeros, numeroHabilitado, type Piloto } from './index'

const base: Piloto = {
  id: 'p1',
  workspace_id: 'w1',
  estado: 'activo',
  canales: [],
  limite_mensajes: 20,
  limite_comentarios: 5,
  limite_automatizaciones: null,
  usados_mensajes: 0,
  usados_comentarios: 0,
  usados_automatizaciones: 0,
  solo_numeros: [],
  iniciado_at: null,
  terminado_at: null,
  created_at: '',
  updated_at: '',
}

describe('piloto en vivo', () => {
  it('deja pasar mientras quede cupo, y corta al llegar', () => {
    expect(decidir(base, { tipo: 'mensaje', canal: 'whatsapp' })).toBeNull()
    expect(decidir({ ...base, usados_mensajes: 20 }, { tipo: 'mensaje' })).toBe('piloto_sin_cupo')
    expect(decidir({ ...base, usados_comentarios: 5 }, { tipo: 'comentario' })).toBe('piloto_sin_cupo')
    // Sin tope en automatizaciones: no se cuentan contra nada.
    expect(decidir({ ...base, usados_automatizaciones: 999 }, { tipo: 'automatizacion' })).toBeNull()
  })

  it('un piloto agotado deja todo en pausa', () => {
    expect(decidir({ ...base, estado: 'agotado' }, { tipo: 'mensaje' })).toBe('piloto_agotado')
  })

  it('sólo los canales elegidos', () => {
    const p = { ...base, canales: ['whatsapp'] }
    expect(decidir(p, { tipo: 'mensaje', canal: 'whatsapp' })).toBeNull()
    expect(decidir(p, { tipo: 'mensaje', canal: 'instagram' })).toBe('piloto_canal')
  })

  it('sólo para mi número: en cualquier formato, y nadie más', () => {
    const p = { ...base, solo_numeros: ['+54 9 11 5517-7177'] }
    expect(numeroHabilitado(p, '5491155177177')).toBe(true)
    expect(numeroHabilitado(p, '1155177177')).toBe(true)
    expect(decidir(p, { tipo: 'mensaje', telefono: '5491122223333' })).toBe('piloto_numero')
    // Un comentario no trae teléfono: con la lista puesta, no sale.
    expect(decidir(p, { tipo: 'comentario', telefono: null })).toBe('piloto_numero')
  })

  it('lee lo que escribe el comercio', () => {
    expect(leerNumeros('+54 9 11 5517-7177\n 573001234567, 12')).toEqual(['5491155177177', '573001234567'])
    expect(leerLimite('')).toBeNull()
    expect(leerLimite('20')).toBe(20)
    expect(leerLimite('-1')).toBeNull()
  })
})
