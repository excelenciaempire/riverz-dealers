# Shopify App Store — plan de publicación

Objetivo: que cualquier tienda Shopify instale Riverz en 2 clics desde el App Store
(o vía link directo con listing *unlisted*), sin custom apps ni tokens pegados a mano.

## Arquitectura de DOS apps (decidida 2026-07-18)

El app original **"Riverz Inbox"** (382541529089, client `c5240cc4…`) quedó
**irreversiblemente en custom distribution** (ligado al Plus org de la tienda de
Pilar) — Shopify no permite cambiar el método de distribución. Por eso existe un
segundo app:

| App | Client ID | Distribución | Rol |
|---|---|---|---|
| **Riverz** (399553527809) | `57bf672c…` | **Pública (App Store)** — elegida, irreversible | App primario: nuevas instalaciones, listing, review |
| Riverz Inbox (382541529089) | `c5240cc4…` | Custom (Plus org de j9kgap-kn) | Legacy: la tienda de Pilar sigue aquí hasta la aprobación |

Prod (Render) corre con el par primario en `SHOPIFY_API_KEY/SECRET` y el legacy en
`SHOPIFY_API_KEY_LEGACY/SECRET_LEGACY`; el código verifica webhooks, session tokens
y callbacks OAuth contra ambos (commit f22ec35). **Tras la aprobación del App
Store, reconectar la tienda de Pilar** (visitar riverz.co/?shop=j9kgap-kn.myshopify.com
con su sesión de Shopify) para migrarla al app público; después el par legacy puede
retirarse.

Ojo: el app público **no puede instalarse en tiendas reales hasta ser aprobado** —
solo en tiendas de desarrollo del Partner org. Onboarding de merchants reales
mientras tanto: camino admin_token (SHOPIFY_SETUP.md §7).

Estado (2026-07-18): **código listo + configuración del Dev Dashboard hecha + datos
protegidos completos.** Cuenta riverzoficial@gmail.com, org Dev Dashboard 216526489,
org Partners 4896758.

## 1. Lo que el código ya cumple

| Requisito de review | Dónde está |
|---|---|
| OAuth inmediato al instalar (sin login previo) | `src/proxy.ts` bootstrap `?shop=…` → `/api/shopify/oauth/start` (verifica HMAC si viene firmado) |
| Instalación sin cuenta Riverz (merchant nuevo) | callback → `shopify_pending_installs` (token cifrado) → registro → claim automático (`/api/shopify/claim`, `ShopifyClaimGuard`) |
| App embebida en el admin (App Bridge + session tokens) | `/shopify/embedded` + `src/lib/shopify/session-token.ts` (verificación JWT HS256) + CSP `frame-ancestors` dinámico en `src/proxy.ts` |
| Webhooks obligatorios GDPR | URLs absolutas `https://riverz.co/api/shopify/webhooks/...` para `customers-data-request`, `customers-redact` y `shop-redact` (HMAC-verificados) |
| Webhooks operativos por tienda | `registerWebhooks()` registra `app_subscriptions/update`, catálogo, carritos, pedidos, clientes y `app/uninstalled` después del OAuth legado |
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

## 2. Configuración del app en el Dev Dashboard — ✅ HECHA (2026-07-18, ambos apps)

- [x] **App URL**: `https://riverz.co`.
- [x] **Redirects**: `https://riverz.co/api/shopify/oauth/callback` + `https://riverz.co/api/shopify/callback`.
- [x] **Embedded = true** (App Bridge).
- [x] **Scopes**: los declarados en `shopify.app.public.toml`; incluye catálogo, clientes, pedidos, fulfillment, descuentos y borradores de pedido.
- [x] **Compliance webhooks (GDPR)** → URLs HTTPS absolutas en riverz.co (customers-data-request / customers-redact / shop-redact). No usar rutas relativas cuando el App URL tiene un path: Shopify las concatena a ese path y la comprobación termina en 404. Aplicados vía Shopify CLI (`shopify app deploy`, el form web no los expone).
- [x] **Webhooks operativos** → registrados por tienda en `ShopifyAdminClient.registerWebhooks()` porque la app mantiene `use_legacy_install_flow = true`; no declarar `app_subscriptions/update` como suscripción de app en el TOML.
- Nota operativa: config por CLI con token de automatización (env `SHOPIFY_CLI_PARTNERS_TOKEN`, tokens `atkn_…` creados en Settings de cada app). TOML de referencia en el scratchpad o regenerar con `shopify app config link`.

## 3. Protected Customer Data — ✅ HECHA para el app público (2026-07-18)

- [x] Uso de datos + motivos: Customer service, Store management, Personalization, Marketing or advertising.
- [x] Campos nivel 2: Nombre, Email, Teléfono, Dirección (mismos motivos).
- [x] Cuestionario de protección de datos: **16/16** (todo "Sí" salvo venta de datos y
  decisiones automatizadas con efecto legal → "No aplicable").
- Estado "Preliminar": Shopify lo revisa recién al someter el listing. Las tiendas de
  desarrollo están exentas → se puede probar todo ya.
- ⚠️ Pendiente honesto: tener por escrito una política de respuesta a incidentes
  (una página basta) — el cuestionario declara que existe.

## 4. Billing — corregido después del rechazo 1.2.1

Las instalaciones del app público se cobran con Shopify Billing. El checkout,
los cambios de plan y la administración de la suscripción salen dentro de
Shopify. El callback verifica un estado firmado antes de activar el plan y el
webhook `app_subscriptions/update` reconcilia altas, mora y cancelaciones.

Stripe queda sólo para cuentas externas existentes que no instalaron Riverz
desde el App Store. Nunca se muestra Stripe a una instalación pública de
Shopify sin una suscripción externa previa.

- [x] Alta con `appSubscriptionCreate` y aprobación del merchant.
- [x] Primer mes con el mismo descuento vigente de Riverz dentro de Shopify.
- [x] Upgrade con aprobación y reemplazo en el siguiente ciclo.
- [x] Estado firmado, consulta de `activeSubscriptions` y webhook HMAC.
- [x] Acceso a la administración de cobros nativa de Shopify.

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

### Historial que no se debe repetir

| Fecha | Referencia | Falla | Prevención actual |
|---|---:|---|---|
| 2026-08-24 | 126646 | El catálogo no se sincronizaba automáticamente. | La conexión dispara `syncShopifyProducts` con `after()` y mantiene productos por webhook. |
| 2026-08-26 y 2026-08-28 | 130131 / 126646 | Credenciales de prueba inválidas; el revisor vio “Couldn't find your account”. | Verificar la cuenta indicada en las review notes en incógnito antes de enviar y no cambiarla durante review. |
| 2026-09-01 y 2026-09-03 | 130131 / 126646 | Cobro o compra de créditos fuera de Shopify. | Shopify Billing es obligatorio para instalaciones públicas; no enlazar Stripe ni recargas en el guion de review. |
| 2026-09-10 | 130131 | Error crítico al publicar la landing. | Ejecutar el flujo de Theme App Extension completo en la tienda de review y adjuntar un screencast nuevo. |
| 2026-09-23 | 126646 | La comprobación automática resolvió los webhooks bajo `/shopify/embedded/api/...` y recibió 404; la instalación abrió una tienda anterior en vez del grant esperado. | Mantener el App URL en `https://riverz.co`, dejar que `src/proxy.ts` enrute `embedded=1` a `/shopify/embedded` y declarar todos los webhooks con URL absoluta. |

### Identidad única para el siguiente envío

El repositorio y producción usan **Riverz (399553527809)**, client ID
`57bf672c917dc8a03d3ba61f6c0d5fed`. La referencia 130131 apuntó a otra app,
client ID `b6434939a3aab24b787bdfaedff59d58`, que no está configurada en producción.
No se debe volver a enviar esa segunda app: mezcla credenciales, instalación y
evidencia de dos identidades distintas. El siguiente review se presenta desde
la app 399553527809 con un solo conjunto de credenciales y un screencast grabado
contra esa misma instalación.

### Preflight obligatorio antes de volver a enviar

- Ejecutar las comprobaciones automáticas del Partner Dashboard y corregir cualquier URL real distinta de la URL esperada antes de pulsar “Enviar correcciones”.
- Instalar la app 399553527809 desde cero en una tienda de desarrollo limpia.
- Entrar con la cuenta exacta escrita en las review notes usando una ventana privada.
- Confirmar que el catálogo aparece sin pulsar “Sincronizar”.
- Aprobar un plan de prueba en Shopify y comprobar que Riverz queda activo.
- Publicar la landing mediante la Theme App Extension y abrirla en la tienda.
- Desinstalar y verificar que conexión y suscripción quedan canceladas.
- Grabar un screencast continuo de esos pasos; no reutilizar los videos rechazados.

## 7. Qué NO cambia durante el review

- Las conexiones existentes (OAuth de Pilar, custom apps admin_token) siguen funcionando:
  el review no congela credenciales ni afecta instalaciones vigentes.
- El camino admin_token (SHOPIFY_SETUP.md §7) sigue disponible para onboarding
  white-glove mientras el listing no esté aprobado.

## 8. Env en Render (prod) — ✅ SETEADAS 2026-07-18

- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` = app público "Riverz" (`57bf672c…`).
- `SHOPIFY_API_KEY_LEGACY` / `SHOPIFY_API_SECRET_LEGACY` = app legacy "Riverz Inbox"
  (`c5240cc4…`) — mantiene vivos los webhooks/session tokens de las tiendas ya
  instaladas (Pilar). Retirar tras migrarlas al app público.
- Ya existentes: `NEXT_PUBLIC_SITE_URL=https://riverz.co`, `SHOPIFY_OAUTH_REDIRECT_URI`.
- Opcionales: `SHOPIFY_SCOPES`, `SHOPIFY_ENRICH_ON_CONNECT`, `SHOPIFY_ENRICH_MAX`.
