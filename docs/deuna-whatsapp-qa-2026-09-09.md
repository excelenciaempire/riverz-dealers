# DeUNA Shop: verificación del 9 de septiembre de 2026

## Actualización posterior: permiso y página nueva

- Pago de WhatsApp desbloqueado: Meta permite enviar con capacidad limitada por revisión del nombre visible. Las once plantillas DeUNA siguen PENDING; las cinco automatizaciones siguen preparadas y bloqueadas únicamente por plantillas.
- App privada Riverz CRM actualizada a `riverz-crm-4`; `write_draft_orders` aceptado en Shopify Admin. Token renovado y permisos guardados en Riverz.
- Borrador real de QA `1575484490092`: creación exitosa, webhook recibido en Riverz y borrador eliminado. Línea técnica de cero pesos, sin cliente, teléfono, producto físico ni despacho. No equivale a una prueba de entrega de WhatsApp.
- La apertura de la app privada ahora apunta a `/integraciones`: el navegador llegó al acceso de Riverz correctamente. La raíz disparaba OAuth de otra identidad de app y rechazaba la firma de esta app privada.
- Página vigente: https://deunashop.shop/products/pelota-saltarina. Sincronización Shopify completada. Aún muestra NIVELSHOP en el contenido público; la IA conserva DeUNA Shop y no incorpora esa identidad.
- Corregidas también las objeciones estructuradas, que se inyectan aparte del texto de formación y todavía afirmaban descuentos y baterías no verificados.
- No hay API oficial de Dropi ni prueba de entrega real de WhatsApp. La aprobación de Meta y la comprobación logística siguen siendo pendientes reales.

Configuración privada aislada en `shopify/deuna/`; desplegar con `shopify app deploy --path shopify/deuna --allow-updates`. No mezclar con las extensiones de las apps pública y legacy del directorio raíz. Scripts: `refresh-deuna-product.ts` actualiza catálogo/formación; `verify-deuna-shopify-draft.ts` verifica permiso, crea un borrador técnico y lo elimina sin completarlo.

Las secciones siguientes documentan la verificación inicial; los bloqueos de pago y permiso allí indicados ya quedaron resueltos según esta actualización.

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
