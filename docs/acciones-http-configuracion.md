# Configuración de acciones HTTP / HTTP action configuration

## Español

Preparación de E2, reservada para comparación. Guardar o activar una configuración no invoca el destino ni registra aún herramientas del asistente o nodos de Flujos. La ejecución con recibos duraderos se implementa por separado. En producción normal estas rutas responden `404` y no aparece una UI nueva.

**Configuración visual posterior, solo en comparación:** Integraciones conserva todas sus conexiones y añade una sección opcional cerrada, “Conecta tu propio sistema”, para administradores con acceso a Ajustes. No hace solicitudes de configuración hasta abrirla. Nombre, propósito, HTTPS, autenticación, entradas escalares y campos de respuesta se editan con controles guiados, sin editor JSON. La credencial es un campo de contraseña sin valor prellenado; omitirla conserva el vínculo válido y cambiar autenticación borra la entrada local. Se limpia al guardar, cancelar o cambiar de negocio; no se guarda en almacenamiento del navegador.

Guardar deja la versión en borrador, incluso si antes estaba activa. Activar o retirar usa una operación separada con la versión observada. El historial muestra hasta 50 versiones y únicamente presencia de credencial. Un conflicto conserva el formulario y ofrece recargar el estado actual; no sobrescribe otro editor. La cabecera opcional `X-Riverz-Workspace` comprueba que el negocio resuelto en servidor siga siendo el que abrió la sección. No puede seleccionar un negocio ni conceder autoridad; una discrepancia responde `409` antes de leer o cambiar configuraciones.

La sección describe la disponibilidad actual para MCP y Operador, implementada en el [incremento de ejecución](acciones-http-ejecucion.md). No atribuye todavía las acciones al asistente de clientes o a Flujos. No incluye una llamada de prueba al proveedor. Esta entrega aún no cuenta con revisión visual o interacción de navegador; las comprobaciones automatizadas verifican ocultamiento, acceso, idioma, aislamiento, contratos y compilación.

Requiere sesión actual de Riverz y administración del negocio con acceso a Ajustes. Las mutaciones usan la protección CSRF existente. La identidad y el negocio se resuelven en servidor; las claves Bearer de la API de consulta no configuran acciones. Permisos y suscripción se vuelven a comprobar en la transacción.

| Ruta | Uso |
| --- | --- |
| `GET /api/integrations/http-actions` | Hasta 20 configuraciones del negocio |
| `POST /api/integrations/http-actions` | Crear borrador, `expected_version: 0` |
| `PATCH /api/integrations/http-actions/{id}` | `operation: save|activate|withdraw`, con versión esperada |
| `GET /api/integrations/http-actions/{id}/history` | Hasta 50 versiones, sin credencial ni ciphertext |

La creación y edición reciben `definition`, `expected_version` y `secret` opcional. Activar y retirar reciben únicamente `operation` y `expected_version`. Editar vuelve a borrador. No se elimina el historial. Los ID son UUID; parámetros de URL adicionales se rechazan. Los cuerpos JSON se limitan a 16 KiB y las solicitudes a 40 por minuto por actor/negocio mediante el limitador existente.

Ejemplo de definición sin credencial:

```json
{
  "definition": {
    "name": "Consultar envío",
    "description": "Consulta el estado en el sistema configurado",
    "method": "GET",
    "url": "https://integracion.example.com/estado",
    "credential_kind": "none",
    "parameters": [
      { "key": "order_number", "type": "string", "required": true, "source": "input" },
      { "key": "customer_phone", "type": "string", "required": true, "source": "phone" }
    ],
    "outputs": [
      { "key": "status", "type": "string", "required": true, "path": ["status"] }
    ]
  },
  "expected_version": 0
}
```

El destino es HTTPS fijo, sin usuario/contraseña en URL, fragmento ni parámetros con nombres de credenciales. Las URL se normalizan y se limitan a 2.048 caracteres, incluido el resultado con parámetros. Los argumentos se codifican como query para GET y objeto JSON para POST; no modifican host, ruta ni cabeceras. Un parámetro dinámico GET no puede sobrescribir uno fijo del destino.

Hasta 12 entradas escalares (`string`, `number`, `boolean`) y 12 salidas con rutas de uno a cinco nombres. Se rechazan duplicados, claves reservadas, objetos/arrays como valores y coerciones de tipo. Entradas string: 2.000 caracteres; salida string: 4.000. Números finitos entre −10¹² y 10¹². `source` puede ser `input`, `contact_id`, `conversation_id`, `phone` o `email`. Las últimas cuatro fuentes requieren campos string y contexto de servidor; el modelo no puede enviarlas ni reemplazarlas. El sistema externo debe comprobar la relación entre sus registros y la identidad recibida; declarar parámetros no demuestra que un número de pedido pertenezca a una persona.

Autenticación: `none`, `bearer` o `api-key` (`X-API-Key`). Una credencial nueva se envía como `secret` de 8 a 4.096 caracteres ASCII imprimibles. Se cifra con AES-256-GCM existente y se vincula al negocio, acción, origen y clase de autenticación. Omitirla en una edición conserva la anterior solo si su vínculo sigue siendo válido. Cambiar de origen o autenticación exige ingresarla de nuevo. Con `none` se retira la credencial y no se admite `secret`. Activar requiere que la credencial actual pueda descifrarse; retirar no lo requiere. No se admite incluirla en descripción, URL u otros campos públicos, ni reflejarla en una salida seleccionada.

El historial guarda la presencia de credencial, nunca su valor o ciphertext. Solo el servicio accede a tablas y RPC; no hay acceso público/autenticado directo ni escritura directa del servicio. La configuración y auditoría se confirman juntas; un fallo de auditoría revierte el cambio. El historial no se declara WORM ni recupera configuraciones anteriores a esta implementación.

El transporte preparado limita envío a 64 KiB, respuesta JSON a 128 KiB, cabeceras a 16 KiB y la operación completa a ocho segundos. Reutiliza DNS público fijado a TLS, sin redirecciones, compresión ni repetición automática. Un error después de iniciar el despacho se trata conservadoramente como incierto. `Idempotency-Key` no garantiza compatibilidad ni ausencia de duplicados en un proveedor. Una respuesta 2xx valida transporte y campos, sin demostrar por sí sola un resultado comercial.

Errores con código limitado y mensaje localizado: configuración inválida `400`, credencial requerida `400`, versión cambiada `409`, límite de configuraciones `409`, permisos `403`, recurso ausente `404`, sesión `401`, límite de solicitudes `429`, suscripción de solo lectura `402` y estado no confirmado `503`. Respuestas privadas, sin caché ni detalles de claves/SQL.

## English

This E2 preparation is restricted to comparison builds. Saving or activating configuration does not invoke its destination or register assistant tools or Flow nodes yet. Execution with durable receipts is a separate increment. Normal production returns `404` for these endpoints and exposes no new UI.

**Later visual configuration, comparison only:** Integrations retains its existing connections and appends one collapsed optional section for current administrators with Settings access. Configuration is loaded only after opening it. Guided controls cover name/purpose, HTTPS, authentication, scalar inputs and selected response paths, without a JSON editor. Credentials are never prefilled or stored in browser storage; changing authentication clears the local entry, and saving/cancelling/workspace changes clear the form.

Saving returns the action to draft; activation/withdrawal are separate version-checked operations. History returns up to 50 versions with credential presence only. Conflicts preserve edits and allow current-state reload without overwriting another editor. Optional `X-Riverz-Workspace` verifies that the server-resolved workspace matches the one opening the section; it cannot select scope or grant authority. A mismatch returns `409` before configuration reads/mutations.

The section describes currently implemented MCP/Operator support, not customer-facing assistant tools or Flow nodes. It performs no provider test call. This increment has no browser interaction or visual-layout verification yet; automated checks cover hidden UI, current access, localization, scope, contracts and compilation.

The routes above require a current Riverz session, current workspace administration and Settings permission. Writes use existing CSRF protection; membership and subscription are checked again inside the transaction. Read API Bearer keys cannot configure actions. Workspace and actor identity are server-derived.

Create with `definition`, `expected_version: 0` and optional `secret`. Save uses the same fields plus `operation: save`; activate/withdraw use only `operation` and `expected_version`. Editing returns the action to draft. Version conflicts do not overwrite another editor. Up to 20 stored actions and 50 returned history versions; UUID IDs, no extra query parameters, JSON request bodies up to 16 KiB and 40 configuration requests per minute per actor/workspace using the existing limiter.

Definitions use fixed HTTPS destinations, normalized and bounded to 2,048 characters including encoded parameters. Embedded credentials, fragments and credential-named query parameters are rejected. GET arguments become encoded query parameters; POST arguments become JSON. They cannot change host, path or headers, or replace fixed GET parameters.

Up to 12 scalar inputs and 12 selected outputs with paths of one to five names. Types are `string`, `number`, `boolean`; unknown, duplicate, reserved, object/array and incorrectly typed values are rejected. Strings: 2,000 input / 4,000 output characters. Finite numbers: −10¹² to 10¹². Input `source` may be `input`, `contact_id`, `conversation_id`, `phone` or `email`; the last four require string fields and trusted server context, and are omitted from model-supplied arguments. The external system must validate record ownership against that identity; a parameter schema does not prove ownership of an order number.

Credential kinds: `none`, `bearer`, `api-key` (`X-API-Key`). New secrets contain 8–4,096 printable ASCII characters. Existing AES-256-GCM encrypts an envelope bound to workspace, action, origin and authentication kind. Omission retains a previous credential only while that binding remains valid; changing origin/kind requires re-entry. `none` clears authentication and rejects a redundant secret. Activation requires a usable bound credential; withdrawal does not. Credential echoes in public definitions or selected outputs are rejected.

History and API responses expose only credential presence, never plaintext or ciphertext. Tables and RPCs are service-only; direct writes are denied even to the service role. The configuration and its version audit commit atomically. A failed audit rolls back the change. No WORM or reconstruction of older history is claimed.

The prepared transport has a complete eight-second deadline, 64 KiB request body, 128 KiB JSON response and 16 KiB response headers. It pins validated public DNS to verified TLS, rejects redirects/compression and never automatically replays a POST. Errors after starting dispatch are conservatively uncertain. An idempotency header does not prove provider support. A 2xx response and validated fields alone do not establish business completion.

Bounded errors and localized messages use `400 invalid/credential_required`, `409 changed/limit`, `403 forbidden`, `404 not_found`, `401 unauthorized`, `429 limited`, `402 read_only`, `503 unavailable`. Responses are private, uncached and omit credentials and SQL details. No real provider endpoint, model, customer message or financial operation was used for validation.
