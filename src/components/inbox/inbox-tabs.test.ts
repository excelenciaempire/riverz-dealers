import { describe, expect, it } from "vitest";
import type { Channel } from "@/types";
import {
  channelBelongsToTab,
  visibleChannelsForTab,
} from "./inbox-tabs";

describe("Zoho en la bandeja", () => {
  it("clasifica Zoho como canal de mensajes", () => {
    expect(channelBelongsToTab("zoho", "messages")).toBe(true);
    expect(channelBelongsToTab("zoho", "comments")).toBe(false);
  });

  it("muestra su filtro únicamente cuando este usuario lo tiene conectado", () => {
    expect(visibleChannelsForTab("messages", new Set<Channel>())).not.toContain(
      "zoho",
    );
    expect(
      visibleChannelsForTab("messages", new Set<Channel>(["zoho"])),
    ).toContain("zoho");
  });
});
