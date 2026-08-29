import type { NextConfig } from "next";
import { ROUTE_SLUGS_EN, ROUTE_ALIASES } from "./src/lib/i18n/routes";
import { ADMIN_SLUGS_RETIRADOS } from "./src/app/admin/sections-list";

/**
 * Baseline security headers applied to every response.
 *
 * The Content-Security-Policy itself lives in src/proxy.ts: it carries
 * a per-request nonce so Next.js can stamp it onto the framework
 * scripts, and a static header here cannot do that. Everything else is
 * static and safe to enforce uniformly — including responses that
 * bypass the proxy (e.g. static assets, opted-out API routes).
 *
 *   - HSTS: only meaningful on HTTPS (no-op on http://localhost).
 *   - X-Content-Type-Options / X-Frame-Options / Referrer-Policy:
 *     baseline OWASP hardening, no behavioural cost.
 *   - Permissions-Policy: we don't use camera / microphone / geolocation,
 *     so deny them. A supply-chain compromise or a forgotten plugin
 *     can't silently opt back in.
 */
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Denegamos features sensibles que la app no usa, para que un script
    // comprometido o un plugin olvidado no pueda activarlas en silencio.
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
  },
  // COOP aísla nuestro browsing context (XS-Leaks / window.opener hijacking).
  // `allow-popups` para no romper el popup de FB.login (Embedded Signup),
  // que usa window.opener/postMessage. CORP same-origin evita que terceros
  // embeban nuestros recursos. NO seteamos COEP (require-corp) porque
  // rompería el SDK de Facebook e imágenes de CDNs externos.
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin-allow-popups",
  },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
] as const;

/**
 * CORP va aparte del bloque de arriba porque tiene una excepción.
 *
 * `same-origin` es lo correcto para todo Riverz: evita que un tercero embeba
 * nuestros recursos. Pero el cargador del chat web existe justamente para que
 * lo pida OTRO sitio — la tienda del comercio — y con `same-origin` el
 * navegador lo descarta sin decir por qué.
 *
 * Se resuelve excluyéndolo del catch-all y dándole su propio valor, y no
 * sobrescribiendo: Next.js suma las cabeceras de cada regla que matchea, así
 * que un segundo CORP no reemplaza al primero, deja dos — y dos CORP es una
 * cabecera inválida, que bloquea igual. Mismo criterio que X-Frame-Options
 * con /shopify/embedded, más abajo.
 */
const CORP_SAME_ORIGIN_EXCEPT_WIDGET = {
  source: "/((?!widget/v1.js).*)",
  headers: [{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }],
};

/**
 * Localized URLs.
 *
 * The English first-segment slugs (see src/lib/i18n/routes.ts) are REWRITES,
 * not redirects: they serve the canonical Spanish folder while keeping the
 * English URL in the address bar, so an English-locale user actually sees
 * /inbox, /dashboard, … The Spanish slugs ARE the canonical folders, so they
 * serve directly. Both forms resolve → no link can 404.
 *
 * `LOCALIZED_REWRITES` is generated from the slug map: for each canonical
 * folder we mask its English alias (and everything under it).
 */
const LOCALIZED_REWRITES = [
  ...Object.entries(ROUTE_SLUGS_EN).map(
    ([canonical, en]) => [en, canonical] as const,
  ),
  // Los alias viejos sirven la misma página que el slug actual: un enlace ya
  // repartido no deja de funcionar porque el slug haya cambiado.
  ...Object.entries(ROUTE_ALIASES),
].flatMap(([alias, canonical]) => [
  { source: `/${alias}`, destination: `/${canonical}` },
  { source: `/${alias}/:path*`, destination: `/${canonical}/:path*` },
]);

/**
 * Legacy 301s for FULLY-English deep paths that the app no longer generates
 * (it emits the Spanish deep segment, e.g. /broadcasts/nueva, and lets the
 * rewrite carry it through). These only catch old bookmarks/emails and never
 * collide with a localized URL the app produces. Redirects run before
 * rewrites, so they win for these exact legacy paths.
 */
const LEGACY_REDIRECTS: { from: string; to: string }[] = [
  { from: "/broadcasts/new", to: "/campanas/nueva" },
  { from: "/templates/new", to: "/plantillas/nueva" },
  { from: "/flows/:id/runs", to: "/menus/:id/usos" },
  { from: "/menus/:id/runs", to: "/menus/:id/usos" },
  { from: "/automations/new", to: "/automatizaciones/nueva" },
  { from: "/automations/:id/edit", to: "/automatizaciones/:id/editar" },
  { from: "/automations/:id/logs", to: "/automatizaciones/:id/registros" },
  // Las campañas de voz vivían bajo /campanas, donde las gobernaba la bandera
  // de campañas y el guard que exige WhatsApp conectado. Un enlace guardado a
  // la ruta vieja daba 404.
  { from: "/campanas/voz", to: "/voz/campanas" },
  { from: "/broadcasts/voz", to: "/voz/campanas" },
  // Las secciones retiradas del panel salen de una sola lista, la misma que usa
  // el reescritor del subdominio (`src/lib/admin/host.ts`). Escribirlas dos
  // veces terminaría con `riverz.co/admin/saldos` redirigiendo y
  // `admin.riverz.co/saldos` cayendo en el índice, que es como estaba.
  ...Object.entries(ADMIN_SLUGS_RETIRADOS).map(([viejo, nuevo]) => ({
    from: `/admin/${viejo}`,
    to: `/admin/${nuevo}`,
  })),
];

const nextConfig: NextConfig = {
  /**
   * El indicador de desarrollo, apagado.
   *
   * Se dibuja abajo a la izquierda de CADA documento, y el chat web es un
   * iframe de 400×640: ahí adentro el globo rojo cae justo encima del campo
   * donde se escribe, así que probar el widget en desarrollo era imposible sin
   * cerrarlo a mano en cada recarga.
   *
   * No se pierde nada: los errores de compilación y de ejecución se siguen
   * mostrando igual —en la terminal y en el overlay de error—; lo único que se
   * va es el globo que los cuenta. Y en producción nunca existió.
   */
  devIndicators: false,

  // @sentry/node usa APIs nativas de Node (node:diagnostics_channel,
  // OpenTelemetry async hooks) que el bundler no puede empaquetar. Lo
  // dejamos como `require` nativo en el server en vez de bundlearlo —
  // de lo contrario el build de Turbopack falla con "the chunking context
  // does not support external modules".
  serverExternalPackages: ["@sentry/node"],

  /**
   * Que volver a una sección no cueste otro viaje al servidor.
   *
   * Todo el dashboard es dinámico (`force-dynamic` en su layout, por el nonce
   * del CSP), y para una ruta dinámica Next no guarda NADA en la caché del
   * router: cada clic en el menú vuelve a pedirle el segmento al servidor,
   * incluso yendo y viniendo entre las dos mismas secciones. Con esto, volver
   * antes de 30 s es instantáneo.
   *
   * No hay riesgo de ver datos viejos: las pantallas son componentes de
   * cliente que piden sus datos al montarse, así que lo que se reutiliza es la
   * cáscara, no las cifras.
   */
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },

  async redirects() {
    return LEGACY_REDIRECTS.map(({ from, to }) => ({
      source: from,
      destination: to,
      permanent: true,
    }));
  },

  // English URL aliases → canonical Spanish folders (masked, URL stays
  // English). afterFiles so a real page always wins first; the aliases never
  // match a real folder (all folders are Spanish), so this only fires for the
  // English slugs. See src/lib/i18n/routes.ts.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: LOCALIZED_REWRITES,
      fallback: [],
    };
  },

  /**
   * Cache-Control policy.
   *
   * Why this exists:
   *   Hostinger's CDN was applying `s-maxage=31536000` (1 year) to
   *   prerendered HTML pages by default. When a new deploy shipped
   *   fresh Turbopack chunk hashes, the edge kept serving year-old
   *   HTML referencing chunk filenames that no longer existed on
   *   disk — result: HTML 200, every /_next/static/*.js and .css
   *   came back 404, the page rendered unstyled. Private/incognito
   *   did nothing because the cache is server-side.
   *
   * Strategy:
   *   - /_next/static/* — immutable for a year. Filenames are
   *     content-hashed, so a new build produces new filenames; the
   *     old ones are safe to keep indefinitely in caches.
   *   - /api/*          — no-store. API responses are per-user and
   *     must never be shared across requests at the edge.
   *   - Everything else — public, brief s-maxage + generous
   *     stale-while-revalidate. The edge serves instantly from cache
   *     for the first 5 min, then returns cached content while
   *     refreshing in the background for up to 24 h. A deploy's
   *     chunk-hash drift self-heals within ~5 min with no user-
   *     visible latency.
   *
   *   Note: dynamic dashboard routes (/inbox, /contacts, /pipelines,
   *   /broadcasts, etc.) are server-rendered per request — Next.js
   *   and Supabase auth already prevent them from being served
   *   from a shared cache. The s-maxage here is a ceiling; Next.js
   *   and auth middleware still set `private` / `no-store` for
   *   per-user responses.
   *
   * Security headers are appended via a separate catch-all rule
   * below — Next.js merges headers from every matching rule, so
   * they apply to every response regardless of which cache rule
   * matched.
   *
   * EL ORDEN IMPORTA, y al revés de lo que parece. Cuando dos reglas
   * matchean la misma ruta y traen la misma clave, gana la ÚLTIMA — no la
   * más específica. Medido en producción el 2026-08-20: con `/api/:path*`
   * (no-store) declarada ANTES del catch-all, la respuesta de una ruta de
   * API salía con `public, s-maxage=300`. O sea: todas las respuestas de
   * API, incluidas las que devuelven un token de sesión, se anunciaban como
   * cacheables por cualquier intermediario compartido.
   *
   * Por eso lo general va primero y las excepciones al final: sólo así una
   * excepción es una excepción.
   */
  async headers() {
    return [
      // ── Lo general ───────────────────────────────────────────────
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=0, s-maxage=300, stale-while-revalidate=86400",
          },
        ],
      },
      {
        // Security headers on every response, including /_next/static
        // assets (nosniff matters there) and /api/* (HSTS + referrer-
        // policy don't hurt).
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
      CORP_SAME_ORIGIN_EXCEPT_WIDGET,
      // Clickjacking hardening for legacy browsers without CSP
      // frame-ancestors support. /shopify/embedded is excluded: it must
      // render inside the Shopify admin iframe (the proxy serves it with
      // frame-ancestors pinned to admin.shopify.com + the shop). In dev,
      // Superconductor's live preview frames the app, so no XFO at all.
      // /widget/ queda fuera por la misma razón: el chat se sirve dentro de un
      // iframe en la tienda del comercio, y X-Frame-Options no admite una lista
      // de orígenes. Quién puede embeberlo lo decide el CSP frame-ancestors que
      // pone el proxy, y sobre todo el token de sesión, que sólo se emite para
      // los dominios que el comercio autorizó.
      ...(process.env.NODE_ENV === "development"
        ? []
        : [
            {
              source: "/((?!shopify/embedded|widget).*)",
              headers: [{ key: "X-Frame-Options", value: "DENY" }],
            },
          ]),
      // ── Las excepciones, al final para que ganen ─────────────────
      {
        // Nombres con hash de contenido: un build nuevo produce archivos
        // nuevos, así que los viejos se pueden guardar para siempre.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Toda respuesta de API es de UNA persona y no se comparte jamás.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // El cargador del chat web es lo único de la app pensado para que OTRO
        // sitio lo pida: con el `Cross-Origin-Resource-Policy: same-origin`
        // general, el navegador de la tienda lo descarta sin decir por qué y el
        // chat no aparece en ninguna parte.
        //
        // Se cachea porque entra en cada visita a la tienda y su contenido no
        // depende del comercio (la configuración la pide en tiempo de
        // ejecución).
        //
        // Cinco minutos y no una hora: el nombre del archivo NO lleva hash, así
        // que la caché es lo único que decide cuándo llega un arreglo a las
        // tiendas. Con una hora, un error del widget seguía sirviéndose durante
        // una hora después de corregirlo — medido en una prueba real, donde el
        // navegador siguió mostrando la versión vieja hasta vaciar la caché a
        // mano. El `stale-while-revalidate` largo hace que ese refresco no le
        // cueste latencia a nadie: se sirve lo guardado y se renueva detrás.
        source: "/widget/v1.js",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
