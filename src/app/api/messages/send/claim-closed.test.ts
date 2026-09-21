import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adapter: vi.fn(), tables: [] as string[] }));
const workspaceId = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/csrf", () => ({ csrfGuard: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
  }),
}));
vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => "es",
  safeLocale: async () => "es",
}));
vi.mock("@/lib/channels/registry", () => ({ getAdapter: mocks.adapter }));
vi.mock("@/lib/channels/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      mocks.tables.push(table);
      const rows: Record<string, unknown> = {
        conversations: {
          id: "conversation",
          workspace_id: workspaceId,
          contact_id: "contact",
          connection_id: "connection",
          channel: "mercadolibre",
          thread_external_id: "claim:5580377249",
          status: "open",
        },
        workspace_members: { id: "membership" },
        contacts: { id: "contact", workspace_id: workspaceId },
        channel_connections: {
          id: "connection",
          workspace_id: workspaceId,
          channel: "mercadolibre",
          status: "connected",
        },
        ml_claims: { status: "closed" },
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
      };
      return chain;
    },
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = [];
});

it("blocks a stale composer before sending to a closed Mercado Libre claim", async () => {
  const response = await POST(
    new Request("https://riverz.test/api/messages/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation_id: "conversation", text: "Ya se realizó" }),
    }),
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "ML_CLAIM_CLOSED" });
  expect(mocks.tables).toEqual([
    "conversations",
    "workspace_members",
    "contacts",
    "channel_connections",
    "ml_claims",
  ]);
  expect(mocks.adapter).not.toHaveBeenCalled();
});
