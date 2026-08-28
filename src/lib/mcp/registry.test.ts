import { describe, it, expect } from 'vitest'
import { ALL_TOOLS, MCP_TOOLS, findTool } from './registry'

/**
 * El contrato del MCP: qué herramientas hay y cuál pide permiso.
 *
 * Es lo que separa "el agente opera la cuenta" de "el agente le escribe a
 * 3.264 personas sin que nadie lo mire". Un cambio de riesgo acá tiene que
 * ser deliberado, no un descuido.
 *
 * Todo se prueba sobre `ALL_TOOLS` y no sobre `MCP_TOOLS`. Antes sólo se
 * revisaba la lista de operación, así que las seis del comercio —las que
 * devuelven fichas de clientes— no estaban cubiertas por ninguna invariante:
 * agregar ahí una herramienta de escritura sin vista previa no habría roto
 * nada.
 */
describe('registro de herramientas', () => {
  it('todas declaran nombre, riesgo y esquema', () => {
    for (const t of ALL_TOOLS) {
      expect(t.name, 'sin nombre').toBeTruthy()
      expect(['lectura', 'reversible', 'irreversible']).toContain(t.risk)
      expect(t.schema.type).toBe('object')
      expect(t.description.length, `${t.name} sin descripción`).toBeGreaterThan(20)
    }
  })

  it('no hay nombres repetidos', () => {
    const nombres = ALL_TOOLS.map((t) => t.name)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('todo lo que le llega a un cliente es irreversible', () => {
    // Si algún día alguien agrega "campana_lanzar" como reversible, esto lo
    // frena antes de que salga a producción.
    const queEscriben = ALL_TOOLS.filter((t) => /enviar|mandar|lanzar/i.test(t.name))
    expect(queEscriben.length).toBeGreaterThan(0)
    for (const t of queEscriben) {
      expect(t.risk, `${t.name} le llega a una persona`).toBe('irreversible')
    }
  })

  it('lo irreversible muestra antes qué haría', () => {
    for (const t of ALL_TOOLS.filter((x) => x.risk === 'irreversible')) {
      expect(t.preview, `${t.name} sin vista previa`).toBeTypeOf('function')
    }
  })

  it('toda herramienta que toca una cuenta exige workspace_id', () => {
    // Adivinar la cuenta es la clase de bug que enterró dos flujos.
    const sinCuenta = ['cuentas_listar', 'cron_estado']
    for (const t of ALL_TOOLS) {
      if (sinCuenta.includes(t.name)) continue
      expect(t.schema.required, `${t.name} no pide workspace_id`).toContain('workspace_id')
    }
  })

  it('sólo las de plataforma se marcan platformOnly', () => {
    // Marcar una del comercio la escondería de su propia llave.
    const soloEquipo = ALL_TOOLS.filter((t) => t.platformOnly).map((t) => t.name)
    expect(soloEquipo).toEqual(['cron_estado'])
  })

  it('los nombres públicos no cambiaron', () => {
    // Del otro lado hay clientes ya configurados: renombrar una herramienta les
    // rompe el flujo sin aviso. Esta lista es el contrato.
    expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual(
      [
        'aprobacion_decidir',
        'automatizacion_activar',
        'automatizacion_editar_espera',
        'campanas_estado',
        'contacto_buscar',
        'contactos_listar',
        'conversacion_detalle',
        'conversacion_mensajes',
        'conversaciones_pendientes',
        'cron_estado',
        'cuentas_listar',
        'etiquetas_listar',
        'mensaje_enviar',
        'metricas',
        'operacion_estado',
        'pedidos_listar',
        'plantillas_estado',
        'por_que_no_salio',
        'segmentos_calcular',
        'segmentos_listar',
      ].sort(),
    )
  })

  it('las dos que no son sobre una cuenta siguen escritas a mano', () => {
    // El resto pasa por la capa de capacidades, que opera siempre sobre un
    // comercio. Estas dos hablan de la plataforma y por eso quedan afuera.
    expect(MCP_TOOLS.find((t) => t.name === 'cuentas_listar')).toBeDefined()
    expect(MCP_TOOLS.find((t) => t.name === 'cron_estado')?.platformOnly).toBe(true)
  })

  it('encuentra por nombre y no inventa', () => {
    expect(findTool('operacion_estado')?.risk).toBe('lectura')
    expect(findTool('no_existe')).toBeUndefined()
  })
})
