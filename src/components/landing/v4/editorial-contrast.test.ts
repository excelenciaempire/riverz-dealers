import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./editorial.css", import.meta.url), "utf8");
const color = (name: string) => {
  const hex = css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1];
  if (!hex) throw new Error(`Missing palette token: ${name}`);
  return hex;
};
const luminance = (hex: string) => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

describe("editorial secondary text", () => {
  it.each(["sn-paper", "sn-card", "sn-sand", "sn-sand-2"])("keeps readable contrast on %s", (surface) => {
    const contrast = (luminance(color(surface)) + 0.05) / (luminance(color("sn-muted")) + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(7);
  });
  it("uses the same gray inside embedded panels", () => {
    expect(css).toContain("--muted-foreground: var(--sn-muted);");
    expect(luminance(color("sn-muted"))).toBeGreaterThan(luminance(color("sn-ink-2")));
  });
});
