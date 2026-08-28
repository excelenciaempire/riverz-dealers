import { ImageResponse } from "next/og";

// Shared 1200×630 social share card — the image that shows when a riverz.co
// link is pasted into WhatsApp, Instagram, Messenger, Facebook, X, LinkedIn,
// Slack, iMessage, etc. Rendered once here and re-exported by both
// `opengraph-image.tsx` and `twitter-image.tsx` so the two stay identical.
//
// Editorial dark theme (charcoal #0a0a0a + lime #f7ff9e) matching the brand's
// dark mode and the favicon. Type is intentionally light-weight (Geist 400,
// the next/og default font) — the "expensive", restrained feel of the Riverz
// design system. El titular es el mismo de la portada —si la tarjeta promete
// otra cosa que la página, el clic llega desconfiado— y el subtítulo carga la
// diferencia: un chatbot termina cuando responde, Riverz no.

export const alt =
  "riverz — Toda tu operación comercial en un solo sistema agéntico";
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
            {/* Dos líneas: la tarjeta mide 630px y una tercera línea de
                titular empuja el subtítulo contra el pie. */}
            <span style={{ fontSize: 72, letterSpacing: -2.2 }}>Toda tu operación comercial.</span>
            <div style={{ display: "flex", fontSize: 72, letterSpacing: -2.2 }}>
              <span style={{ color: "#f7ff9e" }}>Un solo sistema agéntico.</span>
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
            Un chatbot termina cuando responde. Riverz crea el pedido en tu
            tienda, cobra y hace el seguimiento del envío.
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
          {/* Seis canales en una línea: 22px deja margen frente al dominio
              de la derecha en los 1032px útiles de la tarjeta. */}
          <span style={{ fontSize: 22, color: "rgba(250,250,247,0.5)" }}>
            WhatsApp · Instagram · Messenger · TikTok · Mercado Libre · Correo · Llamadas
          </span>
          <span style={{ fontSize: 26, color: "#f7ff9e" }}>riverz.co</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
