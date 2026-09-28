import { getAnthropic } from '@/lib/ai/anthropic-client';
import { esfuerzo } from '@/lib/ai/esfuerzo';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import type { BillingContext } from '@/lib/wallet/operacion';
import { RESEARCH_MAX_TOKENS, RESEARCH_MODEL } from './research';
export type ModelFn = (prompt: string) => Promise<string>;
export const anthropicModel =
  (billing: BillingContext): ModelFn =>
  async (prompt) => {
    const key = await resolveAnthropicKey(billing.db, {
      workspaceId: billing.workspaceId,
    });
    if (!key) throw new Error('ai_not_configured');
    const response = await getAnthropic(key.key, {
      ...billing,
      origenDeLaClave: key.source,
    }).messages.create({
      model: RESEARCH_MODEL,
      max_tokens: RESEARCH_MAX_TOKENS,
      ...esfuerzo(RESEARCH_MODEL),
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  };
