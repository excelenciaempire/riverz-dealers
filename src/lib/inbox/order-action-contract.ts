import { UUID } from './collaboration'
import { refundMoney } from '@/lib/shopify/refund-plan'

export type CaseOrderAction = { type: 'refund'; amount: number | null; reason: string } | { type: 'cancel'; reason: string }
export interface CaseOrderOperation {
  id: string; order_id: string; requested_by: string; approved_by: string | null;
  action: CaseOrderAction; preview: { order_name: string; amount: string | null; currency: string; financial_status: string; fulfillment_status: string | null };
  fingerprint: string; status: 'preview' | 'running' | 'completed' | 'failed' | 'uncertain' | 'expired' | 'reviewed';
  expires_at: string; created_at: string; approved_at: string | null; result: Record<string, unknown> | null
}
export function caseOrderAction(raw: unknown): CaseOrderAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  if (!['refund','cancel'].includes(String(v.type)) || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 300) return null
  if (Object.keys(v).some(k => !['type','reason',...(v.type === 'refund' ? ['amount'] : [])].includes(k))) return null
  if (v.type === 'cancel') return { type: 'cancel', reason: v.reason.trim() }
  if (v.amount !== null && (typeof v.amount !== 'number' || (refundMoney(v.amount) ?? BigInt(0)) <= BigInt(0))) return null
  return { type: 'refund', amount: v.amount as number | null, reason: v.reason.trim() }
}
export function orderPreviewInput(raw: unknown): { id: string; order_id: string; action: CaseOrderAction } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>, action = caseOrderAction(v.action)
  if (!action || typeof v.id !== 'string' || !UUID.test(v.id) || typeof v.order_id !== 'string' || !UUID.test(v.order_id) || Object.keys(v).some(k => !['id','order_id','action'].includes(k))) return null
  return { id: v.id, order_id: v.order_id, action }
}
