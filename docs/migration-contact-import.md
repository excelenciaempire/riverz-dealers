# X2 — importación de contactos revisada

Esta entrega amplía la revisión CSV local con preparación persistente, confirmación explícita y comprobantes. La importación CSV vigente se conserva. Los controles nuevos y `/api/contacts/migrations` solo están disponibles en un build de comparación; producción mantiene la UI actual.

## Recorrido y autoridad

1. Elegir herramienta, etiqueta de cuenta y columnas del CSV. La vista local no envía el archivo.
2. **Comprobar contactos existentes** envía el CSV a Riverz, vuelve a analizar sus bytes y guarda una revisión privada. No crea contactos. El límite es 2 MB UTF-8, 5.000 registros, 64 columnas y 4.096 caracteres por celda.
3. Revisar conteos y páginas de 25 filas. Los nuevos contactos se distinguen de existentes y excluidos. El mismo correo no acredita identidad; el teléfono o ID existente se conserva sin sobrescribir datos.
4. Marcar la confirmación y solicitar la importación de la revisión exacta. La API deriva el actor de la sesión, exige el negocio seleccionado, CSRF y límites de solicitudes. SQL comprueba de nuevo propietario/administrador, sección Contactos, negocio activo y facturación vigente.
5. Consultar o recuperar el comprobante del mismo actor y negocio. Solo se guarda su UUID en el navegador; no se guardan nombres, teléfonos, correos o snapshots en localStorage.

La etiqueta de cuenta es procedencia declarada, **no una verificación de propiedad de la cuenta externa**. Los nombres Kommo, Leadsales, ManyChat, Chatwoot, Gorgias y Zendesk identifican posibles CSV de origen; no equivalen a seis conectores API implementados.

## Qué se conserva y qué se crea

- Los contactos actuales se omiten sin modificar nombre, correo, teléfono, consentimiento o enlaces.
- Los nuevos llevan teléfono/correo de origen `afirmado`, unión bloqueada, `opted_out=true` y motivo `migration_consent_unverified`. No se afirma `wa_id` ni `external_id` de WhatsApp.
- La procedencia enlaza únicamente contactos realmente creados. Una FK compuesta impide apuntar a un contacto de otro negocio. Nunca se asocia arbitrariamente el ID externo a un contacto existente.
- Un ID previamente importado con teléfono cambiado se excluye para revisión. Eliminar el contacto elimina su enlace de procedencia; el comprobante conserva el conteo histórico, no afirma que ese contacto siga existiendo.
- No hay envío, campaña, llamada, consumo de modelo, reserva de cupo de atención IA, modificación de pedidos ni cobro en este recorrido.

El consentimiento seguirá sujeto a los mecanismos reales de Riverz y del canal. Este importador no habilita campañas por haber leído un CSV.

## Atomicidad, repetición y cambios

El UUID y hash del CSV exacto, columnas, proveedor y cuenta hacen inmutable una preparación repetida. La revisión incluye su propia huella vinculada al actor y negocio. La confirmación inserta contactos, procedencia y comprobante en una sola transacción. Un fallo revierte todas las filas. Una solicitud repetida devuelve el mismo comprobante y no duplica contactos.

Antes de confirmar, SQL vuelve a clasificar el archivo frente a los contactos y procedencias actuales. Un cambio de clasificación exige una revisión nueva; no se modifica silenciosamente el conteo aprobado. Las importaciones de Riverz se serializan por negocio con la misma clave de bloqueo de identidad. **Esto no impone unicidad mundial de teléfono ni evita que otro adaptador cree a la vez una ficha independiente**: no todos los adaptadores toman ese bloqueo. La importación tampoco une esas fichas; mantiene la identidad sin verificar y la unión bloqueada.

Cada revisión pertenece al actor que la preparó, incluso entre administradores del mismo negocio. Quitar permisos o borrar el negocio bloquea tanto el comprobante como la confirmación. Un comprobante ya confirmado se puede recuperar en modo lectura; no ejecuta una escritura comercial nueva.

## Retención

La confirmación y lectura de una revisión vencen a los 30 minutos. Al leer una revisión vencida se elimina su payload; al confirmar se elimina inmediatamente la copia de nombres, correos y teléfonos del staging. Hay hasta diez revisiones pendientes por negocio.

El barrido diario de privacidad existente elimina payloads vencidos pendientes de limpieza y detalles de comprobantes de más de 30 días, o de negocios borrados. **No se promete borrado físico exactamente a los 30 minutos**: depende del siguiente barrido; la autorización vence independientemente. El barrido está limitado a 500 revisiones por ejecución. Conserva conteos históricos y los IDs de procedencia asociados a contactos activos para impedir reimportaciones. Esos IDs pueden contener datos personales; no se describen como anónimos.

## Alcance de la validación

**178 pruebas en ocho archivos**, TypeScript completo con heap de 4 GB, lint sin errores/avisos y compilaciones completas normal/comparación. [Evidencia de esta entrega](migration-contact-import-qa.json).

Las pruebas PostgreSQL locales usan PGlite y fixtures; cubren permisos actuales, privacidad por actor/negocio, facturación, revisión vencida, reintentos, reversión completa, consentimiento, FK de negocio, paginación, retención y 5.000 filas. Pruebas de API y servicio cubren bytes reales, UTF-8, CSRF, scopes inyectados, presupuestos y respuestas inválidas. No sustituyen una importación real de un cliente.

La comparación local usa un adaptador **ficticio en memoria** para ejercitar revisión, casilla, confirmación y recuperación en ES/EN, escritorio/móvil. Sus conteos no acreditan escrituras en producción. El servidor sigue bloqueando APIs HTTP reales y conexiones externas.

La migración 360 se instaló una sola vez; la comprobación en producción lee metadatos de esquema y envía identidades nulas, que fueron rechazadas. No leyó CSV, contactos o mensajes reales, ni llamó el barrido de privacidad. El build exige `contact_migration_ready()` mediante un checker dedicado.

## Estado de X2

Esta entrega construye **contactos por CSV con revisión y comprobante**. La extracción autenticada de las herramientas externas, historial de conversaciones, notas y adjuntos todavía pertenece al trabajo de X2 en curso. No se declara la migración completa por terminar este recorrido.
