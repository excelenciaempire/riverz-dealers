import { describe, it, expect } from 'vitest'
import { MCP_TOOLS, findTool } from './registry'

/**
 * El contrato del MCP: qué herramientas hay y cuál pide permiso.
 *
 * Es lo que separa "el agente opera la cuenta" de "el agente le escribe a
 * 3.264 personas sin que nadie lo mire". Un cambio de riesgo acá tiene que
 * ser deliberado, no un descuido.
 */
describe('registro de herramientas', () => {
  it('todas declaran nombre, riesgo y esquema', () => {
    for (const t of MCP_TOOLS) {
      expect(t.name, 'sin nombre').toBeTruthy()
      expect(['lectura', 'reversible', 'irreversible']).toContain(t.risk)
      expect(t.schema.type).toBe('object')
      expect(t.description.length, `${t.name} sin descripción`).toBeGreaterThan(20)
    }
  })

  it('no hay nombres repetidos', () => {
    const nombres = MCP_TOOLS.map((t) => t.name)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('todo lo que le llega a un cliente es irreversible', () => {
    // Si algún día alguien agrega "campana_lanzar" como reversible, esto lo
    // frena antes de que salga a producción.
    const queEscriben = MCP_TOOLS.filter((t) =>
      /enviar|mandar|lanzar|campana/i.test(t.name),
    )
    expect(queEscriben.length).toBeGreaterThan(0)
    for (const t of queEscriben) {
      expect(t.risk, `${t.name} le llega a una persona`).toBe('irreversible')
    }
  })

  it('lo irreversible muestra antes qué haría', () => {
    for (const t of MCP_TOOLS.filter((x) => x.risk === 'irreversible')) {
      expect(t.preview, `${t.name} sin vista previa`).toBeTypeOf('function')
    }
  })

  it('toda herramienta que toca una cuenta exige workspace_id', () => {
    // Adivinar la cuenta es la clase de bug que enterró dos flujos.
    const sinCuenta = ['cuentas_listar', 'cron_estado']
    for (const t of MCP_TOOLS) {
      if (sinCuenta.includes(t.name)) continue
      expect(t.schema.required, `${t.name} no pide workspace_id`).toContain('workspace_id')
    }
  })

  it('encuentra por nombre y no inventa', () => {
    expect(findTool('operacion_estado')?.risk).toBe('lectura')
    expect(findTool('no_existe')).toBeUndefined()
  })
})
