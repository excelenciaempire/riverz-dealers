import { describe, it, expect } from "vitest";
import { detectAutomatedSender } from "./automated-sender";

/**
 * Los casos reales del incidente del 20 de agosto de 2026 (549 correos a
 * `postmaster@outlook.com` hasta que Microsoft bloqueó la casilla) están abajo
 * uno por uno. Si alguno vuelve a dar `automated: false`, el bucle vuelve.
 */
describe("detectAutomatedSender — el incidente", () => {
  it("el boletín de TikTok que arrancó todo", () => {
    const v = detectAutomatedSender({
      from: "TikTok For Business <noreply-tt4b@notifications.tiktok.com>",
      subject:
        "¡Nuevo! Notificaciones por correo electrónico con las mejores prácticas de TikTok ya disponibles",
    });
    expect(v.automated).toBe(true);
  });

  it("el rebote de Outlook", () => {
    const v = detectAutomatedSender({
      from: "postmaster@outlook.com",
      subject:
        "No se puede entregar: RE: ¡Nuevo! Notificaciones por correo electrónico",
    });
    expect(v.automated).toBe(true);
  });

  it("el automático de postmaster ('this address is not monitored')", () => {
    const v = detectAutomatedSender({
      from: "postmaster@outlook.com",
      subject: "RE: ?Nuevo! Notificaciones por correo electr?nico",
      headers: [{ name: "Auto-Submitted", value: "auto-replied" }],
    });
    expect(v.automated).toBe(true);
    expect(v.reason).toBe("auto-submitted");
  });

  it("el noreply con identificador pegado atrás", () => {
    expect(
      detectAutomatedSender({
        from: "no-reply-279i5hduqkb732kh9iscsq@mail.anthropic.com",
      }).automated,
    ).toBe(true);
  });
});

describe("detectAutomatedSender — cabeceras", () => {
  it("Auto-Submitted: no NO es automático (RFC 3834)", () => {
    expect(
      detectAutomatedSender({
        from: "ana@gmail.com",
        subject: "Hola",
        headers: [{ name: "Auto-Submitted", value: "no" }],
      }).automated,
    ).toBe(false);
  });

  it("X-Auto-Response-Suppress", () => {
    const v = detectAutomatedSender({
      from: "member_services@outlook.com",
      subject: "Outlook.com has blocked your message",
      headers: [{ name: "X-Auto-Response-Suppress", value: "All" }],
    });
    expect(v.reason).toBe("auto-response-suppress");
  });

  it("Precedence: bulk", () => {
    expect(
      detectAutomatedSender({
        from: "hola@marca.com",
        headers: [{ name: "Precedence", value: "bulk" }],
      }).reason,
    ).toBe("precedence-bulk");
  });

  it("List-Unsubscribe (boletín)", () => {
    expect(
      detectAutomatedSender({
        from: "heatmap@mail.beehiiv.com",
        subject: "#116: 5 Q4 Fixes You Can Still Ship",
        headers: [{ name: "List-Unsubscribe", value: "<https://x/u>" }],
      }).reason,
    ).toBe("mailing-list");
  });

  it("informe de entrega (multipart/report)", () => {
    expect(
      detectAutomatedSender({
        from: "alguien@empresa.com",
        headers: [
          {
            name: "Content-Type",
            value: 'multipart/report; report-type=delivery-status; boundary="x"',
          },
        ],
      }).reason,
    ).toBe("delivery-report");
  });

  it("Return-Path vacío", () => {
    expect(
      detectAutomatedSender({
        from: "alguien@empresa.com",
        headers: [{ name: "Return-Path", value: "<>" }],
      }).reason,
    ).toBe("null-return-path");
  });

  it("el nombre de la cabecera no distingue mayúsculas", () => {
    expect(
      detectAutomatedSender({
        from: "x@y.com",
        headers: [{ name: "auto-submitted", value: "auto-generated" }],
      }).automated,
    ).toBe(true);
  });
});

describe("detectAutomatedSender — asunto", () => {
  it.each([
    "Undeliverable: Re: pedido",
    "Automatic reply: Estoy de vacaciones",
    "Respuesta automática: fuera de la oficina",
    "Out of office",
    "Mail delivery failed: returning message to sender",
    "Delivery Status Notification (Failure)",
  ])("%s", (subject) => {
    expect(detectAutomatedSender({ from: "ana@gmail.com", subject }).automated).toBe(
      true,
    );
  });

  it("atraviesa los RE:/FW: encadenados", () => {
    expect(
      detectAutomatedSender({
        from: "ana@gmail.com",
        subject: "RE: FW: Undeliverable: pedido #52584",
      }).automated,
    ).toBe(true);
  });
});

describe("detectAutomatedSender — clientes de verdad", () => {
  it.each([
    ["silviamladineo@gmail.com", "Re: El envío del pedido #52557 está en camino"],
    ["gladisgalarraga@gmail.com", "Re: Confirmación de pedido #52584"],
    ["norberto.reyes@hotmail.com", "consulta"],
    ["maria@empresa.com.ar", "no se puede entregar en mi barrio?"],
    ["bounce.hunter@gmail.com", "Hola"],
    ["notify.me.later@gmail.com", "Quiero comprar"],
  ])("%s no es automático", (from, subject) => {
    expect(detectAutomatedSender({ from, subject }).automated).toBe(false);
  });

  it("sin datos no inventa", () => {
    expect(detectAutomatedSender({}).automated).toBe(false);
  });
});
