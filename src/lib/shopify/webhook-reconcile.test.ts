import { afterEach, describe, expect, it, vi } from "vitest";
import { ShopifyAdminClient, SHOPIFY_WEBHOOK_TOPICS } from "./admin-client";

const SHOP = "demo.myshopify.com";
const NEW = "https://riverz.co";
const OLD = "https://unified-inbox-7yp9.onrender.com";

interface Call {
  method: string;
  url: string;
  body?: { webhook?: { topic?: string; address?: string } };
}

/** Shopify de mentira: devuelve la lista dada y anota lo que se le hace. */
function fakeShopify(webhooks: Array<{ id: number; topic: string; address: string }>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return {
        ok: true,
        status: 200,
        json: async () => (method === "GET" ? { webhooks } : {}),
      } as unknown as Response;
    }),
  );
  return calls;
}

const client = () => new ShopifyAdminClient(SHOP, "token", "2024-10");

describe("ShopifyAdminClient.reconcileWebhooks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // El caso real: la mudanza de dominio dejó los viejos vivos junto a los
  // nuevos, entregando cada pedido a un servidor que devuelve 503.
  //
  // Los conteos salen de SHOPIFY_WEBHOOK_TOPICS y no de un número escrito a
  // mano: agregar un tema (pasó con los borradores) no puede romper un test
  // que mide otra cosa.
  it("borra los que apuntan al dominio viejo y conserva los del actual", async () => {
    const live = SHOPIFY_WEBHOOK_TOPICS.flatMap((t, i) => [
      { id: 100 + i, topic: t.topic, address: `${OLD}${t.path}` },
      { id: 200 + i, topic: t.topic, address: `${NEW}${t.path}` },
    ]);
    const calls = fakeShopify(live);

    const r = await client().reconcileWebhooks(NEW);

    expect(r.deleted).toBe(SHOPIFY_WEBHOOK_TOPICS.length);
    expect(r.kept).toBe(SHOPIFY_WEBHOOK_TOPICS.length);
    expect(r.created).toBe(0);
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(SHOPIFY_WEBHOOK_TOPICS.length);
    expect(deletes.every((c) => /\/webhooks\/10\d\.json$/.test(c.url))).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("re-registra los que faltan tras borrar los desviados", async () => {
    const calls = fakeShopify([
      { id: 1, topic: "orders/create", address: `${OLD}/api/shopify/webhooks/orders` },
    ]);

    const r = await client().reconcileWebhooks(NEW);

    expect(r.deleted).toBe(1);
    expect(r.created).toBe(SHOPIFY_WEBHOOK_TOPICS.length);
    const posted = calls
      .filter((c) => c.method === "POST")
      .map((c) => c.body?.webhook?.address);
    expect(posted.every((a) => a?.startsWith(NEW))).toBe(true);
  });

  // Una tienda puede tener otras aplicaciones instaladas; sus webhooks no son
  // nuestros para borrarlos por más que apunten a otro dominio.
  it("no toca los webhooks de otra aplicación", async () => {
    const live = [
      ...SHOPIFY_WEBHOOK_TOPICS.map((t, i) => ({
        id: 200 + i,
        topic: t.topic,
        address: `${NEW}${t.path}`,
      })),
      { id: 999, topic: "orders/create", address: "https://otra-app.com/hook" },
    ];
    const calls = fakeShopify(live);

    const r = await client().reconcileWebhooks(NEW);

    expect(r.deleted).toBe(0);
    expect(r.created).toBe(0);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
