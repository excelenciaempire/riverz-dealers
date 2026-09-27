import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  workspaceNames: vi.fn(),
}));

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock('./queries', () => ({ workspaceNames: mocks.workspaceNames }));

import { listConversations } from './conversations';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspaceNames.mockResolvedValue(new Map([['workspace-1', 'Commerce']]));
});

it('reads the current conversation columns and derives the human handoff flag', async () => {
  let conversationColumns = '';
  const conversations = {
    select: vi.fn((columns: string) => {
      conversationColumns = columns;
      return conversations;
    }),
    order: vi.fn(() => conversations),
    range: vi.fn(async () => ({
      data: [{
        id: 'conversation-1',
        workspace_id: 'workspace-1',
        channel: 'whatsapp',
        status: 'pending',
        ai_enabled: false,
        assigned_agent_id: 'agent-1',
        needs_human_reason: 'flow_handoff',
        created_at: '2026-09-27T00:00:00.000Z',
        last_message_at: '2026-09-27T01:00:00.000Z',
      }],
      count: 1,
      error: null,
    })),
  };
  const messages = {
    select: vi.fn(() => messages),
    in: vi.fn(() => messages),
    limit: vi.fn(async () => ({
      data: [{ conversation_id: 'conversation-1' }],
      error: null,
    })),
  };
  mocks.from.mockImplementation((table: string) =>
    table === 'conversations' ? conversations : messages,
  );

  const result = await listConversations({ limit: 20 });

  expect(conversationColumns).toContain('assigned_agent_id');
  expect(conversationColumns).toContain('needs_human_reason');
  expect(conversationColumns).not.toContain('assigned_to');
  expect(result).toEqual({
    total: 1,
    rows: [expect.objectContaining({
      workspace_name: 'Commerce',
      assigned_agent_id: 'agent-1',
      needs_human: true,
      messages_count: 1,
    })],
  });
});
