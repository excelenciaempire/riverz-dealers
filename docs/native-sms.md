# X4 — SMS nativo con revisión y cuenta propia

Estado: implementado, pruebas/tipos/builds aprobados y comprobación funcional privada documentada. Publicación en curso; capturas y cierre visual pendientes por fallos del navegador compartido. UI pública apagada mediante el gate común. No sustituye WhatsApp, Gmail, Outlook, Zoho, campañas, plantillas ni automatizaciones existentes.

## Uso del negocio

El instalador configura una cuenta Telnyx del negocio y su número con SMS, perfil, organización y clave pública de firma. La cuenta debe tener habilitado su límite de gasto diario. Las credenciales se cifran en el servidor y no vuelven al navegador; el formulario permite conservarlas al modificar límites o desactivar. La identidad del número instalado no se cambia mediante una edición incidental.

El negocio recibe SMS en Bandeja y prepara una respuesta en el hilo. Para enviar debe existir consentimiento explícito, revisar el destinatario y confirmar el texto exacto. Editarlo invalida la confirmación. La interfaz muestra segmentos GSM/Unicode, límites por mensaje y diarios, estado y coste cuando el proveedor lo comunica. El proveedor factura a la cuenta del negocio; no cambia el precio del plan de Riverz ni debita su saldo de IA. No se promete una tarifa SMS antes de conocer la cuenta, destino y coste efectivo.

STOP bloquea inmediatamente; un consentimiento manual no lo reemplaza. START verificado permite reabrir el permiso. Además, cada envío comprueba los opt-outs actuales del perfil completo en Telnyx, incluso si STOP llegó a otro número del mismo perfil. La bandeja no atribuye identidad verificada de pedidos a un número de remitente SMS.

## Envío y recuperación

Cada intento tiene ID inmutable, actor, negocio, conversación, contacto, conexión, revisión de instalación, destinatario, texto y segmentos. Antes del único POST a Telnyx se comprueban permisos actuales, facturación, conexión, consentimiento, límites y contexto del caso en una transacción. La revisión vence a los tres minutos. La comprobación del proveedor es de lectura y no crea registros, permisos ni mensajes de prueba.

Un doble clic no crea otro envío. Una respuesta perdida conserva el intento y solo permite leer su comprobante. Un resultado incierto después de reclamar el envío bloquea un nuevo intento al mismo destinatario: no hay idempotency key documentada que permita repetir el POST con seguridad. Un callback sin ID de proveedor conocido no se asocia por parecido de texto o número. Un 404 del proveedor tampoco demuestra que no se envió. Los comprobantes separan aceptación, cola, incertidumbre y entrega confirmada; no convierten `queued` en `delivered` ni un coste ausente en cero.

Los callbacks de estado actualizan el mismo mensaje de Bandeja. Se conserva evidencia final ante eventos fuera de orden y ante un callback que llegue antes de la respuesta al POST. Las entradas usan una cola privada durable y un ID externo ligado a la conexión. Los fallos de ingreso se reintentan hasta cinco veces y quedan visibles al instalador; reintentar su ingreso no envía SMS. Desconectar o pausar conserva los eventos pendientes.

## Alcance inicial y operación

- SMS de texto y recepción. MMS, campañas SMS y respuestas autónomas de IA no están habilitados por este conector. Los adaptadores genéricos de IA, flujos y envío fallan antes de enviar SMS; las entradas suprimen respuesta automática.
- Una instalación y un perfil exclusivo por negocio. No comparte el perfil de un proveedor entre tenants.
- El instalador configura en Telnyx el webhook v2 `https://riverz.co/api/integrations/sms/webhook/<connectionId>` y el número autorizado. Riverz no provisiona números, registros de operador ni cuentas.
- Firmas Ed25519 sobre timestamp y bytes originales; tolerancia de cinco minutos, límite de 128 KB y vinculación exacta organización/perfil/número. Persistencia antes del ACK, IDs de evento deduplicados y leases con nonce.
- El preflight bloquea perfiles `mobile_only` porque no hay una comprobación de tipo de línea implementada; recorre hasta 20 páginas de 250 opt-outs y falla cerrado si la consulta queda incompleta.
- El límite de segmentos de Riverz es independiente del límite monetario de Telnyx. No se presenta como garantía de coste exacto. Unicode cuenta unidades UTF-16 y GSM extendido consume dos septetos.

## API, privacidad y reversión

`/api/integrations/sms` ofrece lectura de configuración, política de consentimiento y comprobantes; escritura de configuración, consentimiento, envío revisado y reintento de ingreso. Actor derivado de sesión, negocio seleccionado comprobado, CSRF, cuerpo estricto de 16 KB, límites de frecuencia y errores ES/EN sin claves. Roles de Bandeja y Ajustes se vuelven a comprobar en SQL. API, webhook y cron responden 404/no-store con el gate apagado, antes de realizar trabajo.

La migración 372 amplía los cuatro CHECKs de canal preservando los valores anteriores; crea tablas privadas sin acceso directo de roles del navegador ni de service_role. Solo RPCs server-side con permisos actuales pueden operar. No inserta datos de comercios, envía mensajes ni mueve dinero al instalarse. El guard de build exige `native_sms_ready()` cuando el entorno de producción está configurado.

El barrido diario conserva únicamente copias de eventos ya procesados durante 30 días; no elimina pendientes/fallidos. Tras la gracia de eliminación de un negocio se borran claves y controles propios. Los intentos siguen el ciclo de vida del historial del contacto/conversación y sus FK no bloquean el borrado de PII. No se ejecuta la purga sobre datos reales como QA. Apagar el gate y desactivar la conexión detiene envíos/colas; los comprobantes persisten y un intento incierto nunca se vuelve cancelado para permitir un reenvío.

## Evidencia y límites de validación

187 pruebas en 13 archivos, PGlite local, transportes ficticios, permisos, firmas, duplicados, revisión exacta, pérdida de respuesta, retención e ingreso. TypeScript completo y ambos builds pasaron. Lint de los archivos nuevos: cero errores/avisos; el análisis ampliado reproduce un error y siete avisos anteriores en pantallas existentes, comprobado contra HEAD para el error de ChannelsPanel. Correo existente: 107 pruebas pasaron en la corrida ampliada; Zoho SQL agotó cinco segundos con build concurrente y pasó aislado sin cambios (108 casos en 16 archivos comprobados).

[Evidencia privada](native-sms-qa.json): tres recorridos controlados EN/escritorio, ES/móvil y EN/móvil, más el primer recorrido ES/escritorio, con comprobantes ficticios y tres POST/cinco GET por recorrido; cero consultas nuevas en la variante actual. El escaneo inicial de geometría incluyó controles de la barra lateral desplazada fuera de pantalla; se conserva el resultado y las revisiones posteriores limitan el chequeo de controles a `main`. No se reescribe un falso inicial como aprobado. Cuarenta y cuatro fuentes y siete CSS coinciden con las compilaciones y el bundle privado. Las capturas del navegador compartido fallaron y después se perdió el host: no hay imágenes inspeccionadas ni cierre visual declarado. El seguimiento de errores de ejecución cubre los tres recorridos controlados, no toda la consola histórica.

372 instalada una vez el 2 de octubre de 2026: ready privado, invoker con search path fijo, tabla sin acceso directo y actor nulo rechazado. Solo metadatos y autorización nula. Las pruebas no acreditan envío físico, cobertura del operador, alta 10DLC/toll-free, estado de una cuenta, coste comercial ni entrega a un cliente. Se requiere una cuenta aprovisionada correctamente para uso real.

## Fuentes primarias verificadas con Firecrawl

- [Enviar un mensaje](https://developers.telnyx.com/api-reference/messages/send-a-message).
- [Consultar un mensaje](https://developers.telnyx.com/api-reference/messages/retrieve-a-message).
- [Número y capacidades](https://developers.telnyx.com/api-reference/number-settings/retrieve-a-phone-number-with-messaging-settings).
- [Perfil](https://developers.telnyx.com/api-reference/profiles/retrieve-a-messaging-profile).
- [Opt-outs](https://developers.telnyx.com/api-reference/opt-out-management/list-opt-outs).
- [Firmas y recepción de webhooks](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks).
- [Eventos de mensajes](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks).
- [Opt-in y opt-out](https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out).
- [Codificación y segmentos](https://developers.telnyx.com/docs/messaging/messages/message-encoding).

Contrato consultado el 2 de octubre de 2026; sin cuentas ni solicitudes a proveedores reales como QA.
