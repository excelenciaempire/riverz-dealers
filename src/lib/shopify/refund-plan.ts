export interface RefundTransaction {
  id: string | number; parent_id?: string | number | null
  kind: string; status: string; amount: string; gateway: string
}
const SCALE = BigInt(1_000_000)
/** Shopify decimal amounts, kept exact through allocation (including three-decimal currencies). */
export function refundMoney(raw: unknown): bigint | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0 || Number(raw.toFixed(6)) !== raw) return null
    raw = raw.toFixed(6)
  }
  if (typeof raw !== 'string' || !/^\d{1,14}(\.\d{1,6})?$/.test(raw)) return null
  const [whole, fraction = ''] = raw.split('.')
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'))
}
export function refundMoneyText(amount: bigint): string {
  const whole = amount / SCALE
  const fraction = (amount % SCALE).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${fraction}`
}
export function planRefund(transactions: RefundTransaction[], requested?: number): {
  ok: true; amount: string; transactions: { parent_id: string | number; amount: string; kind: 'refund'; gateway: string }[]
} | { ok: false; error: string } {
  const wanted = requested === undefined ? null : refundMoney(requested)
  if (requested !== undefined && (wanted === null || wanted <= BigInt(0))) return { ok: false, error: 'invalid_refund_amount' }
  const captures = transactions.filter(t => ['sale', 'capture'].includes(t.kind) && t.status === 'success')
  if (!captures.length) return { ok: false, error: 'sin_cobro_registrado' }
  const available = new Map<string, bigint>()
  for (const t of captures) {
    const amount = refundMoney(t.amount)
    if (amount === null || !t.id || !t.gateway || available.has(String(t.id))) return { ok: false, error: 'refund_history_unverified' }
    available.set(String(t.id), amount)
  }
  const seenRefunds = new Set<string>()
  for (const t of transactions.filter(t => t.kind === 'refund')) {
    if (['failure', 'error'].includes(t.status)) continue
    if (t.status !== 'success') return { ok: false, error: 'refund_pending' }
    if (!t.id || seenRefunds.has(String(t.id))) return { ok:false,error:'refund_history_unverified' }
    seenRefunds.add(String(t.id))
    const key = String(t.parent_id ?? '')
    const amount = refundMoney(t.amount), previous = available.get(key)
    if (amount === null || previous === undefined || amount > previous) return { ok: false, error: 'refund_history_unverified' }
    available.set(key, previous - amount)
  }
  const remaining = [...available.values()].reduce((sum, amount) => sum + amount, BigInt(0))
  if (remaining <= BigInt(0)) return { ok: false, error: 'refund_already_returned' }
  if (wanted !== null && wanted > remaining) return { ok: false, error: 'monto_mayor_al_cobrado' }
  let left = wanted ?? remaining
  const lines: { parent_id: string | number; amount: string; kind: 'refund'; gateway: string }[] = []
  for (const t of captures) {
    const balance = available.get(String(t.id))!
    const amount = balance < left ? balance : left
    if (amount > BigInt(0)) lines.push({ parent_id: t.id, amount: refundMoneyText(amount), kind: 'refund', gateway: t.gateway })
    left -= amount
    if (left === BigInt(0)) break
  }
  return { ok: true, amount: refundMoneyText(wanted ?? remaining), transactions: lines }
}

/** A successful HTTP response alone does not establish a successful financial transaction. */
export function verifiedRefundTransactions(actual: RefundTransaction[], expected: { parent_id: string | number; amount: string }[]): boolean {
  if (!actual.length || actual.some(t => t.kind !== 'refund' || t.status !== 'success')) return false
  const amounts = new Map<string, bigint>()
  const seenIds = new Set<string>()
  for (const t of actual) {
    const amount = refundMoney(t.amount)
    if (amount === null || amount <= BigInt(0) || !t.parent_id || !t.id || seenIds.has(String(t.id))) return false
    seenIds.add(String(t.id))
    const key = String(t.parent_id)
    amounts.set(key, (amounts.get(key) ?? BigInt(0)) + amount)
  }
  return amounts.size === expected.length && expected.every(t => amounts.get(String(t.parent_id)) === refundMoney(t.amount))
}
