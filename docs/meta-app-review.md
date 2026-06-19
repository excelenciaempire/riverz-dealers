> **Estado del código (actualizado 2026-06-19):** los bloqueos de código #1 y #2 ya están RESUELTOS en el repo y desplegados:
> - El botón "Conectar" de Facebook/Instagram ahora usa el flujo OAuth real cuando existe `config_id` (env `NEXT_PUBLIC_META_LOGIN_CONFIG_ID`); sin él, sigue con el pegado de token (sin romper nada).
> - `src/lib/channels/oauth.ts` + `oauth/start` ya soportan Facebook Login for Business: con `config_id` envían `config_id=` y omiten `scope`.
> - Páginas/endpoints de privacidad y eliminación de datos ya existen y están desplegados.
>
> **Lo único que falta de tu lado para activar el login de negocio:** crear la *Login Configuration* en Meta (Facebook Login for Business → Configurations) con los 4 permisos, copiar su `config_id`, ponerlo en Render como `NEXT_PUBLIC_META_LOGIN_CONFIG_ID`, y reconectar la Página. Luego grabar el screencast y enviar. El resto de este documento es el detalle paso a paso.

---

# Meta App Review — Paquete final listo para enviar
## App: "Bandeja Unificada CRM" · App ID `1021515967221344` · Producto: riverz · https://riverz.co

---

## Resumen en español (lee esto primero)

Este documento contiene **todo el texto en inglés listo para pegar** en el App Review de Meta, más el guion del screencast. Pero antes de poder enviar hay **3 cosas de código** que SÍ o SÍ debes arreglar, porque sin ellas el revisor rechaza los 4 permisos en el primer paso.

**Qué vas a hacer, en 5 pasos:**

1. **Arreglar el botón "Conectar"** (bloqueo #1, afecta los 4 permisos). Hoy, en `src/components/settings/channels-panel.tsx` (líneas 471-477), el botón de Facebook/Instagram abre un **modal de pegar token**, NO el diálogo de consentimiento de Meta. Meta exige ver la pantalla de consentimiento donde el usuario otorga los permisos. **Hay que enrutar el botón al flujo OAuth real** (idealmente con Facebook Login for Business / `config_id`).
2. **Migrar a Facebook Login for Business con `config_id`** (bloqueo #2). El comentario en tu propio código dice *"the use-case app blocks the classic OAuth dialog"* — es decir, el flujo clásico `scope=` que tienes en `oauth.ts` probablemente **no cargará** el diálogo. Para una app de tipo Business que pide permisos de negocio de terceros, Meta espera el login de negocio con `config_id`. El patrón ya existe en tu repo para WhatsApp (`whatsapp-embedded-signup.tsx`).
3. **Reconectar la Página** después de 1+2 para que el token capture `pages_manage_engagement` (hoy NO está en el token vivo), y hacer **≥1 llamada API real por permiso** antes de enviar.
4. **Configurar URLs en el App Dashboard de Meta** (privacy policy, data deletion, deauthorize, redirect URI). Buena noticia: las páginas y endpoints **ya existen en el código** (`/privacidad`, `/eliminar-datos`, `/api/meta/data-deletion`, `/api/meta/deauthorize`) — solo falta pegar las URLs en Meta y probar el "Send sample".
5. **Grabar el screencast** (1080p, sin audio, captions en inglés, desde logged-out) demostrando cada permiso de punta a punta, y **enviar**.

**Importante (honestidad):** los textos de "use case" e instrucciones de este paquete describen el flujo OAuth/consentimiento. Ese flujo **no es lo que tu producción muestra hoy** (muestra pegar-token). NO grabes ni envíes hasta completar los pasos 1-3. Si envías con el estado actual, te rechazan.

---

## 0. Prerequisitos a cerrar ANTES de enviar

### 0.1 Bloqueos de código (obligatorios)

| # | Bloqueo | Archivo | Acción |
|---|---------|---------|--------|
| 1 | Botón "Conectar" abre modal de pegar token, no el diálogo OAuth de Meta | `src/components/settings/channels-panel.tsx` (líneas 471-477) | Eliminar el short-circuit `if (isMeta) { setManualOpen(...); return; }` y llamar a `handleConnect(g.connectChannel)` para canales Meta. |
| 2 | OAuth usa `scope=` clásico (sin `config_id`); el comentario del código dice que la use-case app bloquea el diálogo clásico | `src/lib/channels/oauth.ts` (líneas 79-93) + `src/app/api/connections/[provider]/oauth/start/route.ts` | Crear una Login Configuration en Meta → obtener `config_id` → añadir env `NEXT_PUBLIC_META_LOGIN_CONFIG_ID` → en el authorize, si hay config_id, `set("config_id", cfg.configId)` y **omitir** `scope` (son mutuamente excluyentes). Patrón a reusar: `src/components/settings/whatsapp-embedded-signup.tsx`. |
| 3 | `pages_manage_engagement` NO está en el token vivo | (token, no código) | Tras 1+2, **reconectar** la Página por el flujo OAuth para emitir un token con `pages_manage_engagement`. Hacer ≥1 llamada `POST /{comment-id}/comments` real. |

### 0.2 Privacy Policy y Data Deletion — YA EXISTEN, solo configurar en Meta

> Estos archivos ya están en el repo y son públicos (no están en `protectedPaths`):
> - `src/app/privacidad/page.tsx` → `https://riverz.co/privacidad`
> - `src/app/eliminar-datos/page.tsx` → `https://riverz.co/eliminar-datos`
> - `src/app/api/meta/data-deletion/route.ts` (callback firmado, verifica HMAC, borra contactos, devuelve `{url, confirmation_code}`)
> - `src/app/api/meta/deauthorize/route.ts` (deauthorize callback)

**Acción restante:** pegar las URLs en el dashboard (tabla 0.3) y probar el callback con "Send sample"/cURL antes de enviar. Verifica también que `/privacidad` nombre explícitamente los datos de Messenger/Instagram/Página que recolectas (es el rechazo #1 de privacy policies).

### 0.3 App Settings (Meta App Dashboard)

| Ajuste | Valor exacto | Dónde |
|--------|--------------|-------|
| App Domains | `riverz.co` | Settings → Basic |
| Privacy Policy URL | `https://riverz.co/privacidad` | Settings → Basic |
| Data Deletion Request URL | `https://riverz.co/api/meta/data-deletion` | Settings → Basic / FB Login |
| Deauthorize Callback URL | `https://riverz.co/api/meta/deauthorize` | FB Login → Settings |
| Valid OAuth Redirect URIs | `https://riverz.co/api/connections/meta/oauth/callback` | FB Login → Settings |
| App Icon | 1024×1024, sin marcas de Meta | Settings → Basic |
| App Category | Business / Messaging | Settings → Basic |
| App Purpose | **Clients / other businesses** | App Review / Basic |
| Primary Contact email | email real monitoreado | Settings → Basic |
| Render env | `NEXT_PUBLIC_SITE_URL=https://riverz.co` (sin barra final) | Render → Environment |

### 0.4 Checklist de prerequisitos

- [ ] Bloqueo #1 arreglado (botón → OAuth real) y verificado en navegador limpio
- [ ] Bloqueo #2: `config_id` creado + env + authorize migrado (sin `scope`)
- [ ] Bloqueo #3: Página reconectada → token incluye `pages_manage_engagement`
- [ ] ≥1 llamada API real por permiso en los últimos ~30 días
- [ ] Privacy Policy URL configurada y nombra datos de Meta
- [ ] Data Deletion + Deauthorize URLs configuradas; "Send sample" responde OK y `url` abre la página
- [ ] OAuth Redirect URI registrada exacta + `NEXT_PUBLIC_SITE_URL` correcto en Render
- [ ] App Icon, Category, App Domains, App Purpose, Contact email completos
- [ ] Business Verification VERIFIED (ya está)
- [ ] Página de prueba suscrita a webhooks (`messages`, `messaging_postbacks`, `feed`) + mensajería habilitada
- [ ] Cuenta de prueba dedicada (no admin) + segunda cuenta para enviar DM/comentario entrante

---

## 1. Por permiso — texto exacto a pegar

> Pega cada bloque "Use case" en el campo *"Tell us how your app uses this permission"* del permiso correspondiente. No reutilices texto entre permisos (Meta lo penaliza). Las instrucciones para el revisor van en el campo *"Provide detailed step-by-step instructions"*.

---

### 1.1 `pages_messaging`

**Use case (paste):**

> Bandeja Unificada CRM ("riverz", https://riverz.co) is an omnichannel customer-support inbox for small and medium businesses and online stores. We use `pages_messaging` to let a business agent read the Messenger conversations that customers send to the business's own Facebook Page, and reply to those customers, all from a single unified inbox alongside the business's WhatsApp, Instagram, and email. When a customer messages the connected Page, our app receives the message via Page-subscribed webhooks (messages, messaging_postbacks, message_reactions, message_deliveries, message_reads), displays it to the agent in the inbox, and the agent — or, optionally, an AI assistant the business turns on — sends the reply through the Send API within Meta's 24-hour messaging window (messaging_type: RESPONSE). The message content and the customer's basic profile (name, profile picture) are shown to the agent only so they can respond; this data is never sold and never used for advertising.
>
> The permission is necessary because, without it, the business could not receive or answer its Page DMs from our inbox and would have to switch back to Messenger separately, defeating the purpose of a unified CRM. We only ever message on behalf of the business that explicitly connects its own Facebook Page through our Facebook Login flow — each merchant/workspace connects only their own Page (and the linked Instagram Professional account). The app never accesses or messages Pages or accounts the connecting business does not own and administer.

**Step-by-step for the reviewer (paste):**

> 1. Open https://riverz.co and sign in with the test credentials provided in the submission notes (email + password). The form is in Spanish: "Correo" = email, "Contraseña" = password.
> 2. In the left navigation open "Integraciones" (Integrations) — direct URL https://riverz.co/integraciones.
> 3. On the "Facebook" card click "Conectar" (Connect). You are redirected to the Facebook business-login dialog.
> 4. Select the test Facebook Page you administer and approve the requested permissions (the consent screen lists `pages_messaging` among others). You are redirected back to https://riverz.co/api/connections/meta/oauth/callback and then to Integraciones, where the connected Page appears as linked.
> 5. From a second, separate Facebook account (not the connected business account), open Messenger and send a message to the connected Page (e.g. "Hola, ¿precio?").
> 6. Back in riverz open "Bandeja" (Inbox) — direct URL https://riverz.co/bandeja. The incoming Messenger message appears in the conversation list, tagged as the Messenger channel.
> 7. Open the conversation, type a reply, and send it. This sends the reply through the Page using `pages_messaging`.
> 8. Switch to the second account's Messenger and confirm the reply was delivered in the native thread.
>
> Note: keep the inbound message recent (reply within the 24-hour window). The Page must have Messages enabled.

**Screencast must show:** logged-out → sign-in → Integraciones → "Conectar" Facebook → Facebook consent dialog granting `pages_messaging` (annotated) + Page selection → Page connected → second account sends Messenger DM → message arrives in Bandeja → agent composes + sends reply → reply delivered in native Messenger. English captions; no audio; 1080p.

**Notas:** ya está en el token vivo. Confirma suscripción de webhooks de la Página. Muestra respuesta **manual** del agente (no AI) para que el revisor vea quién envía.

---

### 1.2 `instagram_manage_messages`

**Use case (paste):**

> riverz (https://riverz.co) is a unified inbox/CRM that lets a small business manage all of its customer conversations from one screen. We use `instagram_manage_messages` so a business can read and reply to the Instagram Direct messages that its own customers send to its own Instagram Professional account, without leaving our app. When a customer sends a DM, our app receives the `messages` webhook on the connected Page, displays the incoming message in the unified inbox ("Bandeja"), and lets a human agent — or, optionally, an AI assistant the business enables — compose and send a reply via the Send API. The data we access (the customer's Instagram-scoped sender ID, username, message text and attachments) is used solely to render the conversation and deliver the agent's reply. It is not used for advertising and is not sold.
>
> The permission is necessary because, without it, the business cannot receive or answer Instagram DMs inside riverz and would have to switch back to the Instagram app, defeating the purpose of a single inbox alongside WhatsApp, Messenger and email. We only ever read and send messages on the Instagram Professional account the business itself connected (it must be linked to the Facebook Page the business owns and selects). Each merchant/workspace connects their own Page and Instagram account; we never access or message third-party accounts. Replies are sent with messaging_type: RESPONSE within Instagram's standard messaging window, in response to customer-initiated messages.

**Step-by-step for the reviewer (paste):**

> 1. Open https://riverz.co and sign in with the test credentials provided (email + password).
> 2. Open "Integraciones" — https://riverz.co/integraciones.
> 3. On the "Instagram" card click "Conectar". You are redirected to the Facebook business-login dialog.
> 4. Approve the requested permissions, then select the Facebook Page and its linked Instagram Professional account. You return to Integraciones, where the Instagram card shows the connected account as "Conectado".
> 5. From a second, separate Instagram account, send a Direct Message to the connected Instagram Professional account.
> 6. Back in riverz open "Bandeja" — https://riverz.co/bandeja. The incoming DM appears, attributed to the sender's @username.
> 7. Open the conversation, type a reply, and click send ("Enviar").
> 8. Open Instagram on the sender account and confirm the reply arrived in the DM thread.

**Screencast must show:** logged-out → sign-in → Integraciones → "Conectar" Instagram → Facebook consent dialog granting `instagram_manage_messages` (annotated) + Page/IG selection → IG connected → second IG account sends DM → arrives in Bandeja → agent sends reply → reply visible in native Instagram. English captions; no audio.

**Notas:** la cuenta IG debe ser **Profesional (Business/Creator) vinculada a la Página**; una IG personal no concede el permiso. Ventana 24h: envía el DM minutos antes de grabar. **Deprecación a vigilar:** esta es la ruta legacy (Facebook Login); Meta empuja a `instagram_business_manage_messages` vía Instagram Login. No bloquea hoy, pero considéralo a futuro.

---

### 1.3 `instagram_manage_comments`

**Use case (paste):**

> riverz (https://riverz.co) is an omnichannel inbox that lets small and medium businesses manage WhatsApp, Instagram, Messenger and email conversations from one place. We use `instagram_manage_comments` so a business can read and reply to the comments left on its own Instagram posts and reels directly from our inbox, instead of opening the Instagram app. When a customer comments on the merchant's post, the comment is delivered to our webhook (Instagram `comments` field) and shown in the inbox alongside that merchant's DMs and other channels; the agent then writes a reply that we publish via `POST /{comment-id}/replies`. An optional AI assistant can draft or auto-send replies on the merchant's behalf. Without this permission the business cannot see or answer Instagram post comments from our CRM, breaking the "all customer messages in one inbox" value our users rely on.
>
> We only ever read and reply to comments on Instagram Professional accounts the business itself explicitly connects, and only for the account whose Page access token was granted during that connection. We never access comments on third-party accounts. Comments authored by the connected business itself are filtered out and never treated as incoming customer messages. Comment data (text, the commenter's handle and id, the post id) is used solely to display the conversation and send the reply; it is not sold and not used for advertising.

**Step-by-step for the reviewer (paste):**

> 1. Open https://riverz.co and sign in with the test credentials provided.
> 2. Open "Integraciones" — https://riverz.co/integraciones.
> 3. On the "Instagram" card click "Conectar". The Facebook business-login dialog opens.
> 4. Select the Page and linked Instagram Professional account and grant the permissions (including `instagram_manage_comments`). You return to Integraciones with the account shown as "Conectado".
> 5. From a second Instagram account, post a comment on one of the connected account's posts or reels.
> 6. In riverz open "Bandeja" — https://riverz.co/bandeja. The comment appears as a conversation labeled as an Instagram comment, with the commenter's @username and text.
> 7. Open it, type a reply, and send it ("Enviar").
> 8. Open the post on instagram.com and confirm the reply published by riverz is visible under the original comment.

**Screencast must show:** logged-out → sign-in → Integraciones → "Conectar" Instagram → consent dialog granting `instagram_manage_comments` (annotated) → connected → incoming comment from a second account → appears in Bandeja → agent replies → reply visible under the comment on native Instagram. English captions; no audio.

**Notas:** debe haber un post/reel con un comentario real de otra cuenta (los comentarios propios se filtran). Cuenta IG Profesional vinculada a Página. Haz ≥1 llamada exitosa (read o reply) en los últimos ~30 días.

---

### 1.4 `pages_manage_engagement`

**Use case (paste):**

> riverz (https://riverz.co) is an omnichannel customer-support inbox that lets a small or medium business manage all of its customer conversations in one place (WhatsApp, Instagram, Messenger, email, and public comments). Each business signs into riverz, opens Integrations, and connects its own Facebook Page (and linked Instagram Professional account) through Facebook Login, explicitly granting the requested permissions. We never act on Pages the business does not own or administer.
>
> We use `pages_manage_engagement` so a business agent can reply to the comments customers leave on the business's own Facebook Page posts, directly from the riverz inbox, as part of customer service. New comments are delivered through the Page's `feed` webhook and shown in the unified inbox; when the agent types a reply, we publish it via `POST /{comment-id}/comments` using the Page access token the business granted. Without this permission the agent could see incoming comments but could not respond, forcing the business to leave riverz and answer each comment manually in Facebook — defeating the unified-inbox purpose. The comment data is shown only to that business's own agents to answer their customers; it is not sold, shared, or used for advertising.

**Step-by-step for the reviewer (paste):**

> 1. Open https://riverz.co and sign in with the test credentials provided.
> 2. Open "Integraciones" — https://riverz.co/integraciones.
> 3. On the "Facebook" card click "Conectar". The Facebook business-login dialog opens.
> 4. Select the test Page you administer and approve the permissions (the consent screen lists `pages_manage_engagement`). You return to riverz with the Page connected.
> 5. From a second, separate Facebook account, go to a post on the connected Page and leave a comment (e.g. "Hi, is this in stock?").
> 6. In riverz open "Bandeja" — https://riverz.co/bandeja. The Facebook comment appears as a conversation.
> 7. Open it, type a reply, and click "Enviar".
> 8. Switch to Facebook (the post) and confirm riverz's reply appears under the original comment on the Page post.

**Screencast must show:** logged-out → sign-in → Integraciones → "Conectar" Facebook → consent dialog granting `pages_manage_engagement` (annotated) + Page selection → Page connected → incoming comment from a second account on the Page post → appears in Bandeja → agent replies → reply visible under the comment on native Facebook. English captions; no audio.

**Notas (crítico):** este scope **NO está en el token vivo** hoy — debes reconectar la Página tras arreglar el login para que el token lo incluya, o la respuesta falla en cámara. Suscribe la Página al campo `feed`. Comenta desde una cuenta distinta a la dueña de la Página. Haz ≥1 llamada `POST /{comment-id}/comments` real antes de enviar.

---

## 2. Guion maestro del screencast

**Specs:** 4:30-5:30 min, 1080p, monitor ≤1440px de ancho, cursor agrandado, **sin audio** (usa captions en inglés porque la UI es español), **toma continua sin cortes**, dos ventanas lado a lado (browser + Messenger/Instagram/Facebook nativo) para mostrar la entrega real. Grabar con la **cuenta de prueba** (no admin), desde **logged-out**.

| Tiempo | En pantalla (acción) | Caption / narración (inglés) |
|--------|----------------------|------------------------------|
| 0:00-0:12 | Navegador limpio, barra de direcciones visible → `https://riverz.co`. Página de login (logged-out). | "riverz — a unified inbox CRM. Starting fully logged out." |
| 0:12-0:30 | Escribir email + password de prueba → "Iniciar sesión". Carga `/panel`. | "Signing in with the reviewer test account." |
| 0:30-0:45 | Sidebar → "Integraciones". Cards: WhatsApp, Facebook, Instagram, Gmail, Outlook. | "Each merchant connects their OWN Facebook Page and Instagram account. We never message third-party accounts." |
| 0:45-1:10 | Card "Facebook" → "Conectar". Redirige a facebook.com → diálogo de business login → selección de Página → pantalla de consentimiento (zoom en la lista de permisos). | "Connecting Facebook. Granting pages_messaging and pages_manage_engagement." |
| 1:10-1:25 | "Continuar/Allow" → redirect a callback → Integraciones. Card Facebook muestra Página conectada (check verde). | "Consent granted. Page token stored encrypted. Page connected." |
| 1:25-1:50 | Card "Instagram" → "Conectar" → diálogo de consentimiento (zoom). "Allow" → IG conectado (check verde). | "Connecting Instagram (Professional account linked to the same Page). Granting instagram_manage_messages and instagram_manage_comments." |
| 1:50-2:05 | Sidebar → "Bandeja". Inbox unificado con badges de canal. | "One inbox for every channel." |
| 2:05-2:35 | Ventana derecha: Messenger nativo. Segunda cuenta envía DM a la Página. Izquierda: aparece en `/bandeja` en tiempo real. | **"pages_messaging — incoming Messenger DM."** |
| 2:35-3:00 | Abrir el chat de Messenger, escribir respuesta, "Enviar". Derecha: el DM llega al Messenger nativo. | **"pages_messaging — reply delivered in native Messenger."** |
| 3:00-3:25 | Derecha: Instagram nativo. Segunda cuenta envía DM al IG profesional. Izquierda: aparece en `/bandeja` con badge IG. | **"instagram_manage_messages — incoming Instagram DM."** |
| 3:25-3:50 | Abrir el chat IG, responder, "Enviar". Derecha: respuesta recibida en Instagram nativo. | **"instagram_manage_messages — reply delivered in native Instagram."** |
| 3:50-4:15 | Derecha: feed de Instagram. Segunda cuenta comenta un post del merchant. Izquierda: comentario surge en riverz → responder → "Enviar". Derecha: respuesta bajo el comentario en IG nativo. | **"instagram_manage_comments — reply to a comment on the merchant's IG post."** |
| 4:15-4:40 | Derecha: feed de la Página de Facebook. Segunda cuenta comenta un post. Izquierda: comentario llega vía `feed` → responder → "Enviar". Derecha: respuesta bajo el comentario en FB nativo. | **"pages_manage_engagement — reply to a comment on the merchant's Facebook Page post."** |
| 4:40-4:55 | Volver a `/bandeja` con los 4 hilos resueltos. | "Four permissions, one inbox — all on behalf of the business that connected its own accounts." |
| 4:55-5:10 | (Opcional) Mostrar link a Privacy Policy en el footer y la página `/eliminar-datos`. | "Privacy policy and data deletion available to every user." |

**Consejos de grabación:**
- Mantén la **barra de direcciones visible** todo el tiempo (las URLs `riverz.co` y `facebook.com/...dialog/oauth` son evidencia).
- **Una sola toma continua**, sin cortes ni saltos (un salto entre "enviado" y "recibido" parece falsificado; si el webhook tarda, espera en cámara).
- **Empieza logged-out** (incógnito o cookies borradas).
- Graba con la **cuenta de prueba/test user** que entregas al revisor, no admin.
- **Zoom y pausa ~2s** en cada pantalla de consentimiento para que los scopes sean legibles.
- Cursor agrandado, clics con mouse (no teclado), un caption en inglés por paso nombrando el permiso.
- Mensajes/comentarios entrantes **frescos** (ventana 24h).
- Sube un solo video; en cada campo por permiso referencia el timestamp (ej. "pages_messaging at 2:05-3:00").

---

## 3. Datos de prueba a preparar para el revisor

Crea y verifica esto antes de grabar y de enviar:

1. **Usuario de prueba de riverz (no admin):** email + password dedicados de un workspace de prueba. Pruébalos en navegador limpio. Entrégalos en el campo de instrucciones (sin espacios al inicio/fin). NO entregues tu cuenta personal de Meta ni la del cliente.
2. **Página de Facebook de prueba** que administres con la cuenta de prueba, con **al menos un post publicado** que pueda recibir comentarios, **Messages habilitado**, y **suscrita** a los webhooks de la app (`messages`, `messaging_postbacks`, `feed`).
3. **Cuenta de Instagram Profesional (Business/Creator) vinculada a esa Página**, con **al menos un post/reel**.
4. **Segunda cuenta de Facebook** y **segunda cuenta de Instagram** (distintas de las del negocio) para enviar los DMs y comentarios entrantes en el screencast.
5. **Roles en el App Dashboard:** asigna a las cuentas que graban rol Admin/Developer/Tester mientras la app está en Development, para que el flujo funcione end-to-end antes de la aprobación.
6. Confirma que el **token reconectado** incluye los 4 scopes (especialmente `pages_manage_engagement`) y que hiciste ≥1 llamada API real por permiso en los últimos ~30 días.

---

## 4. Paso a paso para enviar en el App Dashboard

1. Cierra todos los prerequisitos del §0 (código + URLs + token + tráfico API).
2. App Dashboard → **App Review → Permissions and Features**.
3. Para cada permiso (`pages_messaging`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_manage_engagement`) pulsa **Request Advanced Access**.
4. Rellena por permiso: el **Use case** (textos del §1, único por permiso), las **step-by-step instructions** (§1), y la casilla de cumplimiento.
5. **Sube el screencast** (§2) y referencia el timestamp de cada permiso en su campo.
6. En **Access instructions / Platform Settings**: pega las credenciales del test user y los pasos del §3. Pon en "Yes" que los usuarios pueden iniciar sesión.
7. Verifica que **Business Verification** esté VERIFIED (ya está) y que App Settings → Basic esté completo (§0.3).
8. **Submit for Review**. Decisión típica ~3-7 días hábiles. Si rechazan, corrige según el motivo y reenvía.

> Mantén la app en **Development mode** hasta la aprobación, con el test user con rol. No la pongas Live "a ciegas".

---

## 5. Checklist final "listo para enviar"

**Código:**
- [ ] Botón "Conectar" → OAuth real (quitar short-circuit `if (isMeta) setManualOpen`)
- [ ] Facebook Login for Business con `config_id` (omitir `scope`); env `NEXT_PUBLIC_META_LOGIN_CONFIG_ID`
- [ ] Página reconectada → token incluye `pages_manage_engagement`
- [ ] Diálogo de consentimiento verificado en navegador limpio

**Meta App Dashboard:**
- [ ] Privacy Policy URL = `https://riverz.co/privacidad` (nombra datos de Meta)
- [ ] Data Deletion Request URL = `https://riverz.co/api/meta/data-deletion` (+ "Send sample" OK)
- [ ] Deauthorize Callback URL = `https://riverz.co/api/meta/deauthorize`
- [ ] Valid OAuth Redirect URI = `https://riverz.co/api/connections/meta/oauth/callback` (exacta)
- [ ] App Icon 1024×1024, Category, App Domains = `riverz.co`, App Purpose = Clients, Contact email
- [ ] `NEXT_PUBLIC_SITE_URL=https://riverz.co` en Render (sin barra final)

**Permisos / token / tráfico:**
- [ ] ≥1 llamada API real por cada uno de los 4 permisos en los últimos ~30 días
- [ ] Página suscrita a webhooks (`messages`, `messaging_postbacks`, `feed`) + Messages habilitado

**Review:**
- [ ] Test user dedicado (no admin) + credenciales probadas
- [ ] IG Profesional vinculada a Página + segunda cuenta FB y segunda cuenta IG
- [ ] Posts con comentarios reales para `*_manage_comments`
- [ ] Screencast 1080p, sin audio, captions inglés, toma continua, logged-out, entrega nativa visible
- [ ] Use case único por permiso, alineado 1:1 con el screencast
- [ ] Business Verification VERIFIED (ya)

**Archivos del repo relevantes:**
- A MODIFICAR: `c:\Users\river\Desktop\Apps\Apps\Whatsapp\src\components\settings\channels-panel.tsx` (líneas 471-477, short-circuit del botón)
- A MODIFICAR: `c:\Users\river\Desktop\Apps\Apps\Whatsapp\src\lib\channels\oauth.ts` (añadir `configId`) + `c:\Users\river\Desktop\Apps\Apps\Whatsapp\src\app\api\connections\[provider]\oauth\start\route.ts` (usar `config_id`, omitir `scope`)
- Patrón FL4B a reusar: `c:\Users\river\Desktop\Apps\Apps\Whatsapp\src\components\settings\whatsapp-embedded-signup.tsx`
- YA EXISTEN (solo configurar URLs en Meta, no tocar): `c:\Users\river\Desktop\Apps\Apps\Whatsapp\src\app\privacidad\page.tsx`, `src\app\eliminar-datos\page.tsx`, `src\app\api\meta\data-deletion\route.ts`, `src\app\api\meta\deauthorize\route.ts`