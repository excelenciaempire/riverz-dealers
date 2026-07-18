# Shopify App Store — plan de publicación de "Riverz Inbox"

Objetivo: que cualquier tienda Shopify instale Riverz en 2 clics desde el App Store
(o vía link directo con listing *unlisted*), sin custom apps ni tokens pegados a mano.

Estado del código (2026-07-18): **listo para review en lo técnico.** Este documento
recoge lo que ya está resuelto en el repo y el paso a paso manual que falta en el
Dev Dashboard (dev.shopify.com, org 216526489, app "Riverz Inbox" 382541529089,
cuenta riverzoficial@gmail.com).

## 1. Lo que el código ya cumple

| Requisito de review | Dónde está |
|---|---|
| OAuth inmediato al instalar (sin login previo) | `src/proxy.ts` bootstrap `?shop=…` → `/api/shopify/oauth/start` (verifica HMAC si viene firmado) |
| Instalación sin cuenta Riverz (merchant nuevo) | callback → `shopify_pending_installs` (token cifrado) → registro → claim automático (`/api/shopify/claim`, `ShopifyClaimGuard`) |
| App embebida en el admin (App Bridge + session tokens) | `/shopify/embedded` + `src/lib/shopify/session-token.ts` (verificación JWT HS256) + CSP `frame-ancestors` dinámico en `src/proxy.ts` |
| Webhooks obligatorios GDPR | `/api/shopify/webhooks/customers-data-request`, `customers-redact`, `shop-redact` (HMAC-verificados) |
| `app/uninstalled` limpia la conexión | `/api/shopify/webhooks/app-uninstalled` |
| HMAC en OAuth callback + state CSRF | `src/lib/shopify/oauth.ts`, callback |
| Tokens cifrados en reposo | `persistShopifyConnection` (AES vía `lib/whatsapp/encryption`) |
| Multi-tenant por workspace | migración 055 + cookie de workspace en `/api/shopify/install` |
| Páginas legales (privacidad/términos) | riverz.co (clickwrap, migración 085) |

Flujo de instalación resultante (App Store):

1. Merchant hace clic en "Instalar" → Shopify golpea el App URL (`https://riverz.co/?shop=…&hmac=…`).
2. El proxy arranca OAuth de inmediato → pantalla de permisos de Shopify → callback.
3. Con sesión Riverz: la tienda se conecta al workspace ya mismo.
   Sin cuenta: el token queda "parqueado" (`shopify_pending_installs`), el merchant cae en
   `/registro?shopify=pending&shop=…` y al entrar al panel la tienda se reclama sola (toast + Integraciones).
4. Dentro del admin (iframe, `embedded=1`) se sirve `/shopify/embedded`: estado de conexión + botón para abrir Riverz o completar la vinculación.

## 2. Configuración del app en el Dev Dashboard (manual, ~30 min)

- [ ] **App URL**: `https://riverz.co` (el proxy resuelve instalación vs. carga embebida).
- [ ] **Allowed redirection URL(s)**: `https://riverz.co/api/shopify/oauth/callback` (alias del canónico `/api/shopify/callback` — dejar ambos listados no hace daño).
- [ ] **Embedded = enabled** (App Bridge). La página embebida ya existe.
- [ ] **Scopes** solicitados = los del código: `read_orders, write_orders, read_checkouts, read_customers, read_products` (env `SHOPIFY_SCOPES` puede sobreescribir; que coincidan).
- [ ] **Compliance webhooks** (GDPR):
  - customers/data_request → `https://riverz.co/api/shopify/webhooks/customers-data-request`
  - customers/redact → `https://riverz.co/api/shopify/webhooks/customers-redact`
  - shop/redact → `https://riverz.co/api/shopify/webhooks/shop-redact`
- [ ] Crear **versión nueva y release** tras cada cambio de config.

## 3. Protected Customer Data (gate real, formulario)

Riverz lee clientes y pedidos (nombre, email, teléfono, dirección) → requiere
aprobación de **Protected Customer Data nivel 2** en el Dev Dashboard
(API access → Protected customer data access):

- [ ] Declarar propósitos: atención al cliente multicanal (inbox), enriquecimiento de
  contactos, automatizaciones de carrito/pedido, atribución de ventas.
- [ ] Cuestionario de protección de datos: cifrado en reposo (tokens y webhook secrets ya
  van cifrados; Supabase cifra el storage), TLS en tránsito, retención limitada
  (borrado vía webhooks GDPR), acceso por workspace (RLS).
- [ ] Las tiendas de desarrollo están exentas → se puede probar todo antes de la aprobación.

## 4. Billing

Riverz cobra su SaaS fuera de Shopify (multicanal; Shopify es una integración más).

- [ ] Solicitar **exención del Billing API** en el formulario de submission (caso
  Klaviyo/Gorgias: plataforma externa cuyo valor no depende solo de Shopify).
- [ ] Plan B si la exención se niega: app gratuita en Shopify (la suscripción se
  contrata en riverz.co y el app solo "conecta" la tienda) — revisar política vigente al someter.

## 5. Listing (assets)

- [ ] Ícono 1200×1200, capturas del inbox/campañas (mín. 3, sin datos reales de clientes), video demo (~2 min).
- [ ] Nombre: "Riverz — Inbox y ventas por WhatsApp e Instagram" (es) / listing en en + es.
- [ ] URLs: soporte (email), privacidad `https://riverz.co/privacidad`, términos `https://riverz.co/terminos`.
- [ ] Opción **unlisted** si aún no queremos aparecer en búsqueda: mismo review, instalación solo por link directo.

## 6. Review — notas para el revisor

- [ ] Tienda demo del Partner org con productos de prueba.
- [ ] Cuenta Riverz demo (email+clave) en las review notes, con el workspace ya poblado.
- [ ] Guion: instalar desde el admin → OAuth → registro → claim automático → abrir app embebida → ver estado conectado → abrir riverz.co (inbox con catálogo sincronizado).
- [ ] Tiempos típicos: primera respuesta en días; 1–2 rondas de feedback.

## 7. Qué NO cambia durante el review

- Las conexiones existentes (OAuth de Pilar, custom apps admin_token) siguen funcionando:
  el review no congela credenciales ni afecta instalaciones vigentes.
- El camino admin_token (SHOPIFY_SETUP.md §7) sigue disponible para onboarding
  white-glove mientras el listing no esté aprobado.

## 8. Env requeridas en Render (prod)

`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (los del app del Dev Dashboard),
`NEXT_PUBLIC_SITE_URL=https://riverz.co`. Opcionales: `SHOPIFY_SCOPES`,
`SHOPIFY_OAUTH_REDIRECT_URI`, `SHOPIFY_ENRICH_ON_CONNECT`, `SHOPIFY_ENRICH_MAX`.
