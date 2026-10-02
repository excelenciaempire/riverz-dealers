# X2 — contactos nativos de Chatwoot con revisión separada

Esta entrega construye el primer conector de lectura de contactos, sobre la importación CSV revisada vigente. No declara completos X2, seis conectores, el archivo de conversaciones o los adjuntos. Los seis nombres de origen disponibles para CSV continúan siendo etiquetas de procedencia. No se consultó ninguna cuenta real de Chatwoot como QA.

## Recorrido

1. Un administrador autorizado proporciona el origen HTTPS, número de cuenta y token de Chatwoot. Riverz deriva su usuario y negocio seleccionado desde la sesión. La dirección solo admite el origen, sin ruta, credenciales, query o fragmento; IPv6 no forma parte de este primer contrato.
2. Se crea un trabajo privado, con ID inmutable. El token se guarda con AES-256-GCM ligado al usuario, negocio, ID, origen y cuenta; una huella HMAC con separación de dominio permite recuperar el mismo intento aunque el IV del cifrado cambie. Ni el token ni los contactos se guardan en localStorage: solo UUIDs de recuperación. El formulario borra el token al recibir la creación y al cerrar o cambiar de negocio.
3. El scheduler personalizado reclama páginas con leases de 90 segundos. Antes de cada lectura vuelve a comprobar autoridad y lease. Conserva cursor y páginas proyectadas para continuar después de un reinicio. Un worker abandonado no puede publicar sobre una lease nueva.
4. Al terminar, destruye la credencial. El usuario prepara una revisión distinta, de 30 minutos, con un ID nuevo. La lectura del conjunto completo es exclusivamente del servicio; el navegador no puede reemplazar las filas recogidas. La migración 362 vuelve a bloquear y comprobar el trabajo listo dentro de la transacción que prepara la revisión; cancelación, vencimiento o cambio de cohorte entre lectura y preparación impiden crearla.
5. La revisión conserva los conteos de nuevos, existentes y excluidos, la casilla de confirmación y el comprobante transaccional de la [importación vigente](migration-contact-import.md). Traer contactos y preparar la revisión no crean contactos. Los nuevos se importan afirmados, sin identidad de WhatsApp acreditada, unión bloqueada y exclusión de campañas por consentimiento no verificado.

Los contactos sin teléfono internacional válido se muestran como excluidos: este primer importador no crea fichas basadas exclusivamente en correo. Los contactos existentes conservan sus datos. Un ID de Chatwoot no se convierte en `wa_id` o identidad verificada de transporte.

## Alcance y límites

La lista oficial devuelve 15 contactos por página. Se fijan `sort=name` e `include_contact_inboxes=false`, se comprueba el número de página y el total y se rechazan páginas cortas inesperadas, cambios visibles o IDs duplicados entre páginas. Se proyectan únicamente ID, teléfono, nombre y correo; empresa queda vacía. No se conserva el JSON completo, los atributos personalizados, credenciales de agentes, avatares o identidades de inbox. La autorización de un token a un número de cuenta no demuestra que el comercio sea dueño de esa cuenta externa.

Esto es una extracción observada, no una fotografía transaccional de la fuente. Aunque se detectan cambios de total e IDs repetidos, reemplazos concurrentes con el mismo total no pueden descartarse usando esa API. No se anuncia integridad histórica o congelación de Chatwoot.

Máximo 5.000 contactos, tres trabajos pendientes y diez conjuntos activos retenidos por negocio. Cada respuesta JSON está limitada a 128 KB y ocho segundos, sin redirecciones, con TLS y DNS público fijado. Una página legítima más grande se detiene explícitamente; no se trunca. El conjunto proyectado tiene un máximo de 8 MB; la revisión conserva el límite CSV de 2 MB de UTF-8 real. Si supera ese límite, se informa y no se importa una parte silenciosamente.

Solo se usa GET y el header fijo `api_access_token` en endpoints admitidos de Chatwoot. El usuario no elige métodos o headers. La credencial genérica de acciones HTTP sigue teniendo su contrato anterior; el conector no amplía sus permisos.

Cada ejecución reclama hasta dos trabajos por ronda, ocho rondas, con presupuesto de 40 segundos para empezar nuevas rondas y respuestas individuales de hasta ocho segundos. Una ronda ya iniciada puede terminar después de ese presupuesto. El avance exitoso obtiene una lease nueva para la página siguiente. Hay hasta tres reintentos de errores transitorios con pausas de uno, dos y cuatro minutos. Un error de autenticación, datos cambiados, límite, revocación o credencial inválida no se trata como transitorio. No hay llamadas a modelos, envíos, reservas de contactos o escrituras en Chatwoot.

## Permisos y privacidad

La migración 361 mantiene tabla sin acceso directo incluso para `service_role`, RLS y nueve RPCs privados con search path fijo. La migración 362 añade la preparación transaccional desde la fuente activa. Sus comprobaciones de disponibilidad son privadas y de metadatos. La API exige sesión, negocio actualmente seleccionado, CSRF en escrituras, acciones estrictas, máximo de 64 KB reales por body, límites por usuario/negocio y respuestas sin caché. SQL exige administrador con acceso a Contactos y negocio activo; una nueva extracción o revisión exige facturación que permita escritura. Leer el comprobante o cancelar puede seguir disponible en modo de lectura.

La autorización se comprueba al reclamar, antes de empezar la lectura y al almacenar la página. Una revocación no retira una solicitud HTTP que ya comenzó; sí impide que su resultado se acepte. El worker elimina los datos y credenciales cuando detecta la revocación. Las respuestas y logs no incluyen diagnósticos crudos ni tokens de la fuente.

Los trabajos vencen a las dos horas. Lectura, preparación y publicación comprueban ese vencimiento independientemente del scheduler. Los datos y credenciales se eliminan en finalización, error definitivo, cancelación, lectura vencida o el barrido existente de privacidad; este último limpia hasta 500 elementos por lote y también negocios eliminados. La eliminación física de trabajos abandonados depende del barrido diario, y no se promete exactamente a las dos horas. Metadatos terminales de más de 30 días se borran en ese barrido.

Cancelar la extracción borra su conjunto traído. Una revisión ya preparada tiene su propia retención de 30 minutos, y un comprobante de contactos ya importados conserva su política separada. Cancelar no deshace contactos confirmados ni borra comprobantes históricos. No se ejecutó el barrido real como QA.

En el build público, `NEXT_PUBLIC_RIVERZ_UI_STAGE` sigue sin configurar: formulario y APIs nuevos permanecen cerrados y el cron no se incorpora al scheduler. El GET de cron con el flag apagado no crea heartbeat ni reclama la cola. La comparación local usa fixtures en memoria y bloquea red mediante CSP; sus comprobantes no demuestran extracción real de cuentas.

## Base de historial, sin atribuirle entrega completa

Se construyó y probó una proyección de mensajes de Chatwoot: conserva privado/público, tipo, fecha, texto literal y referencias de adjuntos, sin credenciales de remitentes. Verifica contexto de cuenta/conversación/inbox y orden de IDs/fechas; rechaza formatos de adjuntos no soportados. No descarga esos archivos, no inserta mensajes en la bandeja ni activa IA o automatizaciones. El importador de historial y su almacenamiento privado son trabajo separado.

La implementación oficial pagina mensajes por ID pero ordena por fecha. Por eso se rechaza un orden visible incompatible, y una página corta no acredita que todo el historial haya llegado. No se afirma cobertura completa de mensajes insertados con fechas anteriores.

## Fuentes primarias consultadas

- [Lista de contactos](https://developers.chatwoot.com/api-reference/contacts/list-contacts): credencial, número de cuenta y paginación.
- [Conversaciones](https://developers.chatwoot.com/api-reference/conversations/conversations-list) y [mensajes](https://developers.chatwoot.com/api-reference/messages/get-messages): contratos de la base de proyección, todavía sin importador de historial.
- [Controlador de contactos](https://github.com/chatwoot/chatwoot/blob/develop/app/controllers/api/v1/accounts/contacts_controller.rb) y [respuesta de contactos](https://github.com/chatwoot/chatwoot/blob/develop/app/views/api/v1/accounts/contacts/index.json.jbuilder): paginación efectiva y campos.
- [MessageFinder](https://github.com/chatwoot/chatwoot/blob/develop/app/finders/message_finder.rb) y [modelo de mensaje](https://github.com/chatwoot/chatwoot/blob/develop/app/models/message.rb): orden, tipos y límites del historial.

Las fuentes de `develop` describen esa versión; no acreditan la versión desplegada, permisos o configuración de una cuenta particular. Se consultó documentación pública, sin tokens de fuentes reales.
