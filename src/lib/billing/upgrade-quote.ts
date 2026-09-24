import { createHmac, timingSafeEqual } from 'node:crypto'

export type UpgradeQuote = {
  workspaceId: string
  subscriptionId: string
  planId: string
  fromPlanId: string
  amountCents: number
  quotedAt: number
  periodStart: number
  monthlyCents: number
  currency: string
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function signUpgradeQuote(quote: UpgradeQuote, secret: string): string {
  const payload = Buffer.from(JSON.stringify(quote)).toString('base64url')
  return `${payload}.${signature(payload, secret)}`
}

export function verifyUpgradeQuote(
  token: string,
  context: Pick<UpgradeQuote, 'workspaceId' | 'subscriptionId' | 'planId' | 'fromPlanId'>,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): UpgradeQuote | null {
  if (token.length > 2048) return null
  const [payload, signed] = token.split('.')
  if (!payload || !signed) return null
  const expected = Buffer.from(signature(payload, secret))
  const actual = Buffer.from(signed)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const quote = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as UpgradeQuote
    return quote.workspaceId === context.workspaceId && quote.subscriptionId === context.subscriptionId &&
      quote.planId === context.planId && quote.fromPlanId === context.fromPlanId &&
      Number.isSafeInteger(quote.amountCents) && quote.amountCents > 0 &&
      Number.isSafeInteger(quote.monthlyCents) && quote.monthlyCents > 0 &&
      typeof quote.currency === 'string' && /^[a-z]{3}$/.test(quote.currency) &&
      Number.isSafeInteger(quote.periodStart) && quote.periodStart > 0 &&
      Number.isSafeInteger(quote.quotedAt) && quote.quotedAt <= now &&
      quote.quotedAt >= now - 600 ? quote : null
  } catch {
    return null
  }
}
