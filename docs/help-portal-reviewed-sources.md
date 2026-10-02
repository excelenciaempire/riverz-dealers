# X1: centro de ayuda con fuentes revisadas

El centro conserva la marca de la tienda y comparte documentos activos y versiones exactas con el superasistente. La administración se añade dentro de Documentos, sin cambiar la navegación. La página `/ayuda/<dirección>` tiene su equivalente `/help/<dirección>`. Las páginas, APIs y controles nuevos permanecen cerrados con el flag de mejoras apagado.

## Publicación

1. Cargar el centro dentro de Documentos y guardar nombre, descripción, color y dirección.
2. Elegir una fuente activa del asistente y copiar un fragmento literal de su versión vigente.
3. Guardar el artículo como borrador y revisar su contenido e idioma.
4. Marcar la revisión y publicar el artículo. La visibilidad del centro tiene su propio control.

Guardar documentos o activarlos para el asistente no los publica en Internet. Una edición del artículo vuelve a borrador. Una edición, sustitución, retirada o eliminación de la fuente hace desaparecer su artículo de la siguiente lectura pública; publicar exige otra versión vigente. Las páginas ya abiertas conservan los textos previamente recibidos: no pueden retirarse bytes entregados a un visitante. La publicación no llama a modelos ni modifica permisos del asistente.

Se admiten 30 artículos y 48 KB de texto en conjunto por centro; cada fragmento tiene hasta 16.000 caracteres del contrato y 48 KB UTF-8. Solo se publica texto escapado por React, sin HTML ejecutable, CSS arbitrario, archivos privados, fuentes completas implícitas o URLs firmadas. El color acepta exclusivamente hexadecimal de seis dígitos. El contenido del negocio sigue el idioma elegido para su artículo; los controles funcionan en ES/EN.

## Pedidos protegidos

El centro dentro del chat web aprovecha la sesión firmada ya existente, su origen permitido, el motor, configuración y límites actuales. El negocio y visitante provienen del token; el asistente proviene de la configuración actual del chat. Sin asistente configurado no se elige uno arbitrario.

Solo aparecen hasta 20 pedidos recientes asociados al contacto exacto `webchat` de ese visitante y negocio. Coincidir en email, teléfono, número de pedido o identidad declarada no concede acceso. La respuesta contiene referencia, estado local y fecha de observación; excluye direcciones, teléfonos, correos, pagos, objetos completos de proveedores y URLs privadas. El estado se presenta como **último estado registrado**, no como entrega física ni consulta en vivo a Shopify o Dropi. La página pública de artículos no abre pedidos sin la sesión del chat.

Se conserva el recorrido existente de solicitudes de pedidos. Consultar el centro no envía mensajes, cambia pedidos, reserva productos, llama a proveedores o cobra IA. Sus consultas son base de datos y texto; no son consumo de tokens del superasistente ni un cambio del pricing.

## Adopción y contacto evitado

Los contadores distinguen lecturas de artículos, respuestas recibidas, consultas resueltas según el visitante y visitantes que aún necesitan ayuda. Tras declarar que su duda se resolvió aparece una segunda pregunta: si el artículo evitó contactar al equipo. Esta respuesta tiene un denominador independiente. Una lectura o una respuesta positiva no incrementa automáticamente contactos evitados.

Los resultados son **declaraciones anónimas de visitantes**, no personas únicas verificadas, tickets evitados demostrados, ventas atribuidas, resolución por IA ni reducción causal. Una recarga puede ser otra lectura. Se conserva la primera respuesta por artículo/versión, identificador aleatorio y día UTC. El ID vive en memoria del componente, no en almacenamiento del navegador; no contiene identidad del cliente.

Ventana de 30 días, hasta 5.000 registros diarios por centro y límites de API por IP. Los registros expirados quedan fuera de las métricas inmediatamente. La limpieza diaria existente elimina hasta 10.000 registros expirados por pasada; una demora o acumulación puede retrasar su eliminación física. Las tablas no guardan IP, email, teléfono, búsqueda, texto de clientes ni token del chat. Los límites utilizan el sistema de rate limit vigente.

## Autoridad y datos privados

El dueño o un administrador vigente con acceso a `/asistente` pueden administrar. Las escrituras requieren suscripción habilitada, CSRF, negocio seleccionado correcto y revisión actual. SQL comprueba estos permisos nuevamente dentro de la operación, bloquea versiones y serializa el negocio. Las tablas no conceden lectura o escritura directa a `anon`, `authenticated` o `service_role`; las RPC son privadas de servicio y fijan `search_path`.

La lectura pública devuelve únicamente marca, dirección, idioma y artículos publicados cuya fuente continúa activa y vigente. No expone IDs de negocio/asistente/fuente, autores, historial privado ni credenciales. El feedback público admite solo datos tipados de lectura, revisión y respuesta, rechaza orígenes cruzados y cuerpos mayores de 4 KB y no concede autoridad sobre clientes o herramientas.

Migraciones **364**, **365** y **366** instaladas una vez. 364 corrige el progreso de archivos vacíos sin retener su payload; 365 incorpora publicación, pedidos protegidos y retención; 366 añade el reporte separado de contacto evitado. Ninguna migración anterior se editó o repitió. La comprobación real utiliza exclusivamente metadatos y contexto nulo; no publica artículos de negocios, registra respuestas de visitantes ni ejecuta purgas como QA.
