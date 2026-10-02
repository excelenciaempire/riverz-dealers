# X2: historial privado de Chatwoot

Esta entrega amplía el conector de contactos con un archivo privado revisable. La UI y las nuevas operaciones siguen condicionadas al flag de comparación, apagado en producción. No completa por sí sola los seis conectores ni los demás paquetes X.

## Recorrido

1. Usar un comprobante de importación de contactos completado por el mismo usuario y negocio. El origen y número de cuenta deben coincidir. Solo entran las referencias de contactos efectivamente creados por ese comprobante; un contacto existente excluido de la importación no se enlaza automáticamente.
2. Autorizar otra lectura mediante un token explícito. La credencial se cifra con GCM, ligada a usuario, negocio, trabajo, comprobante y fuente; no se reutiliza el token ya borrado de la extracción de contactos. Se captura un lote de hasta 100 referencias, ordenado por hash estable, con cursor para otro lote.
3. Recorrer las conversaciones y mensajes por pasos persistentes. El origen puede cambiar durante la lectura: el resultado es historial observado, no una instantánea transaccional o prueba de exhaustividad del proveedor. Ante límites, ciclos, versiones incompatibles, permisos perdidos o cursores inconsistentes, el trabajo se detiene explícitamente.
4. Traer adjuntos a un bucket separado y privado. Se cifran las referencias temporales y se borran al guardar cada archivo. Descargar requiere la sesión actual, el negocio seleccionado y autoridad vigente sobre el archivo. No se entregan URLs públicas o firmadas al navegador.
5. Revisar la muestra y los totales, marcar la casilla y confirmar la revisión exacta. El archivo confirmado se conserva aparte de la bandeja, las herramientas del asistente y los mensajes vivos. No genera eventos, campañas, llamadas de modelos, mensajes ni operaciones sobre pedidos o dinero.

## Fuente y alcance

El endpoint de conversaciones de contacto devuelve inicialmente una muestra de hasta 25 conversaciones ordenadas por actividad. El controlador actual permite consultar vecinos mediante `conversation_id`, usando el `display_id` de la API. La recolección recorre ambas direcciones y comprueba que la muestra inicial aparece en lo observado. Las vistas previas de mensajes no se tratan como historial. Las respuestas se proyectan: no se guardan credenciales de asesores, JSON completo ni atributos arbitrarios. [Documentación de contactos](https://developers.chatwoot.com/api-reference/contacts/contact-conversations), [controlador vigente](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/controllers/api/v1/accounts/contacts/conversations_controller.rb), [presentador](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/presenters/conversations/event_data_presenter.rb).

Las páginas de mensajes usan `before` y se consulta una página vacía para observar el límite anterior. IDs y fechas deben permitir continuar sin saltos. El modelo usa el `display_id` como referencia pública de conversación. Se conservan las notas privadas como notas privadas; `content_attributes.deleted=true` elimina texto y referencias de adjuntos de la proyección, manteniendo un marcador de eliminación. Esto no sincroniza eliminaciones posteriores a la lectura. [Modelo](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/models/message.rb), [controlador de mensajes](https://raw.githubusercontent.com/chatwoot/chatwoot/develop/app/controllers/api/v1/accounts/conversations/messages_controller.rb).

El código oficial consultado pertenece a `develop`, no demuestra la versión, configuración o permisos de una instalación privada. El token debe estar autorizado en origen; un formulario válido no acredita propiedad de la cuenta. La correspondencia con un contacto importado sigue siendo una referencia afirmada, no identidad de canal verificada.

## Límites y privacidad

- Por lote: 100 contactos, 500 conversaciones, 10.000 mensajes, 100 adjuntos, 16 MB de datos proyectados y 50 MB de archivos. Máximo 8 MB por archivo. No se oculta truncamiento ni se convierte una colección parcial fallida en archivo completo.
- Hasta tres preparaciones activas y cien archivos confirmados por negocio. Dos leases por ronda, ocho rondas y un límite para iniciar rondas de 40 segundos. Cada operación iniciada tiene su propio límite; terminar una descarga y guardado en curso puede superar esos 40 segundos.
- Preparación de 24 horas, comprobada en lectura, claim y confirmación. La caducidad lógica no promete borrado físico inmediato de objetos. El barrido diario existente revisa hasta 500 archivos y rota controles; el cron privado activo también retira hasta 20 objetos huérfanos por ejecución.
- Autoridad de administrador/contactos, negocio vigente y facturación con escritura antes de recolección y confirmación. La lectura y cancelación siguen disponibles en modo de solo lectura. Solo el actor que preparó el archivo puede consultarlo, aun si otro administrador conoce su ID.
- Cancelar elimina la preparación y sus credenciales. Borrar un archivo confirmado requiere una acción distinta. Ambos conservan los contactos ya importados. Perder las referencias de contacto, el comprobante, usuario o negocio bloquea acceso y permite limpieza del archivo.
- Las intenciones de subida se registran antes de escribir en Storage. Un resultado de subida perdido no desencadena un borrado inmediato a ciegas. Los huérfanos conservan su ruta exacta para limpieza después del margen de 120 segundos; un lease vencido no puede publicar una respuesta tardía. El registro sobrevive a la cascada del archivo o negocio.
- Bucket privado con política restrictiva para `anon` y `authenticated`, incluso si existen políticas permisivas amplias. Las tablas y RPCs no exponen payloads o credenciales directamente a esos roles ni al cliente de servicio fuera de RPCs.
- HTTPS, resolución DNS pública fijada a la conexión TLS, ocho segundos y límites de bytes en descargas de origen. Tres redirecciones revalidadas, sin tokens, cookies ni cabeceras arbitrarias. Sin registro de URLs firmadas o errores crudos. Storage usa el proyecto configurado, no destinos suministrados por el cliente.
- Entrega de archivos con `attachment`, `nosniff`, CSP y caché privada desactivada. Hash SHA-256 de bytes guardados verificado antes de entregar; no equivale a análisis antivirus o certificación del contenido. Se vuelve a comprobar autoridad después de leer Storage. Una revocación no puede retirar una consulta de origen ya iniciada, pero impide guardar o entregar resultados tras el siguiente control.

## Operación

API privada `/api/contacts/migrations/history`: estado, páginas de mensajes y descarga; acciones start, confirm, cancel y delete. CSRF, sesión real, cabecera de negocio seleccionado, cuerpos máximos de 64 KB y límites de consultas/escrituras. Con flag apagado devuelve 404 antes de leer sesión, credenciales o cuerpo. El scheduler personalizado reutiliza `contact-migrations`; no añade proveedores de automatización ni servicios cron de pago.

Migración 363: tablas privadas, quince RPCs de alcance fijo, guard de build, bucket y política restrictiva. Instalada una vez y comprobada únicamente con metadatos y cinco llamadas de identidad nula. No se reclamaron colas, consultaron fuentes/clientes, subieron adjuntos o ejecutaron borrados reales para QA. Las pruebas SQL usan PGlite y fixtures aislados; la comparación responde en memoria.

La recolección, guardado y revisión no llaman modelos ni descuentan saldo de IA. Storage y tráfico de infraestructura tienen coste técnico; esta entrega no modifica precios, facturación ni límites comerciales del producto.
