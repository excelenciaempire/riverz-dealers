# TikTok Business API — playbook de aplicación (comentarios, multi-cuenta)

> **Estado 2026-07-18:** registro de developer enviado (revisión ≤3 días) y app
> **Riverz** creada y enviada — scope `TikTok Accounts`, redirect
> `https://riverz.co/api/tiktok/oauth/callback`, logo 512×512 (tile carbón + "r"
> lima, misma receta de `src/app/icon.tsx`). Status en el portal: **Pending**.
> Cuando aprueben: copiar App ID + Secret del portal → env vars en Render.

Objetivo: que **Riverz quede aprobado como app de terceros en TikTok API for Business**
para que cualquier comercio conecte su cuenta TikTok Business por OAuth (igual que hoy
con Meta) y lea/responda/oculte los comentarios de sus videos desde la bandeja.

Los **DMs de TikTok NO entran en esta aplicación**: la Business Messaging API se otorga
solo a "Messaging Partners" aprobados (programa selectivo aparte). Plan: lanzar
comentarios primero, y con tracción (cuentas conectadas) aplicar al programa de partners.

Portal correcto: **https://business-api.tiktok.com/portal** (TikTok API for Business).
No confundir con developers.tiktok.com (Display/Login Kit — ahí no está la gestión de
comentarios de cuentas Business).

Endpoints que vamos a usar (referencia, v1.3): `/business/comment/list/`,
`/business/comment/reply/`, actualización de estado de comentarios (ocultar), y
`/business/get/` para info de la cuenta conectada.

## Checklist de prerrequisitos

- [x] **Páginas legales visibles en riverz.co** — verificado 2026-07-18: el landing
  muestra los enlaces Terms (`/terms`) y Privacy (`/privacy`) en el footer sin abrir
  menús, y ambas responden 200. Es requisito explícito de TikTok.
- [ ] **Cuenta TikTok Business de la empresa** (la del negocio, tipo "Business Account"
  en la app de TikTok — Ajustes → Cuenta → Cambiar a cuenta Business). Se necesita para
  registrarse como developer y para grabar el demo. Si Vitalú ya tiene TikTok, basta con
  cambiarla a Business (gratis, inmediato).
- [ ] **Documentos del negocio a mano** (los mismos de la verificación de Meta: registro
  mercantil / Cámara de Comercio). TikTok puede pedirlos según el nivel de acceso.
- [ ] **Video demo** — se graba cuando el flujo de conexión esté construido (guion abajo).
  Se puede enviar la solicitud inicial sin video y agregarlo si lo piden.

## Paso a paso del registro (lo hace el dueño; ~20 min)

1. Entrar a https://business-api.tiktok.com/portal → **Sign up** (usar
   riverzoficial@gmail.com; pide PIN al correo).
2. Completar el registro de developer ("Become a Developer"): datos de la empresa.
   Usar el bloque "Company info" de abajo.
3. **Create App** (My Apps → Create):
   - App name: `Riverz`
   - Description: bloque "App description" de abajo (en inglés).
   - Website: `https://riverz.co`
   - Privacy Policy: `https://riverz.co/privacy` · Terms: `https://riverz.co/terms`
   - **Advertiser redirect URL / Callback:** `https://riverz.co/api/tiktok/oauth/callback`
4. En productos/permisos de la app, seleccionar lo de **TikTok Accounts / Business
   Account Management** (info de cuenta + gestión de comentarios: listar, responder,
   ocultar). El nombre exacto de cada scope aparece en el propio formulario — pedir SOLO
   los de cuenta y comentarios, nada de Ads/Marketing API (pedir de más = rechazo).
5. Submit para revisión. Llega email con el resultado; el estado se ve en el portal.
   Tiempos típicos: **3–7 días**, hasta 2–4 semanas en picos.

## Bloques para copiar y pegar (en inglés — los reviewers evalúan en inglés)

**Company info**

> Riverz — SaaS customer-service inbox for small e-commerce merchants in Latin
> America. Website: https://riverz.co. The company operates the Riverz platform;
> business registration documents available on request.

**App description**

> Riverz is a SaaS unified inbox + AI assistant for small merchants. A merchant
> connects their own TikTok Business Account via OAuth. Riverz then shows the
> comments posted on the merchant's own TikTok videos inside one shared inbox
> (next to their WhatsApp, Instagram and Facebook conversations) and lets the
> merchant — or an optional AI assistant acting on the merchant's behalf — read,
> reply to, and hide those comments. Data is used only to provide the inbox
> service to the merchant who owns the account; it is never sold, shared, or
> used for advertising.

**Justificación por permiso** (pegar en "How will you use this permission")

- Account info / Business Account Management:
  > Identify the merchant's connected TikTok Business Account (display name,
  > avatar, account id) so the inbox can label which account each comment
  > belongs to and validate the OAuth connection.
- Comment list:
  > Fetch new comments posted on the merchant's own videos so they appear as
  > conversations in the merchant's customer-service inbox.
- Comment reply:
  > Let the merchant (or their AI assistant, configured and supervised by the
  > merchant) answer customer questions posted as comments on the merchant's
  > own videos, directly from the inbox.
- Comment hide/status:
  > Let the merchant hide spam or offensive comments on their own videos as
  > part of normal community management.

**Data handling** (si el formulario lo pregunta)

> Comment data is stored encrypted at rest (Supabase/PostgreSQL, EU region) only
> for the merchant that owns the TikTok account, retained while the merchant's
> connection is active, and deleted when the merchant disconnects the account or
> deletes their Riverz workspace. No data is shared with third parties or used
> for model training or advertising.

## Guion del video demo (2–3 min, grabación continua con cursor)

Grabar en https://riverz.co cuando el flujo esté construido. Sin cortes entre permisos.

1. (0:00) Login en riverz.co → panel.
2. (0:15) Integraciones → tarjeta TikTok → **Conectar** → diálogo OAuth de TikTok →
   autorizar la cuenta Business → la tarjeta queda verde. (demuestra account info)
3. (0:50) Desde el celular, comentar un video de la cuenta TikTok conectada como si
   fuera un cliente ("¿tienen envío a Bogotá?").
4. (1:10) El comentario aparece en la Bandeja de Riverz. (comment list)
5. (1:30) Responder desde Riverz → mostrar en TikTok que la respuesta quedó publicada.
   (comment reply)
6. (2:00) Ocultar un comentario spam desde Riverz → mostrar que quedó oculto. (hide)

## Si rechazan

No es fatal: se corrige lo señalado y se reenvía (el ciclo de TikTok es corto). Causas
típicas: video que no muestra el flujo completo, pedir scopes que la app no demuestra,
descripción genérica, o web sin las políticas visibles (ya cubierto). Responder siempre
mapeando cada scope a un paso concreto del video.

## Después de la aprobación

1. Guardar `TIKTOK_APP_ID` y `TIKTOK_APP_SECRET` como env vars en Render
   (servicio `srv-d88amc7avr4c73e6csmg`).
2. Construir en el repo: ruta OAuth `src/app/api/tiktok/oauth/` (connect + callback),
   adapter `src/lib/channels/tiktok_comment/adapter.ts` registrado en
   `src/lib/channels/registry.ts`, ingesta por polling/webhook según lo que la app
   aprobada tenga disponible, y tarjeta de conexión en Integraciones.
3. Grabar el video demo con el flujo real y agregarlo a la app si la revisión lo pide
   (o para las ampliaciones de scope).
4. Con cuentas conectadas y volumen real → aplicar a **Business Messaging API**
   (Messaging Partner) para los DMs.
