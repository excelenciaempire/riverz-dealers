# Gorgias / Zendesk: contactos por cursor

ES: lectura privada de contactos con token OAuth autorizado, origen exacto y revisión humana independiente. La UI pública sigue apagada; la comparación utiliza datos ficticios. No hay IA, mensajes, automatizaciones, pedidos, dinero ni cambio de pricing.

EN: private contact reads with an authorized OAuth token, exact origin and separate human review. Public UI remains disabled; the comparison uses fictional data. No AI, messages, automations, orders, money or pricing changes.

| Fuente | Contrato construido | Identidad y límites |
| --- | --- | --- |
| Gorgias | `GET /api/account` antes de cada `GET /api/customers?limit=25&order_by=created_datetime:asc&cursor=…`. Exige `object:list`, `data` y `meta.next_cursor` explícito. | Cuenta activa y dominio devuelto iguales al origen autorizado. Nombre, email y teléfonos presentes en `channels` de tipo `phone`; distintos valores quedan vacíos. |
| Zendesk | `GET /api/v2/users.json?page[size]=25&role=end-user&include_boundary_indicators=true&page[after]=…`. Exige `users`, `meta.has_more` y `meta.after_cursor`. | Host oficial exacto, OAuth Bearer, filtro de clientes finales y validación de cada `role`. No se inventa un ID numérico de cuenta. |

La especificación OpenAPI de la lista de Gorgias presenta un array, mientras la documentación de paginación describe el wrapper con cursores. Esta implementación acepta exclusivamente el wrapper documentado: un array o cursor final ausente genera error, no una extracción completa ficticia. La lista puede omitir teléfonos; esos registros se muestran excluidos en la revisión existente. No se extraen teléfonos de notas, pedidos, integraciones o emails, ni se inventa consentimiento. La compatibilidad de una cuenta comercial exige autorización y una prueba de su respuesta real; los fixtures no la acreditan.

Solo cinco campos: ID, nombre, teléfono, email y empresa vacía. IDs de organización no se presentan como nombres de empresas. Campos privados, fotos, notas, etiquetas y flags `verified`/opt-in no pasan a la revisión. Cualquier ID repetido, cursor actual repetido o ciclo histórico rechaza la página. No se siguen enlaces del proveedor. Las consultas reconstruyen host, ruta y parámetros permitidos; DNS público fijado, TLS verificado, sin redirecciones, 8 segundos y 128 KB por respuesta.

Hasta 5.000 contactos, 201 páginas y 8 MB por preparación. El total permanece desconocido hasta el fin explícito. Una página corta puede continuar si trae cursor; una página vacía no terminal es error. Un límite excedido falla y borra datos/credencial, sin presentar una importación parcial como completa. Cambios concurrentes del proveedor pueden alterar el listado; no es un snapshot atómico.

Se reutilizan la cola privada independiente, autorización por negocio/actor actual, leases de 90 segundos, AES-GCM, reintentos acotados, cancelación y vencimiento de dos horas. El cursor actual y hashes de los anteriores quedan solo en la tabla privada y se borran en todo estado terminal mediante trigger. Los snapshots del navegador no contienen cursores ni token. Los metadatos de origen/trabajo conservan la política de 30 días de la entrega anterior.

La migración 368 amplía las funciones hacia adelante y conserva inmutable 367. La función de registro por cursor es exclusiva de Gorgias/Zendesk; Kommo/ManyChat conservan su RPC y sus invariantes. Preparar una revisión bloquea el trabajo vigente dentro de la misma transacción. Cancelar/vencer o perder permiso impide preparar o confirmar datos nuevos. La importación conserva bloqueo de unión, exclusión de campañas y confirmación humana; no acredita identidad de WhatsApp.

Se necesita un token OAuth ya autorizado para leer la cuenta. Este bloque no crea una app pública, compra planes, solicita scopes, inicia OAuth, almacena refresh tokens ni afirma aprobación comercial del proveedor. API keys Basic y alta OAuth completa son flujos distintos. Ninguna prueba de esta entrega accede a una cuenta real.

Fuentes primarias revisadas el 2026-10-02:

- [Gorgias: paginación](https://developers.gorgias.com/reference/pagination), [lista de clientes](https://developers.gorgias.com/reference/list-customers), [cuenta](https://developers.gorgias.com/reference/get-account) y [objeto cliente](https://developers.gorgias.com/reference/the-customer-object).
- [Gorgias: OAuth](https://developers.gorgias.com/docs/set-up-oauth2-app-store) y [canales del cliente](https://developers.gorgias.com/docs/receive-and-respond-to-tickets-from-a-third-party-app). El tutorial antiguo de canales no se usa como contrato de offset; se usa la paginación actual por cursor.
- [Zendesk: usuarios](https://developer.zendesk.com/api-reference/ticketing/users/users/) y [cursores](https://developer.zendesk.com/documentation/api-basics/pagination/paginating-through-lists-using-cursor-pagination/).

CSV permanece disponible para las seis fuentes. No se declara construido el API de Leadsales o el historial nativo de estas fuentes por agregar contactos. [QA propia](migration-native-cursors-qa.json).
