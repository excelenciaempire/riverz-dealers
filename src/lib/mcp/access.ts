import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpTool } from './tool';

export interface McpUserAccess { admin: boolean; sections: string[] | null }

/** Re-read current membership on every request. Query errors never grant access. */
export async function userAccess(db: SupabaseClient, userId: string, workspaceId: string): Promise<McpUserAccess | null> {
  const { data: workspace, error } = await db.from('workspaces').select('owner_id')
    .eq('id', workspaceId).is('deleted_at', null).maybeSingle();
  if (error || !workspace) return null;
  if (workspace.owner_id === userId) return { admin: true, sections: null };
  const { data: member, error: memberError } = await db.from('workspace_members')
    .select('role, allowed_sections').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (memberError || !member || !['admin', 'agent'].includes(member.role)) return null;
  const sections = member.allowed_sections;
  if (sections !== null && (!Array.isArray(sections) || !sections.every((v: unknown) => typeof v === 'string'))) return null;
  return { admin: member.role === 'admin', sections };
}

const SECTIONS: Record<string, string> = {
  conversaciones: '/bandeja', conversacion: '/bandeja', mensajes: '/bandeja',
  contactos: '/contactos', contacto: '/contactos', etiquetas: '/contactos', segmentos: '/contactos',
  metricas: '/panel', plantillas: '/plantillas', campanas: '/campanas', pedidos: '/pedidos',
  automatizaciones: '/automatizaciones', aprobaciones: '/aprobaciones',
};

export function userCanUseTool(access: McpUserAccess, tool: McpTool): boolean {
  if (tool.name === 'comprobar_conexion') return true;
  if (tool.risk !== 'lectura' && !access.admin) return false;
  if (access.sections === null) return true;
  if (tool.capabilityKey?.startsWith('integraciones.http_')) return access.sections.includes('/automatizaciones');
  const domain = tool.capabilityKey?.split('.')[0] ?? tool.name.split('_')[0];
  const section = SECTIONS[domain];
  return !!section && access.sections.includes(section);
}
