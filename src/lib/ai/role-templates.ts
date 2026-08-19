/**
 * Cómo nace un agente de cada rol.
 *
 * Un comercio no debería tener que decidir si su agente de postventa puede
 * crear pedidos: la respuesta se desprende del trabajo que hace. Estos presets
 * son esa respuesta, y son el motivo por el que la activación guiada puede
 * armar una flota sin preguntar nada.
 *
 * La persona de cada rol no se define acá: sale de la marca (lo que el Operator
 * entiende del sitio y del producto). Lo que fija este archivo es la CONDUCTA:
 * qué puede tocar, cuándo se corre y qué recetas lo acompañan.
 */
import type { AgentPermissions, AgentRole } from './roles'
import type { TemplateSlug } from '@/lib/automations/templates'

export interface RoleTemplate {
  role: AgentRole
  /** Clave i18n del nombre sugerido (namespace operation). */
  nameKey: string
  permissions: AgentPermissions
  /** Palabras que mandan la conversación a una persona. */
  escalateKeywords: string[]
  /** Recetas de automatización que hacen el trabajo de fondo de este rol. */
  recipes: TemplateSlug[]
  followupEnabled: boolean
}

export const ROLE_TEMPLATES: Record<Exclude<AgentRole, 'general'>, RoleTemplate> = {
  postventa: {
    role: 'postventa',
    nameKey: 'operation.roleAftersaleName',
    // Contesta sobre pedidos que ya existen: no vende ni cobra. Un agente de
    // postventa creando pedidos es la forma más rápida de duplicar una compra.
    permissions: {
      crear_pedidos: false,
      crear_checkout: false,
      registrar_pago: false,
      editar_pedido: false,
      escalar_llamada: true,
      enviar_proactivo: true,
    },
    escalateKeywords: ['reclamo', 'cancelar', 'devolución', 'devolucion', 'reembolso', 'estafa'],
    recipes: ['nuevo-pedido', 'enviar-tracking', 'post-survey'],
    followupEnabled: false,
  },

  recuperacion: {
    role: 'recuperacion',
    nameKey: 'operation.roleRecoveryName',
    // Su trabajo es cerrar algo que quedó a medias: manda el link y registra el
    // pago informado (que ya pasa por aprobación humana antes de cobrar). No
    // crea pedidos: si hace falta uno nuevo, es una venta y no un rescate.
    permissions: {
      crear_pedidos: false,
      crear_checkout: true,
      registrar_pago: true,
      editar_pedido: false,
      escalar_llamada: true,
      enviar_proactivo: true,
    },
    escalateKeywords: ['reclamo', 'estafa', 'denuncia'],
    recipes: ['carrito-abandonado', 'pago-rechazado', 'pago-pendiente'],
    followupEnabled: true,
  },

  ventas: {
    role: 'ventas',
    nameKey: 'operation.roleSalesName',
    permissions: {
      crear_pedidos: true,
      crear_checkout: true,
      registrar_pago: true,
      editar_pedido: false,
      escalar_llamada: true,
      enviar_proactivo: true,
    },
    escalateKeywords: ['humano', 'persona', 'reclamo', 'mayorista'],
    recipes: [],
    followupEnabled: true,
  },

  retencion: {
    role: 'retencion',
    nameKey: 'operation.roleRetentionName',
    permissions: {
      crear_pedidos: false,
      crear_checkout: true,
      registrar_pago: false,
      editar_pedido: false,
      escalar_llamada: false,
      enviar_proactivo: true,
    },
    escalateKeywords: ['baja', 'no me escriban', 'reclamo'],
    recipes: ['recompras'],
    followupEnabled: true,
  },
}

export function roleTemplate(role: AgentRole): RoleTemplate | null {
  return role === 'general' ? null : ROLE_TEMPLATES[role]
}
