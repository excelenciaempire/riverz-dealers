# DeUNA Shop: verificación del 9 de septiembre de 2026

## Cambios aplicados

- Foto de perfil enviada a Meta; respuesta success=true y URL de perfil presente.
- Catálogo actualizado desde Shopify: Pelota saltarina LED Juego, 110000 COP. Las ofertas antiguas no se consideran vigentes.
- Formación del producto corregida: no inventar edad, peso máximo, baterías ni accesorios. Inventario cero con venta permitida no acredita existencias físicas en Dropi.
- Confirmación v2: destinatario, pedido, productos con cantidades y variantes, total, dirección y teléfono. Datos ausentes se muestran como raya y se solicita CORREGIR.
- CONFIRMAR y CORREGIR corresponden a validación de datos. Retomar compra pertenece exclusivamente al carrito abandonado y abre su checkout.
- Contexto y asistente de respuesta persistidos antes del envío, incluso para mensajes sin espera posterior. No se modifica la asignación humana.
- Los pedidos se derivan al asistente general; los carritos al de recuperación.

## Evidencia y límites

- 40 pruebas automatizadas pasaron: resumen, extracción de respuestas de botones, motor, componentes Meta y webhook de pedidos.
- Resolución del botón dinámico y redirección HTTP 302 verificadas con URL de prueba y parámetros analíticos esperados. No se completó un checkout real.
- Simulación con el modelo configurado: CONFIRMAR y CORREGIR no crearon pedidos. La IA solicita el dato a corregir. La respuesta generativa aún puede añadir frases sobre futuros avisos; esto no acredita ejecución logística.
- La simulación de especificaciones intentó registrar una duda, pero el contacto ficticio no tenía UUID válido. No se acredita una derivación humana real.
- Shopify permite lectura y sincronización; el intento de borrador aislado devolvió 403 por falta de write_draft_orders. No se creó ningún pedido de prueba.
- Meta registra el número conectado y la aplicación suscrita. El envío iniciado por negocio está bloqueado por error 141006 de medio de pago.
- Plantillas DeUNA enviadas a revisión, incluidas las tres v2. Cinco automatizaciones preparadas pero bloqueadas por salud de WhatsApp y revisión de plantillas.
- No se probó entrega real ni clic real de un destinatario en WhatsApp.
- No existe API oficial de Dropi conectada. CONFIRMAR no libera ni retiene un despacho; correcciones y cancelaciones requieren revisión logística. El token Shopify–Dropi no se utiliza como API de Riverz.

## Pendientes operativos

Resolver el medio de pago en Meta y esperar aprobación. Después probar recepción, respuesta y estados con un destinatario de prueba autorizado. Para probar borradores Shopify, autorizar el alcance write_draft_orders. Validar físicamente disponibilidad y especificaciones del producto con proveedor; comprobar por separado retención y cambios logísticos en Dropi.
