import { RESEARCH_MODEL, RESEARCH_MAX_TOKENS } from './research'

/**
 * A model backend for enrichment: prompt in → reply text out. Decoupling this
 * lets enrichment run against (a) the Anthropic API in prod, or (b) any other
 * provider for testing — e.g. a Claude Code session answering the prompt by
 * hand (see fileSessionModel), so we can exercise the real pipeline without
 * spending API credits.
 */
export type ModelFn = (prompt: string) => Promise<string>

/** Default backend: the Anthropic Messages API (needs ANTHROPIC_API_KEY + balance). */
export const anthropicModel: ModelFn = async (prompt) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? `Anthropic ${res.status}`)
  return json?.content?.[0]?.text ?? ''
}
