import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../encryption", () => ({ decrypt: () => "access-token" }));
vi.mock("../meta-graph", () => ({
  withAppsecretProof: (url: string) => url,
}));
vi.mock("../admin-client", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("../meta-auth", () => ({
  clearMetaConnectionError: vi.fn(),
  handleMetaGraphError: vi.fn(),
  parseMetaErrorBody: vi.fn(),
}));

const { whatsappAdapter } = await import("./adapter");

describe("WhatsApp image-header templates", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the customer image before the body variables", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [{ id: "wamid.1" }],
          contacts: [{ wa_id: "573001234567" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await whatsappAdapter.sendTemplate!({
      channel: "whatsapp",
      connection: {
        id: "connection-1",
        status: "connected",
        config: { phone_number_id: "phone-1" },
        secrets: { access_token: "encrypted" },
      } as never,
      conversation: { id: "conversation-1" } as never,
      contact: { id: "contact-1", phone: "+573001234567" } as never,
      templateName: "rasmiaw_estado_transportadora_foto_v1",
      language: "es",
      params: ["Tu pedido está en tránsito."],
      headerImageUrl: "https://riverz.co/api/media/photo.jpg",
    });

    const init = request.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body));
    expect(payload.template.components).toEqual([
      {
        type: "header",
        parameters: [
          {
            type: "image",
            image: { link: "https://riverz.co/api/media/photo.jpg" },
          },
        ],
      },
      {
        type: "body",
        parameters: [{ type: "text", text: "Tu pedido está en tránsito." }],
      },
    ]);
  });
});
