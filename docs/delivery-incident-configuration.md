# Novedades de entrega por negocio

La configuración `novedad-entrega` amplía la galería y el Operador actuales en la comparación oculta. Su borrador usa el disparador existente `shopify_order_incident_opened`, una plantilla de WhatsApp elegida por el negocio, una espera de 72 horas y una etiqueta elegida por el negocio. La espera conserva el contexto para responder; no constituye un segundo recordatorio ni un plazo contractual del proveedor.

No incluye identificadores de comercio, asistente o plantilla específicos. No ejecuta el instalador oficial de DeUNA ni cambia sus automatizaciones, reglas o excepciones. Crear desde la galería y desde el Operador usa el mismo instalador. La instalación requiere actor real, administración, acceso actual a Automatizaciones y suscripción con escritura. Un token de MCP utiliza su emisor real, no su etiqueta ni el propietario supuesto.

El borrador nace pausado. La plantilla y etiqueta vacías mantienen los bloqueos de activación actuales. Elegir, registrar o someter una plantilla a Meta y activar son acciones posteriores explícitas del mecanismo existente. Este incremento no publica plantillas, instala reglas permanentes ni contacta clientes durante la creación.

Cuando el flujo autorizado envía, guarda un marcador de novedad para el pedido actual. Solo admite el disparador real, identificador numérico del pedido, estado coherente y fuente estructurada `shopify_tag` o `shopify_shipment`. La etiqueta es una observación de Shopify; por sí sola no prueba que Dropi la haya escrito. La respuesta entrante conserva la asignación humana y el asistente actual, detiene la espera y entrega el contexto del mismo pedido.

Producción y «Probar como cliente» usan el mismo tratamiento. Una novedad de entrega evita los textos y botones automáticos de recuperación de compra; no expone creación de pedido, checkout o cupón en ese turno. Conserva consultas, acciones sobre el pedido actual y aprobaciones de postventa según los permisos existentes. Una observación pasada exige consultar el estado actual antes de presentarlo como vigente. Mensajes y causas externas se incluyen como datos acotados, nunca como autorización o instrucciones.

Una respuesta, un botón o una corrección de dirección no confirman aceptación de la transportadora, solución del incidente o nueva visita. La escritura de correcciones y despacho dentro de Dropi sigue dependiendo del contrato verificado por cuenta. La configuración general aprovecha las señales Shopify existentes; no crea un adaptador universal de Dropi ni reenvía incidentes históricos.

No añade una llamada de IA de clasificación. El contexto adicional puede aumentar tokens del turno habitual cuando esta capacidad esté activada; se mantienen las tarifas y aprobaciones actuales. Las pruebas usan proveedores y datos sintéticos. No acreditan entrega comercial en una tienda nueva ni aprobación de su plantilla en Meta.
