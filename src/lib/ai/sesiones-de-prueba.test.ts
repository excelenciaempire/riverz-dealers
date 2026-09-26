import { describe, expect, it } from 'vitest'
import {
  contarMensajes,
  leerPropuestas,
  limpiarFeedback,
  limpiarItems,
  primerMensaje,
  transcripcionConFeedback,
} from './sesiones-de-prueba'

describe('sesiones de prueba', () => {
  const items = limpiarItems([
    { k: 'sys', texto: 'Nuevo pedido', icono: 'raro' },
    { k: 'me', texto: 'hola precio?', hora: '10:00' },
    { k: 'biz', texto: 'Sale $61.990 el de 4 meses', nota: 'Contesta Natalia', botones: [{ text: 'Ver', type: 'URL', extra: 1 }] },
    { k: 'typing' },
    { k: 'otro', texto: 'x' },
  ])

  it('guarda sólo lo que se ve en el chat, sin campos de más', () => {
    expect(items.map((i) => i.k)).toEqual(['sys', 'me', 'biz'])
    expect(items[0]).toEqual({ k: 'sys', texto: 'Nuevo pedido' })
    expect(items[2]).toMatchObject({ botones: [{ text: 'Ver', type: 'URL' }] })
    expect(contarMensajes(items)).toBe(2)
    expect(primerMensaje(items)).toBe('hola precio?')
  })

  it('descarta feedback vacío o que apunta a un mensaje que no existe', () => {
    const f = limpiarFeedback(
      [
        { item: 2, voto: 'mal', nota: 'Tiene que ofrecer Mercado Libre' },
        { item: 9, voto: 'mal', nota: 'fuera de rango' },
        { item: 1, voto: null, nota: '  ' },
        { item: null, nota: 'Muy largo todo' },
      ],
      items.length
    )
    expect(f.map((x) => x.item)).toEqual([2, null])
    const texto = transcripcionConFeedback(items, f)
    expect(texto).toContain('[2] TIENDA: Sale $61.990 el de 4 meses')
    expect(texto).toContain('está mal — "Tiene que ofrecer Mercado Libre"')
    expect(texto).toContain('Muy largo todo')
  })

  it('sólo propone editar reglas que existen, y tolera texto alrededor del JSON', () => {
    const existentes = { reglas: new Set(['r1']), agentes: new Set(['a1']) }
    const p = leerPropuestas(
      'Acá va: {"reglas":[{"accion":"editar","regla_id":"r1","agente_id":"a1","titulo":"Precio","cuando":"Piden precio","hacer":"Decí el de 4 meses","porque":"feedback 2"},{"accion":"editar","regla_id":"inventada","agente_id":"a1","titulo":"Otra","hacer":"x"},{"accion":"crear","agente_id":"ajeno","titulo":"Tercera","hacer":"y"}],"plataforma":[{"problema":"La plantilla","prompt":"Reescribir"}]} listo',
      existentes
    )
    expect(p.reglas).toHaveLength(3)
    expect(p.reglas[0]).toMatchObject({ accion: 'editar', regla_id: 'r1', agente_id: null })
    expect(p.reglas[1]).toMatchObject({ accion: 'crear', regla_id: null, agente_id: 'a1' })
    expect(p.reglas[2]).toMatchObject({ accion: 'crear', agente_id: null })
    expect(p.plataforma).toEqual([{ problema: 'La plantilla', prompt: 'Reescribir' }])
    expect(leerPropuestas('no es json', existentes)).toEqual({ reglas: [], plataforma: [] })
  })
})
