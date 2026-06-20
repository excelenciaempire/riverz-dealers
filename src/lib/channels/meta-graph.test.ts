import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appsecretProof,
  withAppsecretProof,
  withAppsecretProofBody,
} from "./meta-graph";

// appsecret_proof = HMAC-SHA256 hex of the access token, keyed by the app
// secret. Meta requires it on every token-authenticated Graph call once the
// app owner flips on "Require App Secret"; these helpers attach it.

const SECRET = "test-app-secret";
const TOKEN = "EAAB-test-access-token";
const EXPECTED = crypto.createHmac("sha256", SECRET).update(TOKEN).digest("hex");

describe("appsecretProof", () => {
  const original = process.env.META_APP_SECRET;
  beforeEach(() => {
    process.env.META_APP_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = original;
  });

  it("computes the HMAC-SHA256 hex of the token keyed by the app secret", () => {
    expect(appsecretProof(TOKEN)).toBe(EXPECTED);
  });

  it("returns null when META_APP_SECRET is unset (degrades to no proof)", () => {
    delete process.env.META_APP_SECRET;
    expect(appsecretProof(TOKEN)).toBeNull();
  });

  it("returns null when no token is supplied", () => {
    expect(appsecretProof("")).toBeNull();
    expect(appsecretProof(undefined)).toBeNull();
    expect(appsecretProof(null)).toBeNull();
  });
});

describe("withAppsecretProof", () => {
  const original = process.env.META_APP_SECRET;
  beforeEach(() => {
    process.env.META_APP_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = original;
  });

  it("appends with & when the URL already has a query string", () => {
    const url = withAppsecretProof(
      `https://graph.facebook.com/v21.0/me?fields=id&access_token=${TOKEN}`,
      TOKEN,
    );
    expect(url).toContain(`&appsecret_proof=${EXPECTED}`);
  });

  it("appends with ? when the URL has no query string", () => {
    const url = withAppsecretProof(
      "https://graph.facebook.com/v21.0/123/messages",
      TOKEN,
    );
    expect(url).toBe(
      `https://graph.facebook.com/v21.0/123/messages?appsecret_proof=${EXPECTED}`,
    );
  });

  it("returns the URL unchanged when the proof can't be computed", () => {
    delete process.env.META_APP_SECRET;
    const url = "https://graph.facebook.com/v21.0/123/messages?access_token=x";
    expect(withAppsecretProof(url, TOKEN)).toBe(url);
  });
});

describe("withAppsecretProofBody", () => {
  const original = process.env.META_APP_SECRET;
  beforeEach(() => {
    process.env.META_APP_SECRET = SECRET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = original;
  });

  it("merges appsecret_proof into a body that carries access_token", () => {
    const body = withAppsecretProofBody(
      { message: "hi", access_token: TOKEN },
      TOKEN,
    );
    expect(body.appsecret_proof).toBe(EXPECTED);
    expect(body.message).toBe("hi");
    expect(body.access_token).toBe(TOKEN);
  });

  it("returns the body unchanged when the proof can't be computed", () => {
    delete process.env.META_APP_SECRET;
    const input = { message: "hi", access_token: TOKEN };
    expect(withAppsecretProofBody(input, TOKEN)).toBe(input);
  });
});
