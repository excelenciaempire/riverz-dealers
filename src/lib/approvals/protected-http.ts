/** Reserve malformed proposals too: they must never fall through to legacy tool execution. */
export function isProtectedHttpApproval(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const tool = (payload as Record<string, unknown>).tool;
  return typeof tool === 'string' && (tool.startsWith('http_action_') || tool.startsWith('http_flow_action_'));
}
export const httpApprovalPanelMessage = (locale: 'es' | 'en') => locale === 'en'
  ? 'Review this system action in the dashboard with an authorized administrator account.'
  : 'Revisa esta acción del sistema en el panel con una cuenta de administrador autorizada.';
