# X4 — reseñas nativas de Judge.me

Primer proveedor de reseñas seleccionado: Judge.me, conectado a la tienda Shopify vigente mediante su clave privada, cifrada en servidor. No sustituye el catálogo ni las reseñas actuales de Mercado Libre. No depende de Make/n8n ni cambia los planes, el saldo o el consumo de IA. No genera ni publica respuestas con IA automáticamente.

## Controles y alcance

Configuración plegada dentro de **Ajustes → Canales**, solo para administrador con permisos vigentes. Consulta y respuesta plegadas dentro de **Productos**, con permiso de esa sección. Se cargan únicamente al abrir/refrescar, no en segundo plano al visitar las pantallas. Todos los controles y la API están tras `SHOW_RIVERZ_IMPROVEMENTS`; la etapa pública responde 404 privado/no-store antes de autenticar o consultar al proveedor. No se activan en producción para esta entrega.

La instalación liga de forma inmutable workspace, conexión actual Shopify, dominio canónico myshopify.com y revisión de configuración. Habilitar verifica lectura mediante GET, nunca publicando una respuesta de prueba. La clave privada no aparece en GET ni en el navegador. Deshabilitar conserva el ciphertext sin descifrarlo, incluso si ya no puede leerse o la tienda fue desinstalada; cambiar tienda exige una instalación distinta. No se infieren scopes OAuth ni se usan claves públicas de widget.

Listado por páginas de hasta 100 reseñas, máximo local de 50 páginas por consulta. Un límite o página completa no equivale a cobertura completa de la tienda: la interfaz indica la página y su cantidad, sin inventar totales. IDs externos de producto no se envían como `product_id`: Judge.me usa allí IDs internos y un filtro incorrecto puede devolver todas las reseñas.

Se proyectan únicamente ID, contenido, puntuación, condición de archivo, fechas y producto; se excluyen email, IP y el objeto del autor. Se muestran textos escapados, no HTML ni URLs multimedia. Las reseñas no se convierten en clientes o pedidos identificados de Riverz. `hidden` significa **archivada**, no publicada/no publicada; `hidden=false` y `updated_at` no demuestran la visibilidad de una respuesta.

## Una publicación revisada

La persona revisa el texto exacto, tienda y reseña, y confirma que revisó la reseña en su tienda y no hay una respuesta que deba conservar. Cambiar el texto borra ambas confirmaciones. Se acepta solo texto plano bien formado, hasta 4000 unidades UTF-16, sin HTML ni controles; no se reescribe silenciosamente lo aprobado.

Antes del único POST se registra el intento durable, se vuelve a leer la reseña exacta y se compara su snapshot, se comprueban de nuevo permisos, billing, tienda, conexión, revisión, archivo y límite diario, y se reclama el intento mediante nonce. Otro clic o actor no puede reclamarlo de nuevo. Se solicita explícitamente `send_reply_email:false`: no se implementan respuestas privadas por email.

Un HTTP 200 documentado acredita **creación aceptada por Judge.me**. No acredita visibilidad pública ni devolución de un ID de reply: el OpenAPI no documenta un esquema de respuesta 200 o readback del reply. La interfaz conserva `independentPublicationVerified:false` y `emailRequested:false`, sin convertirlos en comprobación de publicación o correo real. Tampoco se asegura causalidad externa si la tienda cambia entre GET y POST: el proveedor no ofrece una precondición de versión documentada en este contrato.

Sin contrato de idempotencia/reemplazo, timeout o pérdida del ACK después de reclamar deja el intento **incierto**, sin reenvío automático. Un intento preparado que nunca se reclamó puede cancelarse; un intento reclamado no se transforma en cancelado para permitir repetirlo. Expiración de preparado a los 3 minutos y de dispatching a incierto a los 2 minutos, también al consultar el recibo/página. Un ACK tardío de esa misma reclamación puede confirmar creación sin otro POST.

Hay una respuesta aceptada o no resuelta por reseña e instalación. Una nueva configuración no borra esa protección; borrar la conexión Shopify sí elimina sus datos por FK y una instalación futura requiere la revisión manual de la tienda de nuevo. La comprobación humana importa porque la API no devuelve respuestas previas.

El navegador guarda solo intento/conexión/reseña, antes del POST, en sessionStorage. Un doble clic comparte el mismo bloqueo síncrono; si falla ese guardado, no se publica. Ante ACK perdido o recarga se consulta únicamente el recibo con GET. La recuperación sigue disponible aunque el proveedor esté pausado o desinstalado. Un recibo distinto del intento, tienda, reseña o texto enviado no se toma por confirmación.

## Datos y operación

Migración aditiva `373_native_store_reviews.sql`: settings cifrados, proyección de reseñas y recibos de respuestas. RLS, sin acceso directo para anon/authenticated/service_role; solo RPC privadas con autoridad actual y search_path vacío. El preflight del build comprueba tablas privadas, RLS y permisos de funciones. El barrido diario existente elimina conexiones de tenants borrados después de la gracia configurada y mantiene los resultados inciertos como tales. No se ejecuta purga real durante QA.

Las pruebas usan base local y transportes ficticios. La comparación privada usa componentes reales y fixtures en memoria, sin llamadas al proveedor, publicación, correo, clientes, cargo o consumo de IA. El arnés simula ACK perdido después de una aceptación local conocida; no demuestra publicación real. Fallos de captura del preview nativo se registran como limitación, nunca como imágenes comprobadas.

## Fuentes primarias verificadas

- [OpenAPI vigente de Judge.me](https://judge.me/api/docs.yaml), recuperado por el subagente autorizado con Firecrawl el 2 de octubre de 2026: `/reviews`, `/reviews/{id}`, `/replies`, `PrivateAPIKey` mediante `X-Api-Token`, ShopDomain, estados y default de email. El esquema no garantiza mediante required todos los campos de review; el cliente exige archivo y fechas y falla de forma cerrada si no están. Los IDs enteros positivos/seguros son una restricción local.
- [Uso de la API de Judge.me](https://judge.me/help/en/articles/8409180-using-judge-me-api): límite per_page 100, separación de clave pública/privada, IDs internos de producto y ausencia de replies en lectura de reviews.

Estos documentos soportan el contrato, no una prueba de cuenta o permisos reales. La instalación por el equipo debe configurar la clave de esa tienda antes de usar el conector.
