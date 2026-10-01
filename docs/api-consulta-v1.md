# API de consulta v1 / Read API v1

## Español

Disponible únicamente en una compilación de comparación. En producción normal las cinco rutas devuelven `404`; no se activó la comparación ni se añadieron controles de UI.

Autenticación: `Authorization: Bearer <clave>`. Reutiliza una clave manual emitida desde la gestión MCP del negocio, con creador registrado y permiso vigente. Acepta claves de lectura y total, pero estas rutas solo consultan. No acepta cookies, clave de plataforma, claves antiguas sin creador ni tokens OAuth destinados al MCP. La revocación y el vencimiento se comprueban mediante el resolver existente en cada solicitud. La identidad y el negocio salen de la clave; enviar `workspace_id` o `user_id` no permite elegirlos y se rechaza como parámetro desconocido.

| GET | Consulta | Parámetros |
| --- | --- | --- |
| `/api/v1/conversations/search` | Búsqueda acotada de conversaciones visibles | `q`, `limit`, `status`, `channel` |
| `/api/v1/conversations/{id}` | Detalle autorizado de una conversación | Ninguno |
| `/api/v1/conversations/{id}/messages` | Últimos mensajes, en orden cronológico | `limit` |
| `/api/v1/contacts/search` | Búsqueda acotada de contactos del negocio | `q`, `limit` |
| `/api/v1/reports/cases` | Casos por motivo, comparación y CSAT | `start`, `end`, `previous_start`, `previous_end`, `reason`, `cursor` |

`q` tiene hasta 100 caracteres; puede omitirse. `limit` es un entero de 1 a 50, por defecto 20 para búsquedas y 30 para mensajes. `status`: `open`, `pending`, `closed`. `channel`: uno de los canales actuales de Riverz. Los ID son UUID. Parámetros desconocidos o repetidos se rechazan. Las búsquedas reutilizan las capacidades actuales: no son exportaciones completas, no tienen cursor ni prometen cubrir todos los resultados. La búsqueda textual de conversaciones primero encuentra hasta 200 contactos coincidentes. Los mensajes son la última ventana acotada, sin paginación del historial.

El reporte reutiliza el servicio y la RPC del panel, con actor autenticado y filtros de privacidad. Los cuatro límites de fecha son ISO 8601 con zona horaria; cada intervalo admite hasta 180 días y debe cumplir las validaciones existentes. `reason` selecciona uno de los cinco motivos de caso o `unclassified`, que permanece separado. Con un motivo se devuelve una página de hasta 20 evidencias; `next_cursor` es un objeto `{id,created_at}` que se serializa como JSON y se codifica como parámetro `cursor`. El cursor requiere motivo. Las cifras y CSAT describen la observación actual, no una reconstrucción histórica inmutable.

La pertenencia y las secciones permitidas se vuelven a leer: bandeja para conversaciones/mensajes, contactos para contactos y panel para reportes. Los buzones Gmail, Outlook y Zoho requieren dueño actual de la conexión dentro del negocio y canal. Los canales compartidos y contactos conservan su política vigente. Un ID inexistente, de otro negocio o de un buzón ajeno recibe el mismo `404`. Las capacidades vuelven a comprobar el buzón al ejecutarse.

Respuestas correctas: `{ "data": ... }`. Los nombres técnicos de los campos conservan el contrato de las capacidades existentes; los textos de clientes y datos de negocio no se traducen. Se excluyen trazas internas de IA, borradores, errores guardados y gasto de contactos sin moneda. No se invocan modelos, envían mensajes, modifican conversaciones ni mueven dinero.

Errores: `{ "error": "codigo", "message": "texto localizado" }`. `X-Riverz-Locale: es|en` elige idioma; en su ausencia se usa `Accept-Language`, con español como respaldo. `401 unauthorized`, `403 forbidden`, `400 invalid`, `404 not_found`, `429 limited` con `Retry-After` y `503 unavailable`. Una lectura o auditoría no confirmada produce `503`, sin datos ni detalles SQL. Respuestas con `Cache-Control: private, no-store` y `Vary` por autorización e idioma. No hay CORS abierto para clientes web externos.

El presupuesto de 60 solicitudes por minuto por clave comparte contador con MCP, usando el limitador existente: Redis cuando está configurado y respaldo por proceso cuando no lo está. Ese respaldo no demuestra un límite global entre réplicas. Las lecturas se registran en `platform_audit_log` antes de devolver datos, con clave, creador, recurso, ID validado, límite y estado; sin credencial, búsqueda, texto de mensajes ni respuesta completa. El registro no es WORM.

Ejemplo para una integración de servidor en el entorno de comparación:

```http
GET /api/v1/conversations/search?status=pending&channel=whatsapp&limit=10
Authorization: Bearer <clave-manual-del-negocio>
X-Riverz-Locale: es
```

## English

Available only in a comparison build. All five routes return `404` in the normal production build. No new UI controls or production comparison flag were enabled.

Send `Authorization: Bearer <key>` with an existing manually issued workspace MCP key whose creator remains a current member. Read and full keys are accepted; every route is read-only. Cookies, platform keys, legacy keys without an issuer and MCP OAuth tokens are excluded. Current revocation, expiry, membership and section permissions are checked on every request. The server derives workspace and user identity from the key; caller-supplied identity parameters are rejected.

Use the GET paths in the table above. Search accepts optional `q` up to 100 characters and integer `limit` from 1 to 50 (default 20). Conversation search also accepts current Riverz `channel` values and `status=open|pending|closed`. Detail IDs are UUIDs and accept no query parameters. Messages accept `limit` (default 30, maximum 50) and return the latest bounded window in chronological order. Duplicate and unknown parameters are rejected. Searches have no cursor or full-export guarantee; textual conversation search first finds at most 200 matching contacts.

Case reports reuse the dashboard service and validated privacy-aware RPC. Supply ISO 8601 timestamps with timezone in `start`, `end`, `previous_start`, `previous_end`; each interval is limited to 180 days and subject to the existing range checks. Optional `reason` selects one of the five case reasons or separate `unclassified`. A selected reason returns up to 20 evidence records; serialize and URL-encode the `{id,created_at}` `next_cursor` object for the next request's `cursor`. A cursor requires a reason. Counts and CSAT describe the current observation, not immutable historical state.

Inbox permission covers conversations and messages, contacts permission covers contacts, and dashboard permission covers case reports. Gmail, Outlook and Zoho require the current mailbox owner, workspace and matching channel. Shared channels and contacts retain their existing access policy. Missing, foreign-workspace and other-owner mailbox IDs all return `404`; the underlying capability checks ownership again.

Successful responses contain `{ "data": ... }`; technical fields retain the existing capability contract. Customer text and business data are not translated. Internal AI traces, drafts, stored errors and contact spending without currency are excluded. These routes do not call models, send messages, modify conversations or transfer money.

Errors contain `{ "error": "code", "message": "localized text" }`. Select `es` or `en` using `X-Riverz-Locale`, otherwise `Accept-Language` with Spanish fallback. Statuses: `401 unauthorized`, `403 forbidden`, `400 invalid`, `404 not_found`, `429 limited` with `Retry-After`, `503 unavailable`. Unconfirmed data reads or audit writes fail without returning data or SQL details. Responses are private and never cached; authorization and language are included in `Vary`. No open cross-origin browser access is provided.

The existing per-key limiter shares the MCP counter: 60 requests per minute, backed by configured Redis or a process-local fallback. The fallback cannot guarantee a global multi-replica budget. Successful reads require a confirmed `platform_audit_log` write before data is returned. Records contain only key/issuer identifiers, resource, validated record ID, limit and status; never credentials, search text, message bodies or complete responses. The audit is not WORM.

This increment does not provide REST mutations, HTTP action nodes, durable webhook retries, OpenAPI generation, full-history pagination or integration-provider execution guarantees.
