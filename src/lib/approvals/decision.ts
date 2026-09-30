import type { Decision } from './resolve';

/** Accept an explicit decision; conflicting fields must never approve money. */
export function approvalDecision(body: unknown): Decision | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const legacy = value.decision === 'aprobada' || value.decision === 'rechazada'
    ? value.decision
    : null;
  if ('aprobar' in value) {
    if (typeof value.aprobar !== 'boolean') return null;
    const decision = value.aprobar ? 'aprobada' : 'rechazada';
    return 'decision' in value && legacy !== decision ? null : decision;
  }
  return legacy;
}
