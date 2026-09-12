# Riverz: continuación de seguridad y recuperación

## Correcciones

- **Aislamiento de adjuntos privados:** reenviar un archivo podía llegar a la firma privilegiada sin validar su comercio. El servidor rechaza ahora las referencias ajenas antes de enviar o guardar mensajes. La firma exige el comercio resuelto por el servidor en WhatsApp, Instagram/Messenger, Gmail, Outlook, Zoho, Mercado Libre, flujos e IA. También bloquea rutas de escape codificadas; la caché de imágenes convertidas queda separada por comercio.
- **Proxy histórico de WhatsApp:** conocer un ID de archivo ya no basta. Antes de consultar Meta, se comprueba que figure en una conversación de un comercio vivo al que pertenece el usuario. La autorización no depende del alcance de la credencial de Meta. Se rechazan IDs que podrían alterar la ruta de Graph y también se acota la descarga autenticada de WhatsApp.
- **Descargas externas:** se sustituyó la descarga de adjuntos y de imágenes para conversión por HTTPS con resolución DNS comprobada y fijada a la conexión TLS. Bloquea redes privadas, loopback, metadata, direcciones reservadas y respuestas DNS mixtas. Comprueba cada redirección y elimina credenciales al cambiar de origen. Límite de cinco redirecciones, veinte segundos y 25 MiB, incluidos cuerpos sin tamaño declarado. No acepta contenido comprimido cuando solicitó `identity`, evitando descompresión sin límite.
- **Archivos de bandeja y chat web:** lectura acotada de los bytes reales antes de interpretar multipart. El límite ya no depende de `Content-Length`. Se cancela el flujo al superar el máximo, se rechazan tipos de petición incorrectos y se conservan los límites de archivo de 25 MiB y 10 MiB, con 8 KiB de margen para campos y cabeceras. Los errores de la bandeja conservan traducción español/inglés.
- **Segunda contraseña del administrador:** máximo de cinco intentos por identidad autenticada en quince minutos, con respuesta 429 y `Retry-After`. Rotar cabeceras de IP no reinicia ese contador. Entradas de contraseña con tipos incorrectos dejan de provocar errores internos. Mensajes traducidos en ambos idiomas. Usa el limitador existente: distribuido cuando Upstash está configurado y local al proceso en caso contrario; esto no certifica protección global entre réplicas sin ese servicio.
- **Conciliación de recargas:** un fallo de Stripe, del libro de movimientos o del guardado de un intento ya no interrumpe la recuperación de los demás comercios. Se informa salud parcial (207), conservando pendientes los intentos fallidos para su reintento idempotente.
- **Informe de integraciones:** los mensajes de proveedores pasan por el filtro existente de patrones explícitos de credenciales antes de imprimirse.

## Pruebas específicas

- URLs privadas relativas, absolutas y antiguas de Supabase de otro comercio rechazadas sin solicitar firma. Rutas de escape simples y doblemente codificadas rechazadas. Tres pruebas de la ruta de envío confirman 403 antes de consultar destinatarios, escribir mensajes o invocar adaptadores.
- Cinco pruebas del proxy histórico: acceso autorizado, ID ajeno, fallo de consulta de membresía, ausencia de sesión e ID mal formado. Las denegaciones ocurren antes de llamar a Meta.
- Descargas: direcciones privadas IPv4/IPv6, direcciones codificadas, DNS privado/mixto, fijación de DNS, redirección a metadata, eliminación de credenciales, límite de redirecciones, tamaño real y bloqueos durante DNS o lectura.
- Prueba real del nuevo descargador: endpoint de salud público y un adjunto JPEG de Rasmiaw firmado por 60 segundos, descargado correctamente (214.671 bytes). No se guardó ni mostró el contenido ni la URL firmada.
- Multipart válido, límite exacto, tamaño declarado ausente/falso/inválido, cuerpo mal formado y cancelación anticipada.
- Cien cargas concurrentes: cincuenta aceptadas y cincuenta canceladas por exceso de tamaño.
- Cincuenta intentos simultáneos de la contraseña administrativa: cinco evaluados y cuarenta y cinco bloqueados; validación adicional de sesión, CSRF, tipos de entrada y cookie HTTP-only.
- Conciliación: fallos independientes de proveedor, acreditación y persistencia; pagos aún en proceso no acreditados; consumos antiguos inciertos conservados.
- Cien solicitudes de reserva de la misma operación: una aceptada y noventa y nueve rechazadas como ya iniciadas. Cien liquidaciones repetidas: un solo movimiento, saldo y reserva correctos, sin modificar el otro comercio. Se ejecutaron las funciones de la migración 253 en PGlite; esto prueba invariantes y reintentos, no bloqueos entre conexiones de un PostgreSQL distribuido.

## Comprobaciones reales sin navegador

Se creó una sesión temporal de la cuenta del propietario mediante la API administrativa de Supabase, sin enviar correo, cambiar contraseñas ni crear usuarios. Credenciales y cookies permanecieron en memoria; al terminar se cerró únicamente esa sesión.

Siete comprobaciones autenticadas aprobadas en producción:

1. Configuración del comercio: 200.
2. Intento de sustituir el comercio mediante parámetros: devolvió la configuración de la sesión.
3. Hilo existente de otro comercio en Operador: 404.
4. Lectura de Operador del comercio de la sesión: 200.
5. Resumen operativo con métricas: 200.
6. API de administrador sin segunda contraseña en riverz.co: 403 `locked`.
7. La misma API en admin.riverz.co: 403 `locked`.

Estas comprobaciones no prueban el panel administrativo desbloqueado ni todas las combinaciones de roles. No se enviaron mensajes, llamadas ni cargos reales como prueba.

## Validación acumulada

- Primera suite completa: 369 archivos y 3.192 pruebas aprobadas.
- Segunda suite completa, tras el aislamiento de firma y el descargador: 370 archivos y 3.236 pruebas aprobadas.
- Después de incorporar las comprobaciones de la ruta de envío y del proxy histórico: 58 pruebas específicas aprobadas en cuatro archivos, incluidas ocho pruebas nuevas. No se suman como si fueran 58 casos adicionales distintos a la suite.
- Auditoría de arquitectura de IA: 1.345 archivos revisados, tres constructores en la fábrica compartida y cero hallazgos.
- Lint de los archivos modificados: cero errores y tres advertencias preexistentes de parámetros sin usar en Outlook y Zoho. La comprobación adicional del proxy y su ajuste de descarga tampoco reportó errores.
- Compilación de producción aprobada con comprobaciones de esquema y TypeScript. El descargador de WhatsApp quedó en un módulo exclusivo del servidor, separado de los límites de menú que también importa la interfaz.

## Incidencias externas y pendientes verificadas

- **Shopify:** consulta directa de permisos concedidos en las cuatro conexiones Shopify activas: las cuatro respondieron 200. Únicamente `riverz-demo.myshopify.com` carece de lectura/escritura de borradores de pedidos. Las otras tres tienen los permisos comprobados de pedidos, borradores, productos y clientes. La documentación oficial relaciona estos recursos con sus [permisos de acceso](https://shopify.dev/docs/api/admin-rest/usage/access-scopes). La tienda demo necesita conceder el permiso; cambiar un estado local no lo concede.
- **Mercado Libre:** el proveedor mantiene la cuenta inactiva. Fallan sus tareas de preguntas, mensajes, pedidos, catálogo, reseñas y reclamos por ese rechazo externo.
- **Reserva Apify de Rasmiaw:** pendiente desde el 8 de septiembre, sin identificador de ejecución en el detalle. No se inventó un recibo ni un costo para liquidarla o liberarla. Hace falta evidencia del proveedor para conciliar el consumo.
- **GitHub Actions:** la ejecución del commit anterior no arrancó por pagos fallidos o límite de gasto de la cuenta. La validación local y el despliegue automático de Render son independientes de ese bloqueo. No se modificaron medios de pago ni límites de gasto.
- Falta una prueba de carga sostenida en infraestructura representativa con objetivos definidos de usuarios/eventos, además de entrega real controlada por proveedor y cobertura completa de roles. Las pruebas locales de concurrencia no certifican capacidad de miles de usuarios.

Los controles de descarga se aplican a estos caminos de adjuntos; no constituyen una revisión exhaustiva de todos los `fetch` del repositorio. Los resultados reducen fallos concretos; no equivalen a ausencia universal de bugs o de prompt injection. La evaluación de IA de la entrega anterior y sus límites están en `prompt-injection-security-2026-09-12.md`.
