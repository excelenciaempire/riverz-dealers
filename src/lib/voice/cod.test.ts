import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceCall } from '@/types';
import { maybeCodWriteback } from './cod';

it.each(['confirmed', 'cancelled_by_customer', 'recovered'] as const)(
  'does not touch logistics for a data-review call with outcome %s', async (outcome) => {
    const from = vi.fn();
    await maybeCodWriteback({ from } as unknown as SupabaseClient,
      { context: { cod_writeback: false } } as unknown as VoiceCall, outcome);
    expect(from).not.toHaveBeenCalled();
  },
);
