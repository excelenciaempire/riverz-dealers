import { describe, expect, it } from 'vitest';
import {
  fairVoiceQueue,
  normalizeVoiceCapacity,
  voiceCallDedupeKey,
  voiceCallPriority,
} from './capacity';

describe('normalizeVoiceCapacity', () => {
  it('uses safe defaults for a workspace that never configured capacity', () => {
    expect(normalizeVoiceCapacity()).toEqual({
      maxConcurrentCalls: 3,
      reservedInboundSlots: 0,
      maxCampaignConcurrent: 1,
      dedupeMinutes: 15,
    });
  });

  it('clamps dependent limits to the workspace maximum', () => {
    expect(
      normalizeVoiceCapacity({
        max_concurrent_calls: 2,
        reserved_inbound_slots: 9,
        max_campaign_concurrent: 9,
        dedupe_minutes: 9999,
      })
    ).toEqual({
      maxConcurrentCalls: 2,
      reservedInboundSlots: 1,
      maxCampaignConcurrent: 2,
      dedupeMinutes: 1440,
    });
  });

  it('keeps the legacy dedupe window working', () => {
    expect(normalizeVoiceCapacity({ dedupe_hours: 12 }).dedupeMinutes).toBe(
      720
    );
  });
});

describe('voice queue policy', () => {
  it('keeps incoming and manual calls ahead of automations and campaigns', () => {
    expect(voiceCallPriority({ callType: 'inbound' })).toBe(500);
    expect(voiceCallPriority({ callType: 'manual' })).toBe(400);
    expect(
      voiceCallPriority({ callType: 'followup', automationId: 'automation-1' })
    ).toBe(300);
    expect(
      voiceCallPriority({
        callType: 'order_confirmation',
        automationId: 'automation-1',
        context: { campaign_id: 'campaign-1' },
      })
    ).toBe(100);
  });

  it('deduplicates automatic sources but never manual or test calls', () => {
    expect(
      voiceCallDedupeKey({
        contactId: 'contact-1',
        callType: 'followup',
        automationId: 'automation-1',
      })
    ).toBe('automation:automation-1:contact:contact-1:type:followup');
    expect(
      voiceCallDedupeKey({ contactId: 'contact-1', callType: 'manual' })
    ).toBeNull();
    expect(
      voiceCallDedupeKey({
        contactId: 'contact-1',
        callType: 'manual',
        context: { test_call: true },
      })
    ).toBeNull();
  });

  it('round-robins workspaces inside a priority band', () => {
    const rows = [
      {
        id: 'a1',
        workspace_id: 'a',
        dispatch_priority: 100,
        scheduled_at: '1',
      },
      {
        id: 'a2',
        workspace_id: 'a',
        dispatch_priority: 100,
        scheduled_at: '2',
      },
      {
        id: 'b1',
        workspace_id: 'b',
        dispatch_priority: 100,
        scheduled_at: '3',
      },
      {
        id: 'high',
        workspace_id: 'a',
        dispatch_priority: 400,
        scheduled_at: '4',
      },
    ];
    expect(fairVoiceQueue(rows).map((row) => row.id)).toEqual([
      'high',
      'a1',
      'b1',
      'a2',
    ]);
  });
});
