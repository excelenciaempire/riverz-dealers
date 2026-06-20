import { ImageResponse } from "next/og";

// iOS / Android home-screen icon (and a richer source for the web manifest).
// Same charcoal tile + lime "r" lettermark as src/app/icon.tsx, scaled to the
// 180×180 apple-touch-icon size. Full-bleed background (no manual rounding) so
// the OS applies its own squircle mask without leaving black corners.

export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
        }}
      >
        {/* viewBox is shared with the favicon so the mark stays identical;
            stroke width scales with it. */}
        <svg
          width="116"
          height="116"
          viewBox="0 0 32 32"
          fill="none"
          stroke="#f7ff9e"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11.5 7 V25" />
          <path d="M11.5 12.5 C13 8.8 16.5 7.6 21.5 8.6" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
