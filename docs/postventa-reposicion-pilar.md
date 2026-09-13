# Postventa y reposición

## Pilar

El programa `pilar_postventa_v1` de Pilar tiene una sola automatización y ocho plantillas en borrador. Entrega, respuestas, cancelaciones y devoluciones entran en ramas del mismo árbol, con un único control de activación. Los ocho auxiliares de la instalación inicial se archivan al consolidar; se conserva el identificador principal y una copia de respaldo.

El flujo principal es **Postventa y recompra · Serum Pilar** (`fb865aa4-f84a-405c-8fc1-88157e334a3c`). Comienza con la entrega de un pedido cuyo primer producto es exactamente `Serum Pilar`. Usa las unidades del pedido, no una etiqueta histórica de oferta.

| Unidades recibidas | Acompañamiento desde entrega | Primera oferta | Última oferta |
|---|---|---|---|
| 1 | Días 1 y 7 | Día 22 | Día 29 |
| 3 | Días 1, 7 y 21 | Día 82 | Día 89 |
| 4 | Días 1, 7 y 21 | Día 112 | Día 119 |
| Otra cantidad | Días 1, 7 y 21 | Sin estimación automática | Sin oferta automática |

Las fechas de reposición presuponen uso consecutivo por una persona. El botón **Los compartí** pausa el recorrido y deriva al equipo para revisar cuántas unidades conserva y cuándo conviene volver a contactar. No se inventa una duración a partir de texto libre.

Los botones de ayuda, pausa y baja se resuelven dentro de la misma automatización. **Más adelante** permite solicitar un recordatorio en 15 o 30 días. Una respuesta posterior cancela esa espera. **Quiero repetir** suspende la secuencia y abre la conversación de compra; no crea ni cobra un pedido sin confirmar sus datos.

Antes de cada envío, el recorrido exige su etiqueta de permiso verificado y ausencia de pausa. Las consultas de nueva compra se formulan como pregunta positiva: si el proveedor falla, el motor corta la rama en lugar de dar por hecho que no compró. Cualquier compra posterior detiene este ciclo conservador, aunque sea de otro producto.

Las devoluciones y cancelaciones del producto pausan el programa. Cualquier respuesta después de la primera oferta cancela la segunda mediante una señal específica de la ejecución. La etiqueta de ayuda permanece hasta que el equipo resuelve el caso; una nueva entrega no la borra.

## Plantillas de Pilar

Todas están en español, con categoría Marketing y sin importes fijos ni promesas de eficacia. No se enviaron a Meta: son borradores editables en Plantillas.

| Nombre | Uso |
|---|---|
| `pilar_postventa_v1_entrega` | Recepción y ayuda inicial |
| `pilar_postventa_v1_acompanamiento` | Dudas de uso |
| `pilar_postventa_v1_experiencia` | Experiencia y unidades compartidas |
| `pilar_postventa_v1_reponer_1` | Reposición de una unidad |
| `pilar_postventa_v1_reponer_3` | Repetir la oferta 2 + 1 |
| `pilar_postventa_v1_reponer_4` | Repetir la oferta 3 + 1 |
| `pilar_postventa_v1_ultimo_recordatorio` | Último intento del ciclo |
| `pilar_postventa_v1_recordatorio_solicitado` | Fecha solicitada por el cliente |

## Biblioteca global

La galería y Operador ofrecen una sola opción: **Postventa y recompra**. Integra acompañamiento, consulta de experiencia y reposición opcional en una automatización con seis plantillas de partida. Sustituye las tarjetas separadas Recompras, Postventa y reposición, Acompañamiento postventa y Encuesta post-compra.

El ejemplo de reposición propone los días 22 y 29 para una unidad; requiere adaptar duración y cantidades. El control **Incluir recompra** permite desactivar las ofertas y mantener el acompañamiento a los días 1, 7 y 21. Se comprueba de nuevo después de las esperas. No se cobran suscripciones ni se activan envíos al instalar.

Cada instalación crea nombres y etiquetas propios del comercio, en español o inglés según el idioma de instalación. Ninguna incluye identificadores, ofertas ni precios de Pilar. El filtro del producto se deja vacío intencionalmente y la validación impide activarlo hasta elegir un producto real. Las plantillas también requieren reemplazar el texto genérico por el producto correspondiente.

Esta primera versión utiliza los eventos y la comprobación de compra de Shopify. No representa todavía un conector completo de suscripciones ni una certificación de los demás conectores. Para una suscripción, el acompañamiento no reemplaza las notificaciones del proveedor ni debe crear una compra paralela a su renovación.

## Antes de activar

1. Revisar los textos y enviarlos a aprobación de Meta desde Plantillas.
2. Resolver la diferencia entre importes de catálogo y checkout de Pilar: 69.990/69.900 para tres frascos y 109.990/99.900 para cuatro. La automatización no fija ni modifica esos importes.
3. Registrar evidencia de permiso y asignar únicamente a esos contactos la etiqueta **pilar_postventa_v1: postventa permiso verificado**. La instalación no la asigna a ningún cliente.
4. Verificar la entrega real y el mapeo exacto del producto, incluidos packs representados por variantes. Pedidos mixtos con el sérum en una línea posterior no entran en este filtro inicial.
5. Sustituir coordinadamente la recompra anterior **Recompra por unidades (pedido nuevo)**, que sigue activa. Revisar sus esperas pendientes antes de activar el nuevo conjunto.
6. Confirmar el asistente y la derivación humana disponibles, y simular compra posterior, baja, ayuda, unidades compartidas y reprogramación. Activar el único flujo una vez verificadas estas condiciones.

No se cargan pedidos antiguos ni se disparan mensajes atrasados. Las respuestas libres que no coincidan con los botones o frases configuradas continúan en la atención normal; la interpretación de una incidencia no está resuelta mediante coincidencias exactas de palabras. Antes de producción debe verificarse que el equipo o asistente pueda pausar el seguimiento cuando corresponda.

## Validación

Pruebas con reloj simulado comprueban los días reales de cada oferta, la ausencia de reposición para cantidades desconocidas, permisos, pausas, compras posteriores y respuesta tras el primer ofrecimiento. Se validan los componentes de WhatsApp, los pasos nativos y la separación del contenido en inglés. Se comprueban todas las entradas del mismo árbol, las respuestas no coincidentes y el control de recompra. La consolidación verifica que queda una sola automatización del programa, pausada, y conserva las plantillas existentes.
