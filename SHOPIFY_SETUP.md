# Conexión con Shopify

Permite disparar automatizaciones de WhatsApp desde eventos de Shopify
(carrito abandonado). Clonado del patrón del app Riverz, adaptado a este
proyecto (auth de Supabase, cifrado AES-256-GCM existente).

Hay **dos formas de conectar**:

- **A) App del Dev Dashboard (credenciales)** — el merchant crea una app en el
  Dev Dashboard de la organización de SU tienda, la instala y pega el Client ID
  + Client secret. **Sin App Store, sin review.** Cada conexión es
  self-contained por workspace (no usa `SHOPIFY_API_KEY`). Ver sección **6**.
- **B) OAuth (app pública)** — un único app con `SHOPIFY_API_KEY/SECRET`. Sólo
  se instala en tiendas reales cuando Shopify la aprueba en el App Store; hasta
  entonces la tarjeta no muestra **Conectar** (`SHOPIFY_APP_STORE_APPROVED`).
  Ver secciones **1–5**.

El camino del token `shpat_` (custom app creada en el admin) ya no existe:
Shopify no deja crear esas apps desde el 1 de enero de 2026.

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
| `SHOPIFY_APP_STORE_APPROVED` | `true` cuando Shopify apruebe la app: muestra **Conectar** (OAuth)  |

`NEXT_PUBLIC_SITE_URL` debe apuntar al dominio público (se usa para la base de
los webhooks). El token se cifra con `ENCRYPTION_KEY` (ya configurada).

## 5. Conectar

Integraciones → tarjeta **Shopify** → **Conectar** → escribe
`tu-tienda.myshopify.com`. Tras aceptar permisos vuelves a Integraciones con la
tienda conectada. Requiere `SHOPIFY_APP_STORE_APPROVED=true`.

## 6. Opción A — App del Dev Dashboard (credenciales), sin App Store

Para cada merchant:

1. Desde el admin de la tienda, **Configuración → Apps → Desarrollar apps** abre
   el Dev Dashboard de su organización. Si lo hace otra persona (por ejemplo el
   equipo de Riverz), el dueño le asigna el rol **Desarrollador de apps** en
   Configuración → Usuarios, y esa persona elige la organización de la tienda
   abajo a la izquierda del Dev Dashboard.
2. **Crear app**:
   - URL de la app: `https://riverz.co/integraciones`. No la raíz: ahí arranca
     el OAuth de la app pública.
   - Sin "Incrustar app", sin "flujo de instalación heredado" y sin URLs de
     redirección.
   - Alcances: los de `shopifyScopes()`. La tarjeta los copia con **Copiar
     alcances**.
3. **Panel general → Instalar app** en la tienda. La app y la tienda tienen que
   estar en la misma organización; si no, Shopify responde `app_not_installed`.
4. En Riverz: **Integraciones → Shopify → Conectar** → dominio
   `*.myshopify.com`, Client ID y Client secret.

Riverz canjea las credenciales por un token de 24 h
(`connection_method='client_credentials'`) y lo renueva solo; el client secret
también verifica la firma de los webhooks. Después registra los webhooks y
sincroniza el catálogo. Rotar el secreto en Shopify obliga a reconectar.

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
