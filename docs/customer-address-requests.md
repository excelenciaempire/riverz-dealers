# Solicitudes de dirección con comprobante

El formulario del chat web amplía la consulta y edición conversacional que ya existían. Permite solicitar seis campos de envío, con revisión explícita del cliente; no cambia nombre, teléfono o identidad del destinatario. Confirmación de pedido, variantes y cancelación conservan sus solicitudes conversacionales actuales. No se anuncia ejecución determinista de esas otras tres solicitudes ni acceso desde una extensión de confirmación de Shopify.

## Identidad y mensaje de origen

La sesión firmada y el origen vigente del widget delimitan negocio, conexión y visitante. SQL vincula únicamente su contacto exacto de canal webchat y un pedido Shopify realmente asociado a ese contacto. Un correo declarado, teléfono, familia de contactos o número de pedido no amplían acceso.

Se reserva un comprobante antes de enviar el texto canónico por la ruta de mensajes existente. La reserva no acredita envío. La publicación exige el mensaje real entrante del cliente, con identificador externo estable, texto exacto y conversación del contacto y conexión actuales. Una respuesta HTTP de ingreso no basta por sí sola. Reintentar mantiene el mismo identificador mientras no se edita el formulario y reutiliza la deduplicación existente; no agrega un motor de mensajería, atribución o automatización. Ambos guards de envío se aplican, por lo que este acceso consume dos unidades del cupo de envío existente por tentativa. No se hace un envío automático en segundo plano.

Hasta cincuenta reservas por pedido y vigencia técnica de veinticuatro horas. Ese plazo exige revisar una solicitud antigua y no declara una política comercial de devolución o ventana contractual de edición. Una solicitud posterior publicada sustituye las anteriores; una reserva antigua que llega tarde no sustituye una solicitud más reciente. Una operación en ejecución o incierta bloquea la sustitución. El almacenamiento es privado y se elimina en cascada con sus recursos de origen.

## Revisión y ejecución compartidas

El equipo abre el control contextual plegado dentro de la ficha de pedidos en Bandeja. Se comprueban identidad real, acceso vigente a Bandeja y Pedidos, conversación, negocio y fuente. Preparar lee Shopify mediante `caseOrderSnapshot`, conserva validación de dirección configurada y bloqueos de despacho/Dropi, y guarda una operación con el escritor existente. No modifica Shopify ni inicia una devolución de dinero.

La operación se abre en la misma revisión con aprobación explícita de administrador, caducidad y bloqueo compartido por pedido. No se suplanta al visitante como dueño o miembro del negocio. Se conserva el requisito de membresía del motor B3 existente. Una solicitud sustituida, fuente alterada/eliminada o permisos retirados impide un nuevo reclamo. El enlace y marcador revisados no pueden cambiar; perder el origen no transforma la propuesta en una acción ordinaria. Una operación ya iniciada conserva su resultado al terminar.

El cliente consulta un comprobante privado y acotado: referencia, fechas, estado y si fue sustituido. No recibe actores, notas, datos de proveedor, direcciones privadas adicionales o resultados financieros. Solo `completed` junto a dirección posterior verificada idéntica a la propuesta produce “Cambio confirmado”, con su hora. Un ACK, HTTP 200, resultado incierto, reconciliación o resultado incompleto no acredita el cambio. La confirmación es un hecho histórico; una edición posterior no implica que esa dirección continúe vigente.

Al cerrar y volver a seleccionar el pedido, la misma pestaña puede recuperar el último comprobante reconocido. `sessionStorage` guarda solamente su identificador; no guarda dirección ni token y nunca se considera autorización. La recuperación vuelve a comprobar la sesión y el alcance en el servidor; una pérdida de acceso retira la pista. Solicitar otra corrección es una acción explícita y conserva los bloqueos SQL. Un cierre de pestaña o almacenamiento deshabilitado puede perder esa pista local; no se promete recuperación automática entre dispositivos.

## Presentación, costes y aceptación

Todos los controles y rutas nuevos permanecen ocultos fuera de comparación, en español e inglés. La navegación, los editores actuales, las campañas y las automatizaciones se conservan. Los controles cargan datos al abrir y consultan estado por acción explícita; no se solicitan modelos para generar comprobantes. Enviar la solicitud entra al turno conversacional habitual, que puede consumir sus tokens e iteraciones normales. No se cambian precios ni políticas de cobro.

Pruebas con PostgreSQL aislado y proveedores simulados verifican el paso entre reserva, mensaje, preparación, aprobación y resultado, así como identidad, permisos, reintentos, sustitución, fechas y fallos. El cambio físico en una tienda y su aceptación externa no se prueban con pedidos comerciales como QA. La disponibilidad del despliegue y la validación automatizada se registran por separado.
