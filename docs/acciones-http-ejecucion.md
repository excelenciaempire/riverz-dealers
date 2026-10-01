# Ejecución de acciones HTTP: recibos y límites

## Español

Este incremento añade un ejecutor interno, reservado a compilaciones de comparación. No añade rutas de ejecución, herramientas del asistente, capacidades MCP, nodos de Flujos ni controles visibles. Los adaptadores se conectarán por separado y deberán obtener actor, confirmación e identificador de invocación de estado protegido del servidor. Los argumentos del cliente o modelo nunca pueden definir ese contexto.

El ejecutor comprueba un usuario humano vigente y permiso de Automatizaciones. POST requiere administrador y confirmación explícita del servidor; la transacción también exige suscripción con escritura permitida. Usar una conversación exige Bandeja, conversación/contacto del mismo negocio e identidad actual exacta. Gmail, Outlook y Zoho exigen que el actor sea dueño de la conexión. No se concede autoridad de administrador a un asistente virtual. El destino externo sigue siendo responsable de comprobar que un número de pedido pertenece a la identidad recibida.

Antes del envío, la RPC exclusiva del servicio crea un recibo duradero y una concesión privada. Vuelve a comprobar negocio, dueño/membresía, secciones, acción activa, versión, contacto y buzón, bloqueando sus filas durante la transacción. La autorización se establece en ese punto; no se mantiene una transacción abierta durante la llamada externa. Las tablas usan RLS y no permiten escritura directa del servicio. La configuración existente conserva su historial atómico.

El recibo conserva negocio, acción/versión, actor, conversación opcional, hashes de invocación y solicitud, fechas, código de resultado y exclusivamente la respuesta seleccionada. No guarda argumentos libres, cuerpo bruto, destino, credencial ni error privado del proveedor. Los campos seleccionados pueden contener datos personales según la definición elegida por el negocio; no se presentan como anónimos. La concesión privada nunca forma parte de la respuesta del ejecutor.

| Estado | Significado | Repetición de la misma invocación |
| --- | --- | --- |
| `claimed` | Recibo creado; resultado aún desconocido, incluido un proceso interrumpido | Devuelve el estado guardado, sin enviar |
| `acknowledged` | Respuesta 2xx, campos validados y recibo final confirmado | Devuelve los campos guardados, sin enviar |
| `blocked` | Fallo demostrado antes del despacho | Devuelve el fallo guardado, sin enviar |
| `uncertain` | El despacho pudo ocurrir; no hay resultado validado y confirmado | Devuelve el estado guardado, sin enviar |

Un nuevo identificador no evita la protección: para POST, otra invocación con el mismo hash de solicitud/conversación se bloquea mientras exista un recibo `claimed` o `uncertain`. Tras un fallo anterior al despacho puede usarse una nueva invocación confirmada. No hay recuperación automática de concesiones, reintentos, vencimiento ni reconciliación manual implementada todavía. La retención y consulta operativa de recibos se ampliarán con los adaptadores; no se afirma historial completo ni almacenamiento inmutable.

La clave enviada al proveedor queda ligada a negocio, acción e invocación. No demuestra que el proveedor implemente idempotencia. Los límites del [transporte y configuración](acciones-http-configuracion.md) siguen vigentes. La respuesta seleccionada y serializada se limita adicionalmente a 64 KiB. Si el proveedor devuelve tipos incorrectos, refleja la credencial, falla tras el despacho o no puede confirmarse el recibo final, no se devuelve éxito. `acknowledged` confirma intercambio y campos; no prueba cumplimiento de una operación comercial. Un replay devuelve una observación guardada, no datos actuales del proveedor.

La migración 331 incorpora RPCs de reclamar/finalizar y el guard de despliegue verifica firmas/columnas mediante contexto nulo y consultas `limit=0`. Las pruebas usan base, DNS y transporte simulados; no hacen llamadas externas reales ni ejecutan operaciones de clientes.

## English

This increment adds an internal executor restricted to comparison builds. It exposes no execution routes, assistant tools, MCP capabilities, Flow nodes or visible controls. Later adapters must derive actor identity, confirmation and invocation identifiers from protected server state; client/model arguments cannot supply this authority.

A current human user needs Automations permission. POST also requires administration, server-confirmed approval and writable billing. Conversation context requires Inbox permission and current same-workspace conversation/contact identity. Personal Gmail, Outlook and Zoho connections must belong to the actor. Virtual assistants are not treated as human administrators. The destination remains responsible for validating ownership of external records such as order numbers.

Before dispatch, a service-only RPC stores a durable receipt with a private lease. It rechecks current authority, active action/version, exact contact snapshot and mailbox ownership, holding row locks within that transaction. Authorization is established at claim time; the transaction does not remain open during the external request. RLS applies and direct service writes are denied.

Receipts store workspace, action/revision, actor, optional conversation, invocation/request hashes, timestamps, bounded status/error and selected output only. They omit free arguments, raw body, URL, credentials and private provider errors. Selected fields may contain personal data according to the configured definition. The lease is never returned to callers.

`claimed` means unresolved, including an interrupted process; `acknowledged` means a validated 2xx exchange with confirmed final persistence; `blocked` proves failure before dispatch; `uncertain` means dispatch may have occurred without a confirmed usable result. Replaying any state returns the saved receipt without sending again. POST also rejects a new invocation identifier for the same request/conversation hash while a `claimed` or `uncertain` receipt exists. A new confirmed invocation is possible after a pre-dispatch failure. No automatic retries, lease recovery, expiry, manual reconciliation, operational receipt UI or retention policy are implemented in this increment.

The provider idempotency key binds workspace/action/invocation, but does not prove provider support. Existing bounded public HTTPS transport and [configuration limits](acciones-http-configuracion.md) remain in force; serialized selected output is additionally bounded to 64 KiB. Invalid output, reflected credentials, uncertain dispatch and failed final persistence cannot report success. Acknowledgement is not evidence of completed business fulfilment; replay returns a saved observation rather than fresh provider data.

Migration 331 adds claim/finalization RPCs. The deployment guard checks their null-context failures and table columns with `limit=0`, without reading receipt/customer data. Tests use local database fixtures and mocked transport; they perform no real provider, model, customer or financial operations.
