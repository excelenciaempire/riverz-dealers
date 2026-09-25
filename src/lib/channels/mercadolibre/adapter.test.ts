import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelConnection } from "@/types";

let row: { secrets: Record<string, unknown>; config: Record<string, unknown> };
const updates: Array<Record<string, unknown>> = [];
vi.mock("../admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));

import { encrypt } from "../encryption";
import { claimAttachmentName, getFreshMLToken } from "./adapter";

describe("claimAttachmentName", () => {
  it("accepts the current file_name response from Mercado Libre", () => {
    expect(claimAttachmentName({ file_name: "seller_proof.jpg", user_id: 12 })).toBe(
      "seller_proof.jpg",
    );
  });

  it("keeps compatibility with filename and id responses", () => {
    expect(claimAttachmentName({ filename: "proof.png" })).toBe("proof.png");
    expect(claimAttachmentName({ id: "legacy-id" })).toBe("legacy-id");
  });

  it("rejects empty or malformed responses", () => {
    expect(claimAttachmentName({ file_name: "  " })).toBeUndefined();
    expect(claimAttachmentName(null)).toBeUndefined();
  });
});

describe("getFreshMLToken", () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ access_token: "new-token", refresh_token: "rotated", expires_in: 21600 })),
  );

  beforeEach(() => {
    updates.length = 0;
    vi.stubEnv("MERCADOLIBRE_CLIENT_ID", "111");
    vi.stubEnv("MERCADOLIBRE_CLIENT_SECRET", "riverz-secret");
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_ID", "222");
    vi.stubEnv("MERCADOLIBRE_LEGACY_CLIENT_SECRET", "legacy-secret");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function refresh(config: Record<string, unknown>) {
    row = {
      secrets: { access_token: encrypt("expired"), refresh_token: encrypt("refresh") },
      config: { seller_id: "42", token_expires_at: "2020-01-01T00:00:00Z", ...config },
    };
    const token = await getFreshMLToken({ id: "conn-1", ...row } as unknown as ChannelConnection);
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    return { token, clientId: body.get("client_id"), secret: body.get("client_secret") };
  }

  it("refreshes with the app that authorized the connection", async () => {
    const { token, clientId, secret } = await refresh({ app_id: "111" });
    expect(token).toBe("new-token");
    expect([clientId, secret]).toEqual(["111", "riverz-secret"]);
  });

  it("keeps connections from the previous app alive and records their app", async () => {
    const { clientId, secret } = await refresh({});
    expect([clientId, secret]).toEqual(["222", "legacy-secret"]);
    expect(updates[0].config).toMatchObject({ seller_id: "42", app_id: "222" });
  });
});
