import { createHash } from 'node:crypto'
import { UUID } from './collaboration'
export function bulkCaseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100 || !raw.every(id => typeof id === 'string' && UUID.test(id))) return null
  return [...new Set(raw)].sort()
}
export function bulkCaseRunId(operationId: string, conversationId: string): string {
  const hex = createHash('sha256').update(`riverz-inbox:${operationId}:${conversationId}`).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
