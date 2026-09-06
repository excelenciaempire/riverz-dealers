# Conexión con Shopify

Permite disparar automatizaciones de WhatsApp desde eventos de Shopify
(carrito abandonado). Clonado del patrón del app Riverz, adaptado a este
proyecto (auth de Supabase, cifrado AES-256-GCM existente).

Hay **dos formas de conectar**:

- **A) Custom app (token)** — el merchant crea una app en SU PROPIO Shopify
  Admin y pega el token + API secret key. **Sin App Store, sin review.** Ideal
  para onboardear pocos merchants high-ticket de forma white-glove. Cada
  conexión es self-contained por workspace (no usa `SHOPIFY_API_KEY`). Ver
  sección **7**.
- **B) OAuth (app global)** — un único Partner app con `SHOPIFY_API_KEY/SECRET`.
  Para self-serve a escala hay que listarla en el App Store (review). Ver
  secciones **1–6**.

## 1. Crear la app en el Partner Dashboard de Shopify

1. https://partners.shopify.com → **Apps** → **Create app** → **Create app manually**.
2. **App URL**: `https://<TU_DOMINIO>/settings?tab=channels`
3. **Allowed redirection URL(s)**: `https://<TU_DOMINIO>/api/shopify/callback`
4. Copia **Client ID** y **Client secret**.

## 2. Scopes

Los permisos vigentes están centralizados en `src/lib/shopify/oauth.ts` y son
configurables con `SHOPIFY_SCOPES`. No copies una lista reducida desde este
documento: pedidos, descuentos, fulfillment y la instalación transitoria del
chat requieren permisos adicionales.

## 3. Webhooks GDPR obligatorios (en el Partner Dashboard → App setup)

- Customer data request → `https://<TU_DOMINIO>/api/shopify/webhooks/customers-data-request`
- Customer redact → `https://<TU_DOMINIO>/api/shopify/webhooks/customers-redact`
- Shop redact → `https://<TU_DOMINIO>/api/shopify/webhooks/shop-redact`

Los webhooks de `checkouts/create`, `checkouts/update` y `app/uninstalled` se
registran automáticamente vía API tras conectar (no hay que configurarlos a mano).

## 4. Variables de entorno (Render)

| Variable                     | Valor                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| `SHOPIFY_API_KEY`            | Client ID del Partner Dashboard                                    |
| `SHOPIFY_API_SECRET`         | Client secret                                                      |
| `SHOPIFY_OAUTH_REDIRECT_URI` | `https://<TU_DOMINIO>/api/shopify/callback`                        |
| `SHOPIFY_API_VERSION`        | `2025-10` (opcional)                                               |
| `SHOPIFY_SCOPES`             | Omitir para usar el conjunto vigente de `src/lib/shopify/oauth.ts` |

`NEXT_PUBLIC_SITE_URL` debe apuntar al dominio público (se usa para la base de
los webhooks). El token se cifra con `ENCRYPTION_KEY` (ya configurada).

## 5. Conectar

Ajustes → Canales → tarjeta **Shopify** → escribe `tu-tienda.myshopify.com` →
**Conectar**. Tras aceptar permisos vuelves a Ajustes con la tienda conectada.

## 6. Opción A — Conectar con custom app (token), sin App Store

Para cada merchant (script white-glove). En **su** Shopify Admin:

1. **Configuración** → **Apps y canales de venta** → **Desarrollar apps** →
   **Crear app** (nombre: p. ej. "Riverz").
2. **Configuración de Admin API** → otorgar EXACTAMENTE estos scopes:
   `read_orders, write_orders, read_checkouts, read_customers, read_products`.
   (Sin `write_orders` la IA no puede crear pedidos; sin los `read_*` no llegan
   los webhooks de carrito/pedido.)
3. **Instalar app**.
4. Copiar de **Credenciales de API**:
   - **Admin API access token** (empieza con `shpat_…`, se muestra una sola vez).
   - **API secret key** (la usa Riverz para verificar la firma HMAC de los
     webhooks de ESA tienda).
5. En Riverz: **Ajustes → Canales → Shopify → "Conectar con token (custom app)"**
   → pegar dominio (`tienda.myshopify.com`) + token + API secret key → **Conectar**.

Riverz valida el token contra `/shop.json`, persiste la conexión cifrada
(`connection_method='admin_token'`, `webhook_secret` cifrado), registra los
webhooks (checkout/order/uninstall) y sincroniza el catálogo. **No requiere
`SHOPIFY_API_KEY` en el servidor** — funciona aunque la app global no esté
configurada. Los webhooks GDPR no aplican en este modo (son solo para apps del
App Store).

Migración asociada: `087_shopify_admin_token.sql` (columnas `webhook_secret` +
`connection_method`). Aplicar vía Management API antes de usar este path.

## 7. Flujo de carrito abandonado

`checkouts/create` → se busca/crea el contacto por teléfono → dispara las
automatizaciones con trigger **Carrito abandonado (Shopify)**. La plantilla
"Recuperación de carrito" hace: esperar 15 min → enviar plantilla de WhatsApp →
etiquetar. Solo `checkouts/create` dispara (los `update` se verifican pero se
ignoran para no repetir).

## 8. Chat web en Shopify

La instalación automática actual usa ScriptTag sólo como transición. Shopify
impedirá crear o actualizar ScriptTags desde el **1 de octubre de 2026** y
dejará de inyectarlos en storefronts desde el **1 de marzo de 2027**.

La app pública debe migrar a un **app embed block** de Theme App Extension.
Shopify exige theme app extensions para una app de App Store que integre el
storefront. El recorrido recomendado es OAuth → vincular Riverz → deep link al
editor del tema con el embed preactivado → guardar.

Diseño y plan de migración: `docs/auditoria-chat-web.md`.
