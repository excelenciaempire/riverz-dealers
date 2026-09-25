# Conexión con Shopify

Permite disparar automatizaciones de WhatsApp desde eventos de Shopify
(carrito abandonado). Clonado del patrón del app Riverz, adaptado a este
proyecto (auth de Supabase, cifrado AES-256-GCM existente).

Hay **dos formas de conectar**:

- **A) App propia por comercio (Client ID + Client secret)** — sin App Store ni
  review. La crea el comercio en su organización, o Riverz en la suya con
  distribución personalizada y le manda el enlace de instalación. Cada
  conexión es self-contained por workspace (no usa `SHOPIFY_API_KEY`). Ver
  sección **6**.
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

## 6. Opción A — App propia por comercio, sin App Store

Las dos variantes se crean con los mismos datos, que la tarjeta de Shopify
muestra con botón de copiar (Integraciones → Shopify → Conectar):

- **URL de la app**: `https://riverz.co` (la raíz: ahí Riverz reconoce la
  instalación).
- **URL de redireccionamiento**: la de `shopifyRedirectUri()`.
- **Alcances**: los de `shopifyScopes()`.
- Sin **Incrustar app** y sin **flujo de instalación heredado**.

### A1. Enlace de instalación (el dueño sólo pulsa Instalar)

1. En el Dev Dashboard de **Riverz**: **Crear app** ("Riverz – <comercio>") con
   los datos de arriba.
2. En el workspace del comercio en Riverz: **Integraciones → Shopify →
   Conectar** → dominio `xxxx.myshopify.com`, Client ID y Client secret de esa
   app. Como todavía no está instalada, Riverz guarda las credenciales
   (`shopify_custom_apps`, migración 275) y la tarjeta queda "esperando".
3. En la app: **Distribución → Distribución personalizada** → el dominio de la
   tienda → **Generar enlace**. Ese enlace es el del dueño: sólo sirve para esa
   tienda y vence a los 7 días.
4. El dueño lo abre y pulsa **Instalar**. Shopify lo manda a `https://riverz.co`,
   la firma dice qué app es, Riverz completa el OAuth con sus credenciales y la
   tienda queda en el workspace del paso 2 (`connection_method='custom_app'`).
   El dueño ve `/shopify/instalada`, no el login.

Si el dueño instala antes del paso 2, ve un aviso; al guardar las credenciales,
que vuelva a abrir la app desde su admin de Shopify.

### A2. El comercio crea la app en su organización

1. En su admin: **Configuración → Apps → Desarrollar apps** → **Crear app** con
   los datos de arriba → **Instalar app** en su tienda.
2. En Riverz, el mismo formulario con su Client ID y Client secret. Instalada y
   en la misma organización, conecta al instante por client credentials
   (`connection_method='client_credentials'`, token de 24 h). Si todavía no
   está instalada, queda esperando y Riverz reintenta solo con las credenciales
   guardadas (`conectarPendientes`: cada 15 minutos en el cron
   `shopify-token-refresh`, y cada 30 segundos mientras la tarjeta está
   abierta), así que se conecta aunque la URL de la app no sea la de Riverz.

En los dos casos Riverz renueva el token solo y verifica los webhooks con el
secreto de esa app. Rotar el secreto en Shopify obliga a volver a pegarlo.

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
