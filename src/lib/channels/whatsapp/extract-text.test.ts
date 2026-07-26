import { describe, expect, it } from "vitest";
import { extractText, type WhatsAppMessage } from "./adapter";

const msg = (m: Partial<WhatsAppMessage> & { type: string }) => m as WhatsAppMessage;

describe("extractText", () => {
  it("muestra el texto tal cual", () => {
    expect(extractText(msg({ type: "text", text: { body: "¿Precio?" } }))).toBe("¿Precio?");
  });

  it("usa el pie de la imagen y cae al marcador cuando no hay", () => {
    expect(extractText(msg({ type: "image", image: { id: "1", caption: "mirá" } }))).toBe("mirá");
    expect(extractText(msg({ type: "image", image: { id: "1", caption: "" } }))).toBe("[Imagen]");
  });

  it("arma la ubicación con nombre y enlace al mapa", () => {
    expect(
      extractText(
        msg({
          type: "location",
          location: { name: "Local Centro", address: "Av. 1", latitude: -34.6, longitude: -58.4 },
        }),
      ),
    ).toBe("Local Centro · Av. 1\nhttps://maps.google.com/?q=-34.6,-58.4");
  });

  it("muestra la tarjeta de contacto compartida", () => {
    expect(
      extractText(
        msg({
          type: "contacts",
          contacts: [
            { name: { formatted_name: "Ana Pérez" }, phones: [{ phone: "+5491122334455" }] },
          ],
        }),
      ),
    ).toBe("Ana Pérez · +5491122334455");
  });

  it("detalla el pedido armado desde el catálogo", () => {
    expect(
      extractText(
        msg({
          type: "order",
          order: {
            text: "mandámelo mañana",
            product_items: [
              { product_retailer_id: "SERUM-30", quantity: 2, item_price: 15000, currency: "ARS" },
            ],
          },
        }),
      ),
    ).toBe("[Pedido]\n2× SERUM-30 15000 ARS\nmandámelo mañana");
  });

  it("muestra el botón que tocó la persona", () => {
    expect(extractText(msg({ type: "button", button: { text: "Sí, quiero" } }))).toBe("Sí, quiero");
  });

  it("muestra los campos que completó en un Flow", () => {
    expect(
      extractText(
        msg({
          type: "interactive",
          interactive: {
            type: "nfm_reply",
            nfm_reply: {
              response_json: '{"flow_token":"x","talle":"M","color":"negro"}',
            },
          },
        }),
      ),
    ).toBe("talle: M\ncolor: negro");
  });

  it("marca como no compatible un tipo que no sabemos leer", () => {
    expect(extractText(msg({ type: "some_new_type" }))).toBe(
      "[unsupported message type: some_new_type]",
    );
  });
});
