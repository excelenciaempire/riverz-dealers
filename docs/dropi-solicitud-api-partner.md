# Dropi — solicitud de acceso a la API

## Estado

1. **Primer correo enviado** a comercial@dropi.co (consulta general).
2. **Respondió Jhon**, de Servicio al Cliente. Lo que confirmó:
   - Vía API se puede **sincronizar catálogo/productos, crear órdenes y consultar estado de pedidos/guías**.
   - La documentación técnica **no es pública**: se pide al equipo de integraciones.
   - Las solicitudes se gestionan **solo por correo**, a **marcos.amado@dropi.co**, e incluyen: motivo, **lista exacta de endpoints requeridos** e **ID de la cuenta de Dropi**.
   - Sandbox, credenciales de desarrollo y rate limits los evalúa el área técnica de Marcos Amado tras recibir el correo.
   - El enlace que compartieron (linktr.ee/Dropi_Colombia) es de **Dropi Academy** — cursos y registro, sin documentación de API.
3. **Pendiente:** enviar el correo de abajo. Ya tiene el ID de cuenta de Dropi: **455408** (riverzoficial@gmail.com), leído del perfil de la sesión guardada el 2026-09-26.

---

## Correo a enviar

**Para:** marcos.amado@dropi.co
**Asunto:** Solicitud de acceso a la API de Dropi para Riverz

---

Estimado Marcos:

Jhon, del equipo de Servicio al Cliente, nos indicó escribirte directamente para tramitar el acceso a la API de Dropi. Abajo va la información que nos solicitaron.

Motivo de la solicitud

Riverz (riverz.co) es una plataforma de ventas y atención al cliente con inteligencia artificial para comercios de la región. Unifica WhatsApp, Instagram, Messenger, Mercado Libre y correo en un solo lugar, responde también los comentarios en redes sociales, y su agente llama por teléfono: marca al cliente, confirma el pedido contra entrega en una conversación real y lo deja creado en la tienda. Hoy integramos Shopify, WooCommerce, Tiendanube y Mercado Libre.

El objetivo del proyecto es que toda la operación se maneje de forma agéntica. Queremos que Riverz se haga cargo de la parte logística y del servicio al cliente completo: vender y resolver dudas en cualquier canal, responder comentarios, confirmar el pedido, cargarlo, seguir la guía, avisar al cliente en cada estado, resolver las novedades y gestionar la devolución, sin que el comercio tenga que estar encima de cada pedido. La integración con Dropi es la pieza logística de ese circuito.

El ciclo que queremos cerrar es este:

1. El pedido se confirma por chat o por llamada y Riverz lo carga automáticamente en Dropi.
2. Al generarse la guía, Riverz notifica al cliente por WhatsApp con su número de guía y su enlace de rastreo.
3. En cada cambio de estado, y sobre todo ante una novedad, Riverz contacta al cliente, resuelve y reporta la solución, para que menos pedidos terminen en devolución.

Cada comercio conecta su propia cuenta de Dropi desde Riverz, así que trabajaríamos con una llave de integración por comercio y no con una credencial única.

Endpoints requeridos

Prioridad 1, lo mínimo para operar:

1. Autenticación y generación del token de consumo.
2. Catálogo de productos del proveedor, con identificadores, precio, existencias y variantes. Lo necesitamos para referenciar los productos correctos al crear la orden y para que el agente no ofrezca ni venda algo sin existencias.
3. Crear orden con productos, cantidades, datos del cliente, dirección de entrega y valor a recaudar.
4. Consultar una orden por identificador y su estado actual.
5. Consultar la guía de una orden: número de guía, transportadora y enlace de rastreo.
6. Estados de la guía: estado actual, historial de movimientos y catálogo de estados posibles con su significado.
7. Notificación de cambios de estado. Si existe un webhook configurable por comercio, lo preferimos. Si no, un endpoint de consulta incremental que devuelva las órdenes con cambios desde una fecha, para no consultar pedido por pedido.

Prioridad 2, para completar la operación:

1. Novedades: listado por orden con su motivo, y endpoint para registrar la solución, como actualizar la dirección, reprogramar la entrega o autorizar un segundo intento.
2. Devoluciones: estado y motivo.
3. Recaudo contra entrega: valor recaudado por pedido.
4. Maestros: departamentos y ciudades válidos, transportadoras disponibles y, si existe, costo de flete estimado por destino. Los usamos para normalizar la dirección antes de generar la guía.
5. Anular o actualizar una orden ya creada.

ID de la cuenta de Dropi

455408 (riverzoficial@gmail.com, Dropshipper, Colombia)

Consultas técnicas

1. URLs base de los ambientes de pruebas y producción.
2. Credenciales de sandbox para desarrollar.
3. Límites de consumo.
4. Si el acceso cubre solo Colombia o también México, Ecuador, Panamá, Paraguay, Chile y Perú.
5. Requisitos de su lado en tratamiento de datos personales o acuerdos de confidencialidad. Podemos firmar lo que corresponda.

Podemos comenzar solo con los endpoints de prioridad 1 y ampliar más adelante. Quedamos atentos y a disposición para una llamada técnica cuando les resulte conveniente.

Un saludo,

Juan Diego Ríos
Fundador, Riverz
juandiegoriosmesa@gmail.com
riverz.co

---

## Contexto investigado (no va en el correo)

- La API de integraciones se autentica con el header **`dropi-integration-key`**; el token se genera desde la sección **Integraciones** del panel del comercio.
- Hay ambientes separados de **pruebas** y **producción**, con URLs base distintas.
- Servicios conocidos: autenticación/login, creación de órdenes y consulta de guías, con estados tipo `GUIA_GENERADA`.
- Integraciones ya listadas en dropi.co/integraciones: ChatCenter, Chatea Pro, IaChat, Fluxi, Lucidbot (Dropi V2), Mastertools. **Todas son herramientas de chat o de bots.** De ahí el posicionamiento: Riverz no compite por responder más rápido, sino por efectividad de entrega —llamada telefónica con IA para confirmar el pedido y seguimiento de la guía hasta la entrega—, que es la métrica que le importa a Dropi.
- Países con operación: Colombia, México, Ecuador, Panamá, Paraguay, Chile, Perú.
- Contactos: marcos.amado@dropi.co (integraciones/API) · comercial@dropi.co · (+57) 321 8379821.

## Estado real de Riverz (para cuando den acceso)

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

- `pushOrderToDropi` (`src/lib/integrations/dropi.ts:71`) usa `Authorization: Bearer` y `POST /orders`, ambos adivinados.
- `DropiCard` (`src/components/settings/dropi-card.tsx`) no está importada en ninguna página: hoy ningún comercio puede conectar Dropi, y el push siempre sale por `return false`.
- `src/lib/voice/cod.ts:62` manda `items` como texto, no como líneas del pedido.
- El push no verifica `cod_mode`, no guarda el resultado ni el id del pedido en Dropi, y no reintenta.
- El logo de Dropi ya está en la landing (`src/components/landing/landing.tsx:108`) sin la funcionalidad detrás.

**Falta por completo:** lectura de guías desde Dropi, webhook o cron de estados, novedades, devoluciones, recaudo contra entrega, y transportadoras colombianas en `src/lib/shopify/carrier-tracking.ts` (hoy solo Andreani, Correo Argentino y OCA).
