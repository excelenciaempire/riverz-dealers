# Políticas específicas de cambios y devoluciones

La política general del negocio ya existe en `PerfilOperativo.returnPolicy` y se conserva. La ampliación permite declarar condiciones para un producto concreto desde su ficha o el Operador, sin reorganizar la navegación. UI, rutas, herramientas nuevas y carga de contexto específico permanecen ocultas fuera de comparación.

## Declaración y versiones

Un administrador vigente con acceso a Productos puede indicar tratamiento de solicitudes, plazo de uno a 365 días o sin especificar, referencia de compra o entrega, soluciones contempladas y condiciones. El plazo significa días de 24 horas transcurridas; un campo vacío no significa ilimitado. No ofrecido o consultar al equipo conserva revisión de excepciones y no activa un rechazo automático.

Las soluciones son posibilidades declaradas, no una prueba de compatibilidad de un proveedor. Reembolso, reposición, cambio y crédito conservan sus motores, permisos, revisiones y aprobaciones actuales. Guardar condiciones no ejecuta ninguna de esas operaciones.

Cada cambio crea una versión y evento con actor real, fecha y contenido; se actualizan juntos en una transacción. La versión esperada evita sobrescribir una edición concurrente. El mismo identificador y contenido recupera su resultado previo sin otra escritura. Un identificador reutilizado con otro producto, actor o contenido genera conflicto. El editor consulta nuevamente la versión actual después de recibir el resultado: un comprobante de escritura anterior no debe presentarse como la configuración vigente.

Retirar la política crea otra versión con contenido nulo y conserva el historial; la política general sigue existiendo. El almacenamiento se elimina en cascada cuando se elimina el producto o negocio. No se cambian campos del catálogo, investigación, material compilado, precios, pedidos o términos generales.

## Permisos y canales de edición

Las tablas son privadas sin lectura/escritura directa de clientes o rol de servicio. Las RPC de la migración 354 usan esquema de búsqueda fijo y comprueban producto y negocio actuales, membresía, sección y administración para escritura. El propietario real puede actuar sin una membresía adicional. Una suscripción de solo lectura impide nuevas ediciones y permite recuperar un comprobante idéntico previo después de comprobar el acceso actual.

El lector humano devuelve snapshot y permiso de edición en el mismo snapshot SQL. La API exige sesión actual, negocio seleccionado, CSRF y JSON UTF-8 acotado a ocho KB. El usuario no puede suministrar actor o negocio. Respuestas privadas y errores localizados no exponen detalles del proveedor o base de datos.

MCP conserva el usuario que emitió el token y comprueba la sección Productos; un agente puede consultar y solo un administrador puede editar. El Operador prepara la misma escritura con versión y revisión humana obligatorias. No se permite aprender una política permanente de afirmaciones del cliente ni de una propuesta no aprobada.

## Contexto del superasistente

Solo se consultan productos ya admitidos al catálogo actual del asistente. La RPC verifica negocio, asistente activo, alcance y asignaciones vigentes; se acota a ochenta productos distintos. No se consulta el catálogo de otra cuenta. Una lectura fallida, incompleta, incoherente o revocada se marca no disponible; no se interpreta como ausencia de política. Los productos que exceden el límite también requieren revisión.

La ficha del producto detectado y las fichas completas ya existentes reciben el contenido con versión exacta, escapado como datos de referencia. El resto del catálogo indica que existen condiciones específicas que deben consultarse, sin introducir todos sus textos en cada turno. Una versión nueva cambia el contexto correspondiente; no se modifica el material persistido ni se usa una caché nueva que ignore retiradas. El catálogo conserva precios, moneda y conocimientos anteriores.

Las publicaciones agrupadas no heredan una política por inferencia: la declaración corresponde al identificador preciso consultado. Confirmar que aplica al producto, publicación y pedido de la solicitud forma parte de la revisión. Un producto ambiguo o datos del pedido ausentes no autorizan elegibilidad. Una fecha de creación o pago nunca acredita entrega. El cálculo determinista interno acepta únicamente una referencia marcada como verificada del tipo configurado; informa dentro/fuera del plazo declarado o revisión, sin aprobar/rechazar el caso. No hay evaluación automática de una fecha de entrega obtenida de una transportadora en esta entrega.

El registro de una política en el contexto acredita disponibilidad de sus condiciones y versión; no demuestra aplicación correcta por el modelo, resolución del caso ni cumplimiento financiero. La validación de procedencia por afirmación conserva los límites de A2.

## Coste y validación

Editar, versionar y leer no añade llamadas de IA. Consultar por el Operador usa su turno habitual y las condiciones preparadas para el contexto pueden añadir tokens. La versión normal no realiza las consultas nuevas ni añade estos textos. No se modifican precios ni facturación.

Pruebas con PostgreSQL aislado, productos sintéticos y proveedores simulados verifican versiones, recuperación, permisos humanos/de asistente, aislamiento, errores, retirada, UI bilingüe, tratamiento de fechas y escape del contexto. No se publican términos para productos comerciales, consultan clientes, llaman modelos ni ejecutan pedidos/dinero como QA. Se verifican también catálogo y caché actuales mediante regresiones. La fecha real de referencia y compatibilidad de una operación externa deben comprobarse en su flujo autorizado.
