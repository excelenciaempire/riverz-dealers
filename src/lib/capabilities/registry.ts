/**
 * El catálogo completo de lo que Riverz sabe hacer sobre una cuenta.
 *
 * Una sola lista, tres consumidores: el MCP la publica por HTTP, el Operator la
 * usa como sus herramientas, y las pantallas nuevas la llaman directo. Sumar
 * una capacidad acá la deja disponible en los tres a la vez — que es lo que
 * antes obligaba a escribir la misma consulta tres veces.
 */
import { AGENT_CAPABILITIES } from './agents'
import { APPROVAL_CAPABILITIES } from './approvals'
import { AUTOMATION_CAPABILITIES } from './automations'
import { BANDEJA_CAPABILITIES } from './bandeja'
import { BROADCAST_CAPABILITIES } from './broadcasts'
import { COMMENT_CAPABILITIES } from './comments'
import { CONTACT_CAPABILITIES } from './contacts'
import { FLOW_CAPABILITIES } from './flows'
import { HEALTH_CAPABILITIES } from './health'
import { INBOX_CAPABILITIES } from './inbox'
import { INTEGRATION_CAPABILITIES } from './integrations'
import { HTTP_ACTION_CAPABILITIES } from './http-actions'
import { RETURN_LOGISTICS_CAPABILITIES } from './return-logistics'
import { PRODUCT_RETURN_POLICY_CAPABILITIES } from './product-return-policy'
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview'
import { MESSAGING_CAPABILITIES } from './messaging'
import { METRICS_CAPABILITIES } from './metrics'
import { ORDER_CAPABILITIES } from './orders'
import { OUTBOUND_CAPABILITIES } from './outbound'
import { PRODUCT_CAPABILITIES } from './products'
import { PROSPECTING_CAPABILITIES } from './prospecting'
import { RASMIAW_CAPABILITIES } from './rasmiaw'
import { VOICE_CAPABILITIES } from './voice'
import { WORKSPACE_CAPABILITIES } from './workspace'
import { WEBCHAT_CAPABILITIES } from './webchat'
import { DEALER_CAPABILITIES } from './dealers'
import { isDealerDeployment } from '@/lib/dealers/config'
import type { AnyCapability, Capability, CapabilitySchema } from './types'

export const ALL_CAPABILITIES: Capability[] = [
  ...(isDealerDeployment() ? DEALER_CAPABILITIES : []),
  ...HEALTH_CAPABILITIES,
  ...(!isDealerDeployment() ? METRICS_CAPABILITIES : []),
  ...MESSAGING_CAPABILITIES,
  ...INBOX_CAPABILITIES,
  ...BANDEJA_CAPABILITIES,
  ...AUTOMATION_CAPABILITIES,
  ...(!isDealerDeployment() ? FLOW_CAPABILITIES : []),
  ...CONTACT_CAPABILITIES,
  ...OUTBOUND_CAPABILITIES,
  ...BROADCAST_CAPABILITIES,
  ...(!isDealerDeployment() ? ORDER_CAPABILITIES : []),
  ...APPROVAL_CAPABILITIES,
  ...AGENT_CAPABILITIES,
  ...(!isDealerDeployment() ? PRODUCT_CAPABILITIES : []),
  ...COMMENT_CAPABILITIES,
  ...VOICE_CAPABILITIES,
  ...PROSPECTING_CAPABILITIES,
  ...(!isDealerDeployment() ? RASMIAW_CAPABILITIES : []),
  ...(!isDealerDeployment() ? INTEGRATION_CAPABILITIES : []),
  ...WORKSPACE_CAPABILITIES,
  ...WEBCHAT_CAPABILITIES,
  ...(SHOW_RIVERZ_IMPROVEMENTS ? HTTP_ACTION_CAPABILITIES : []),
  ...(SHOW_RIVERZ_IMPROVEMENTS && !isDealerDeployment() ? RETURN_LOGISTICS_CAPABILITIES : []),
  ...(SHOW_RIVERZ_IMPROVEMENTS && !isDealerDeployment() ? PRODUCT_RETURN_POLICY_CAPABILITIES : []),
]

export function findCapability(key: string): AnyCapability | undefined {
  return ALL_CAPABILITIES.find((c) => c.key === key) as AnyCapability | undefined
}

/** Como la anterior, pero corta si no existe: para quien ya sabe la clave. */
export function getCapability(key: string): AnyCapability {
  const cap = findCapability(key)
  if (!cap) throw new Error(`no existe la capacidad "${key}"`)
  return cap
}

/**
 * ¿Esta llamada concreta deja algo apagado?
 *
 * Con estos argumentos, no en general: prender una automatización y pausarla
 * son la misma capacidad y no son lo mismo. Sin declaración, NO es inerte —
 * ante la duda se propone y decide una persona.
 */
export function esInerte(cap: AnyCapability, args: Record<string, unknown>): boolean {
  if (cap.risk === 'lectura') return true
  if (typeof cap.inerte === 'function') return cap.inerte(args) === true
  return cap.inerte === true
}

/**
 * El mismo schema con `workspace_id` adelante.
 *
 * La capacidad no lo declara porque la cuenta va en el contexto y no en los
 * argumentos. El MCP sí lo necesita: del otro lado hay un cliente que puede
 * operar varias cuentas con la llave del equipo.
 */
export function withWorkspaceArg(schema: CapabilitySchema): CapabilitySchema {
  return {
    type: 'object',
    properties: { workspace_id: { type: 'string' }, ...schema.properties },
    required: ['workspace_id', ...(schema.required ?? [])],
  }
}

/**
 * Las capacidades como herramientas de Anthropic, para el Operator.
 *
 * Sin `workspace_id`: el Operator ya opera sobre una cuenta fija, y ofrecerle
 * el parámetro sería darle la posibilidad de escribir otro.
 */
export function capabilitiesAsAnthropicTools(
  caps: Capability[] = ALL_CAPABILITIES,
): Array<{ name: string; description: string; input_schema: CapabilitySchema }> {
  return caps.map((c) => ({
    // Los puntos no están permitidos en el nombre de una tool de Anthropic.
    name: c.key.replace(/\./g, '__'),
    description: c.description,
    input_schema: c.schema,
  }))
}

/** Vuelta de `capabilitiesAsAnthropicTools`: nombre de tool → clave real. */
export function capabilityKeyFromToolName(name: string): string {
  return name.replace(/__/g, '.')
}
