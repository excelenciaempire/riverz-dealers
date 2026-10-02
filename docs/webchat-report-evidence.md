# Reportes del chat web: cobros registrados y primera respuesta

El endpoint existente `/api/webchat/stats` comparte la autoridad actual por caso y el resumen monetario del panel. No ejecuta modelos, envíos, pedidos ni consultas a Shopify.

## Datos y límites

- Ventana exacta de 30 días, con final exclusivo y período anterior del mismo largo. Conversaciones nuevas del período; las resoluciones verificadas conservan su propia cohorte de actividad/revisión.
- La lista actual de casos autorizados se obtiene antes de consultar sus metadatos, pedidos vinculados o mensajes. Solo se consulta `webchat`, con workspace explícito. Los pedidos del canal que no tienen caso pertenecen al agregado del workspace autorizado; no se incluyen pedidos vinculados a casos inaccesibles. Se comprueba nuevamente la autoridad antes de devolver el resultado.
- Páginas de 1.000, lotes de hasta 100 casos y orden estable. Ya no se limita la primera respuesta a 300 conversaciones y 4.000 mensajes. El límite de seguridad de 500.000 filas produce un error, nunca un informe parcial. Una fuente ausente no se interpreta como cero.
- Solo `financial_status=paid` y estados de pedido `created`, `paid` o `fulfilled` contribuyen al importe. Monedas separadas, decimales exactos de hasta seis posiciones, importes inválidos contados como no disponibles. No se escoge una moneda por su volumen nominal. El escalar heredado es nulo si no existe un total único y seguro; un cero observado conserva cero.
- Los importes representan el estado registrado del pedido por fecha de creación. No son caja neta, fecha de cobro, atribución causal a Riverz ni verificación en vivo del proveedor. Los pedidos parciales o reembolsados quedan excluidos.
- Primera respuesta: primer mensaje del cliente y primera respuesta posterior con estado `sent`, `delivered` o `read`, antes del final del período. Una muestra por conversación; se excluyen mensajes eliminados, fallidos, pendientes y del sistema. El denominador y las muestras ausentes acompañan la mediana. Es una medición del historial disponible del caso, no de cada episodio de reapertura.
- El informe por canal conserva su ventana de mensajes y usa el mismo criterio de envío exitoso, separando asistente, automatización y humano por el origen registrado.

La tarjeta actual conserva su ubicación. Presenta todas las monedas con sus decimales completos y avisa cuando hay importes no verificables, en español e inglés. No habilita controles nuevos de comparación.

## Corrección de documentos

Abrir o cerrar un panel anidado de Drive/documentos no recarga la fuente principal ni pierde el borrador local. La carga al abrir el panel principal y su cancelación al cerrarlo se conservan.

## Validación

101 pruebas en ocho archivos, TypeScript completo, lint y compilaciones normal/comparación correctos. Cohortes sintéticas de 1.003 pedidos y 350 conversaciones, monedas múltiples, seis decimales, permisos cambiados, fuentes ausentes, mensajes fallidos y borrador preservado. Ningún efecto comercial o llamada a un modelo se utiliza como prueba.
