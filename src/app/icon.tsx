import { ImageResponse } from "next/og";

// Brand favicon — the riverz signature: a charcoal tile with the lowercase
// lime "r" lettermark, derived from the "riverz" wordmark used in the
// sidebar (`text-sidebar-primary`) and the landing header (`text-accent-ink`).
//
// Charcoal-on-lime (not lime-on-charcoal) was chosen on purpose: a dark tile
// reads on ANY browser chrome (it always contrasts), while the bright lime
// "r" carries the brand and stays legible down to 16px. The mark is drawn as
// SVG strokes so it's weight-perfect and crisp at every size — no font needed.
//
// Tokens mirror src/app/globals.css: --primary #f7ff9e, dark surface #0a0a0a.
// This route takes precedence over any app/favicon.ico on disk.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          stroke="#f7ff9e"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* stem */}
          <path d="M11.5 7 V25" />
          {/* shoulder / arm */}
          <path d="M11.5 12.5 C13 8.8 16.5 7.6 21.5 8.6" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
