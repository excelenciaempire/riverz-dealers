import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyChannelWebhook, verifyShopifyWebhookSignature } from "./verify-webhook";

const META_SECRET = process.env.META_APP_SECRET!;

function metaSignedHeader(body: string, secret: string = META_SECRET): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

function makeRequest(opts: {
  url?: string;
  signature?: string | null;
  body?: string;
}): Request {
  const headers = new Headers();
  if (opts.signature) headers.set("x-hub-signature-256", opts.signature);
  return new Request(opts.url ?? "https://example.com/api/channels/whatsapp/webhook", {
    method: "POST",
    headers,
    body: opts.body ?? "",
  });
}

describe("verifyChannelWebhook — meta channels", () => {
  it("accepts a whatsapp delivery signed with the configured secret", async () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const req = makeRequest({ signature: metaSignedHeader(body), body });
    const result = await verifyChannelWebhook("whatsapp", req, body);
    expect(result.ok).toBe(true);
  });

  it("rejects a whatsapp delivery where the body was tampered after signing", async () => {
    const original = JSON.stringify({ entry: [] });
    const sig = metaSignedHeader(original);
    const tampered = JSON.stringify({ entry: [{ id: "injected" }] });
    const req = makeRequest({ signature: sig, body: tampered });
    const result = await verifyChannelWebhook("whatsapp", req, tampered);
    expect(result.ok).toBe(false);
    // The rejection reason is the machine code 'meta_hmac_mismatch'
    // (HMAC = the signature check), not the English word "signature".
    if (!result.ok) expect(result.reason).toMatch(/hmac|signature/i);
  });

  it("rejects when the signature header is missing", async () => {
    const body = "{}";
    const req = makeRequest({ signature: null, body });
    const result = await verifyChannelWebhook("messenger", req, body);
    expect(result.ok).toBe(false);
  });

  it("applies the same rule to every meta-family channel", async () => {
    const body = JSON.stringify({ entry: [] });
    const sig = metaSignedHeader(body);
    for (const ch of ["whatsapp", "messenger", "instagram", "fb_comment", "ig_comment"] as const) {
      const req = makeRequest({ signature: sig, body });
      const result = await verifyChannelWebhook(ch, req, body);
      expect(result.ok, `expected ${ch} to verify`).toBe(true);
    }
  });
});

describe("verifyChannelWebhook — gmail secret query", () => {
  const originalGmail = process.env.GMAIL_PUSH_SECRET;
  beforeEach(() => {
    process.env.GMAIL_PUSH_SECRET = "gmail-push-secret-token";
  });
  afterEach(() => {
    if (originalGmail === undefined) delete process.env.GMAIL_PUSH_SECRET;
    else process.env.GMAIL_PUSH_SECRET = originalGmail;
  });

  it("accepts when the secret query param matches", async () => {
    const req = makeRequest({
      url: "https://example.com/api/channels/gmail/webhook?secret=gmail-push-secret-token",
      body: "{}",
    });
    const result = await verifyChannelWebhook("gmail", req, "{}");
    expect(result.ok).toBe(true);
  });

  it("rejects when the secret query param is wrong", async () => {
    const req = makeRequest({
      url: "https://example.com/api/channels/gmail/webhook?secret=nope",
      body: "{}",
    });
    const result = await verifyChannelWebhook("gmail", req, "{}");
    expect(result.ok).toBe(false);
  });

  it("rejects when GMAIL_PUSH_SECRET is unset (fail-closed)", async () => {
    delete process.env.GMAIL_PUSH_SECRET;
    const req = makeRequest({
      url: "https://example.com/api/channels/gmail/webhook?secret=anything",
      body: "{}",
    });
    const result = await verifyChannelWebhook("gmail", req, "{}");
    expect(result.ok).toBe(false);
  });
});

describe("verifyChannelWebhook — outlook", () => {
  it("admits outlook traffic (per-event clientState check lives in the adapter)", async () => {
    const req = makeRequest({ body: "{}" });
    const result = await verifyChannelWebhook("outlook", req, "{}");
    expect(result.ok).toBe(true);
  });
});

describe("verifyShopifyWebhookSignature", () => {
  const SHOPIFY_SECRET = "shopify-test-secret";
  it("accepts a payload signed with the matching secret", () => {
    const body = JSON.stringify({ order: 1 });
    const sig = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body).digest("base64");
    expect(verifyShopifyWebhookSignature(body, sig, SHOPIFY_SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const original = JSON.stringify({ order: 1 });
    const sig = crypto.createHmac("sha256", SHOPIFY_SECRET).update(original).digest("base64");
    const tampered = JSON.stringify({ order: 999 });
    expect(verifyShopifyWebhookSignature(tampered, sig, SHOPIFY_SECRET)).toBe(false);
  });

  it("rejects when the secret is unset (fail-closed)", () => {
    expect(verifyShopifyWebhookSignature("{}", "anything", undefined)).toBe(false);
  });
});
