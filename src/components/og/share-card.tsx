import { ImageResponse } from "next/og";

// Shared 1200×630 social share card — the image that shows when a riverz.co
// link is pasted into WhatsApp, Instagram, Messenger, Facebook, X, LinkedIn,
// Slack, iMessage, etc. Rendered once here and re-exported by both
// `opengraph-image.tsx` and `twitter-image.tsx` so the two stay identical.
//
// Editorial dark theme (charcoal #0a0a0a + lime #f7ff9e) matching the brand's
// dark mode and the favicon. Type is intentionally light-weight (Geist 400,
// the next/og default font) — the "expensive", restrained feel of the Riverz
// design system. Headline mirrors the landing hero ("Convierte cada chat en
// una venta.") so the share preview and the page tell the same story.

export const alt = "riverz — Agente de IA que vende por WhatsApp e Instagram";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function renderShareCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "76px 84px",
          background: "#0a0a0a",
          color: "#fafaf7",
        }}
      >
        {/* Soft lime glow, top-left. Painted first → sits behind the content. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            backgroundImage:
              "radial-gradient(900px 460px at 16% -10%, rgba(247,255,158,0.22), rgba(10,10,10,0))",
          }}
        />

        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span
            style={{
              fontSize: 40,
              letterSpacing: 2,
              color: "#f7ff9e",
            }}
          >
            riverz
          </span>
        </div>

        {/* Headline + subline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.03 }}>
            <span style={{ fontSize: 86, letterSpacing: -2.5 }}>Convierte cada chat</span>
            <div style={{ display: "flex", fontSize: 86, letterSpacing: -2.5 }}>
              <span style={{ marginRight: 22 }}>en una</span>
              <span style={{ color: "#f7ff9e" }}>venta.</span>
            </div>
          </div>
          <span
            style={{
              marginTop: 30,
              fontSize: 30,
              lineHeight: 1.35,
              color: "rgba(250,250,247,0.62)",
              maxWidth: 880,
            }}
          >
            El agente de IA que atiende, recomienda y cierra ventas por WhatsApp e
            Instagram. Recupera carritos y vende 24/7.
          </span>
        </div>

        {/* Footer: channels + domain */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 24, color: "rgba(250,250,247,0.5)" }}>
            WhatsApp · Instagram · Messenger · Correo
          </span>
          <span style={{ fontSize: 26, color: "#f7ff9e" }}>riverz.co</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
