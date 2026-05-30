# Conexión con Shopify

Permite disparar automatizaciones de WhatsApp desde eventos de Shopify
(carrito abandonado). Clonado del patrón del app Riverz, adaptado a este
proyecto (auth de Supabase, cifrado AES-256-GCM existente).

## 1. Crear la app en el Partner Dashboard de Shopify

1. https://partners.shopify.com → **Apps** → **Create app** → **Create app manually**.
2. **App URL**: `https://<TU_DOMINIO>/settings?tab=channels`
3. **Allowed redirection URL(s)**: `https://<TU_DOMINIO>/api/shopify/callback`
4. Copia **Client ID** y **Client secret**.

## 2. Scopes

Mínimos para carrito abandonado: `read_orders,read_checkouts,read_customers`
(configurable con `SHOPIFY_SCOPES`).

## 3. Webhooks GDPR obligatorios (en el Partner Dashboard → App setup)

- Customer data request → `https://<TU_DOMINIO>/api/shopify/webhooks/customers-data-request`
- Customer redact → `https://<TU_DOMINIO>/api/shopify/webhooks/customers-redact`
- Shop redact → `https://<TU_DOMINIO>/api/shopify/webhooks/shop-redact`

Los webhooks de `checkouts/create`, `checkouts/update` y `app/uninstalled` se
registran automáticamente vía API tras conectar (no hay que configurarlos a mano).

## 4. Variables de entorno (Render)

| Variable | Valor |
|---|---|
| `SHOPIFY_API_KEY` | Client ID del Partner Dashboard |
| `SHOPIFY_API_SECRET` | Client secret |
| `SHOPIFY_OAUTH_REDIRECT_URI` | `https://<TU_DOMINIO>/api/shopify/callback` |
| `SHOPIFY_API_VERSION` | `2025-10` (opcional) |
| `SHOPIFY_SCOPES` | `read_orders,read_checkouts,read_customers` (opcional) |

`NEXT_PUBLIC_SITE_URL` debe apuntar al dominio público (se usa para la base de
los webhooks). El token se cifra con `ENCRYPTION_KEY` (ya configurada).

## 5. Conectar

Ajustes → Canales → tarjeta **Shopify** → escribe `tu-tienda.myshopify.com` →
**Conectar**. Tras aceptar permisos vuelves a Ajustes con la tienda conectada.

## 6. Flujo de carrito abandonado

`checkouts/create` → se busca/crea el contacto por teléfono → dispara las
automatizaciones con trigger **Carrito abandonado (Shopify)**. La plantilla
"Recuperación de carrito" hace: esperar 15 min → enviar plantilla de WhatsApp →
etiquetar. Solo `checkouts/create` dispara (los `update` se verifican pero se
ignoran para no repetir).
