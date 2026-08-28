import { describe, it, expect } from "vitest";
import { canalPermiteEditar, puedeEditarse } from "./editable";
import { CHANNELS, type Channel, type Message } from "@/types";

function mensaje(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    channel: "webchat",
    sender_type: "agent",
    content_type: "text",
    content_text: "Hola",
    status: "sent",
    created_at: new Date().toISOString(),
    ...over,
  } as Message;
}

describe("canalPermiteEditar", () => {
  it("sólo el chat web y el comentario de Facebook", () => {
    const editables = CHANNELS.filter((c: Channel) => canalPermiteEditar(c));
    expect(editables.sort()).toEqual(["fb_comment", "webchat"]);
  });
});

describe("puedeEditarse", () => {
  it("acepta lo que escribió el comercio en un canal editable", () => {
    expect(puedeEditarse(mensaje())).toBe(true);
    expect(puedeEditarse(mensaje({ channel: "fb_comment", message_id: "123_456" }))).toBe(
      true,
    );
    expect(puedeEditarse(mensaje({ sender_type: "bot" }))).toBe(true);
  });

  it("no toca lo que escribió el cliente", () => {
    expect(puedeEditarse(mensaje({ sender_type: "customer" }))).toBe(false);
  });

  it("no ofrece editar lo que nunca llegó", () => {
    expect(puedeEditarse(mensaje({ status: "failed" }))).toBe(false);
  });

  it("no ofrece editar un mensaje sin texto (sólo un archivo)", () => {
    expect(puedeEditarse(mensaje({ content_text: "   " }))).toBe(false);
  });

  it("en WhatsApp y compañía no hay edición posible", () => {
    for (const channel of ["whatsapp", "instagram", "messenger", "gmail", "ig_comment"] as Channel[]) {
      expect(puedeEditarse(mensaje({ channel }))).toBe(false);
    }
  });
});

describe("puedeEditarse — el lápiz no puede prometer lo que la API no hace", () => {
  it("un comentario de Facebook sin id externo no se edita", () => {
    // Se edita POR id de comentario: sin él, guardar devolvería 409.
    expect(puedeEditarse(mensaje({ channel: "fb_comment", message_id: undefined }))).toBe(
      false,
    );
    expect(puedeEditarse(mensaje({ channel: "fb_comment", message_id: "123_456" }))).toBe(
      true,
    );
  });

  it("el chat web no necesita id externo", () => {
    expect(puedeEditarse(mensaje({ channel: "webchat", message_id: undefined }))).toBe(true);
  });

  it("un comentario borrado (queda como fallido) no se edita", () => {
    expect(
      puedeEditarse(
        mensaje({ channel: "fb_comment", message_id: "123_456", status: "failed" }),
      ),
    ).toBe(false);
  });
});
