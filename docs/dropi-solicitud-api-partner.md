# Correo a Dropi — consulta de integración

**Enviar a:** comercial@dropi.co (o el formulario de https://dropi.co/contactanos/)
**Alternativa:** WhatsApp comercial (+57) 321 8379821, pidiendo el contacto del equipo de integraciones.

**Asunto:** Riverz — integración con Dropi

---

Estimado equipo de Dropi:

Soy Juan Diego Ríos, fundador de **Riverz** (riverz.co).

Riverz parte de una premisa distinta a la de las herramientas de chat: en contra entrega el problema no es responder rápido, es que el pedido termine entregado. Por eso nuestro agente de inteligencia artificial no solo escribe: también **llama por teléfono**. Marca al cliente, confirma el pedido en una conversación real y lo deja creado en la tienda. Ese mismo agente atiende WhatsApp, Instagram, Messenger, Mercado Libre y correo desde un solo lugar, y trabaja sobre Shopify, WooCommerce, Tiendanube y Mercado Libre.

Queremos sumar Dropi como integración nativa antes de nuestro lanzamiento, con el ciclo completo: pedido confirmado en la llamada o el chat, cargado en Dropi; al generarse la guía, el cliente recibe automáticamente su número y su enlace de rastreo por WhatsApp; y de ahí en adelante, seguimiento en cada cambio de estado —incluidas las novedades— para que menos pedidos terminen en devolución. La capa de conversación y automatización ya está construida de nuestro lado; nos falta el lado de Dropi.

Antes de plantear un alcance concreto, nos interesa conocer lo que ofrece Dropi:

- ¿Qué servicios se pueden conectar y dónde está la documentación técnica?
- ¿Cuál es el proceso para solicitar acceso y qué requisitos piden de nuestro lado?
- ¿Disponen de un ambiente de pruebas para desarrollar la integración?

Quedamos a disposición para una llamada con el equipo de integraciones cuando les resulte conveniente.

Un saludo,

Juan Diego Ríos
Fundador — Riverz
juandiegoriosmesa@gmail.com · riverz.co

---

## Contexto investigado (no va en el correo)

- La API de integraciones se autentica con el header **`dropi-integration-key`**; el token se genera desde la sección **Integraciones** del panel del comercio y se asocia a la plataforma que consume.
- Hay ambientes separados de **pruebas** y **producción**, con URLs base distintas.
- Servicios conocidos: autenticación/login, creación de órdenes y **consulta de guías**, con estados tipo `GUIA_GENERADA`.
- Precedentes ya listados en dropi.co/integraciones: ChatCenter, Chatea Pro, IaChat, Fluxi, Lucidbot (Dropi V2), Mastertools. **Todos son herramientas de chat o de bots.** De ahí el posicionamiento del correo: Riverz no compite por responder más rápido, sino por efectividad de entrega —llamada telefónica con IA para confirmar el pedido y seguimiento de la guía hasta la entrega—, que es la métrica que le importa a Dropi.
- Países con operación: Colombia, México, Ecuador, Panamá, Paraguay, Chile, Perú.
- Contacto: comercial@dropi.co · (+57) 321 8379821 · dropi.co/contactanos

## Estado real de Riverz (para cuando respondan)

**Ya construido y funcionando** — toda la última milla de avisar al cliente:

- Plantillas de WhatsApp fuera de la ventana de 24 h — `src/lib/whatsapp/meta-api.ts:217`.
- Botón dinámico de rastreo por cliente (`ButtonUrlVariable` incluye `'tracking'`) — `src/lib/whatsapp/dynamic-links.ts:16`.
- Motor de automatizaciones con disparadores de despachado y entregado — `src/lib/automations/engine.ts:63`.
- Receta lista `enviar-tracking` con el copy del número de guía — `src/lib/automations/templates.ts:149`.
- Variables `tracking_number` / `tracking_company` / `tracking_url` en plantillas, condiciones y flujos — `src/lib/automations/data-points.ts:300`.
- Columnas donde vive la guía: `orders.tracking_number/tracking_company/tracking_url/shipping_status` — `supabase/migrations/137_mercadolibre_orders.sql:30`.
- La IA responde "¿dónde está mi pedido?" con guía y enlace — `lookup_order` en `src/lib/ai/tools.ts:139`.
- Creación real de pedidos por IA (contra entrega) — `src/lib/shopify/create-order.ts:115`.
- Llamada de voz COD → resultado → write-back al pedido — `src/lib/voice/result.ts:290` → `src/lib/voice/cod.ts:22`.
- CRUD de credenciales Dropi cifradas con RLS — `src/app/api/integrations/dropi/route.ts` + `supabase/migrations/116_voice_cod_and_campaigns.sql:44`.

**A medias o roto** (arreglar cuando llegue la documentación real):

- `pushOrderToDropi` (`src/lib/integrations/dropi.ts:71`) usa `Authorization: Bearer` y `POST /orders`, ambos adivinados. Lo investigado apunta a `dropi-integration-key` y a un endpoint tipo `saveOrder`.
- `DropiCard` (`src/components/settings/dropi-card.tsx`) no está importada en ninguna página: hoy ningún comercio puede conectar Dropi, y el push siempre sale por `return false`.
- `src/lib/voice/cod.ts:62` manda `items` como texto, no como líneas del pedido.
- El push no verifica `cod_mode`, no guarda el resultado ni el id del pedido en Dropi, y no reintenta.
- El logo de Dropi ya está en la landing (`src/components/landing/landing.tsx:108`) sin la funcionalidad detrás.

**Falta por completo:** lectura de guías desde Dropi, webhook o cron de estados, novedades, devoluciones, recaudo contra entrega, y transportadoras colombianas en `src/lib/shopify/carrier-tracking.ts` (hoy solo Andreani, Correo Argentino y OCA).
