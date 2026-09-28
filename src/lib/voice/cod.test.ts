import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceCall } from '@/types';
import { maybeCodWriteback } from './cod';
import { DEUNA_DROPI_WORKSPACE } from '@/lib/logistics/dropi-release-policy';

it.each(['confirmed', 'recovered'] as const)('never duplicates a DeUna order after %s', async outcome => {
  const from = vi.fn();
  await maybeCodWriteback({ from } as unknown as SupabaseClient,
    { workspace_id: DEUNA_DROPI_WORKSPACE, context: {} } as unknown as VoiceCall, outcome);
  expect(from).not.toHaveBeenCalled();
});

it.each(['confirmed', 'cancelled_by_customer', 'recovered'] as const)(
  'does not touch logistics for a data-review call with outcome %s', async (outcome) => {
    const from = vi.fn();
    await maybeCodWriteback({ from } as unknown as SupabaseClient,
      { context: { cod_writeback: false } } as unknown as VoiceCall, outcome);
    expect(from).not.toHaveBeenCalled();
  },
);
