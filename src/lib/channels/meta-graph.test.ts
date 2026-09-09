import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appsecretProof,
  appSubscriptionGaps,
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

// Mudar el servicio de hosting deja la suscripción app-level intacta y activa
// apuntando al dominio viejo: Meta entrega a un host muerto y la bandeja deja
// de recibir sin un solo error. Pasó el 2026-07-29 con los comentarios de IG.
describe("appSubscriptionGaps", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://riverz.co";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  const healthy = () => ({
    instagram: {
      // `messaging_optins` = la aceptacion de Marketing Messages. Sin ese
      // campo la lista de suscriptores deja de crecer en silencio, asi que
      // cuenta como hueco igual que los otros dos.
      active: true,
      fields: ["comments", "messages", "messaging_optins"],
      callbackUrl: "https://riverz.co/api/channels/instagram/webhook",
    },
    page: {
      active: true,
      fields: ["feed", "messages"],
      callbackUrl: "https://riverz.co/api/channels/fb_comment/webhook",
    },
    whatsapp_business_account: {
      active: true,
      fields: [
        "messages",
        "smb_message_echoes",
        "message_template_status_update",
        "message_template_quality_update",
      ],
      callbackUrl: "https://riverz.co/api/channels/whatsapp/webhook",
    },
  });

  it("no reporta huecos cuando todo apunta al dominio actual", () => {
    expect(appSubscriptionGaps(healthy())).toEqual([]);
  });

  it("detecta el callback apuntando a otro host y propone el mismo path", () => {
    const subs = healthy();
    subs.instagram.callbackUrl =
      "https://unified-inbox-7yp9.onrender.com/api/channels/instagram/webhook";
    const gaps = appSubscriptionGaps(subs);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].object).toBe("instagram");
    expect(gaps[0].wrongCallback).toBe(true);
    expect(gaps[0].missing).toEqual([]);
    expect(gaps[0].expectedCallbackUrl).toBe(
      "https://riverz.co/api/channels/instagram/webhook",
    );
  });

  it("sigue reportando campos faltantes", () => {
    const subs = healthy();
    subs.instagram.fields = ["messages", "messaging_optins"];
    const gaps = appSubscriptionGaps(subs);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missing).toEqual(["comments"]);
    expect(gaps[0].wrongCallback).toBe(false);
  });

  it("reporta el opt-in de marketing cuando falta", () => {
    // Es el hueco mas facil de no ver: los DMs y los comentarios siguen
    // llegando, y lo unico que pasa es que nadie se suscribe nunca.
    const subs = healthy();
    subs.instagram.fields = ["comments", "messages"];
    const gaps = appSubscriptionGaps(subs);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missing).toEqual(["messaging_optins"]);
  });

  it("reporta los eventos de plantillas de WhatsApp cuando faltan", () => {
    const subs = healthy();
    subs.whatsapp_business_account.fields = ["messages", "smb_message_echoes"];
    const gaps = appSubscriptionGaps(subs);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].missing).toEqual([
      "message_template_status_update",
      "message_template_quality_update",
    ]);
  });
});
