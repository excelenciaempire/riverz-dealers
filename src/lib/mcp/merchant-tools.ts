import { desdeCapacidad, type McpTool } from './tool'

/**
 * Las herramientas del COMERCIO.
 *
 * Las de `registry.ts` nacieron para el equipo de Riverz: son de diagnóstico
 * —"¿por qué no le llegó el mensaje a esta persona?"— y sirven cuando ya sabés
 * que algo se rompió. Un comercio llega con otras preguntas, y son las de todos
 * los días: quién me escribió y nadie contestó, quién es este cliente, cómo
 * vengo, qué plantilla tengo trabada, cómo salió la campaña.
 *
 * La implementación no está acá: cada una publica una capacidad de
 * `src/lib/capabilities`, que es la misma que usan el panel y el Operator. Este
 * archivo es sólo el nombre con el que cada una sale al protocolo — y ese
 * nombre no cambia aunque la capacidad se llame distinto, porque del otro lado
 * hay clientes ya configurados.
 *
 * Sobre los datos personales: acá SÍ salen nombres y teléfonos. Son los
 * clientes del comercio que está preguntando, con su propia llave, sobre su
 * propia cuenta. Es lo contrario del panel de plataforma, que mira cuentas
 * ajenas y por eso no puede verlos.
 */
export const MERCHANT_TOOLS: McpTool[] = [
  desdeCapacidad('conversaciones_pendientes', 'conversaciones.pendientes'),
  desdeCapacidad('contacto_buscar', 'contactos.buscar'),
  desdeCapacidad('metricas', 'metricas.resumen'),
  desdeCapacidad('plantillas_estado', 'plantillas.estado'),
  desdeCapacidad('campanas_estado', 'campanas.estado'),
  desdeCapacidad('pedidos_listar', 'pedidos.listar'),
]
