# Recompras

## Pilar

El programa `pilar_postventa_v1` de Pilar tiene una sola automatización y ocho plantillas en borrador. El árbol contiene únicamente el recorrido desde la entrega, sus esperas y las condiciones de envío. Las respuestas las atiende la IA. Se conserva el identificador principal y una copia de respaldo de los cambios.

El flujo es **Recompras · Serum Pilar** (`fb865aa4-f84a-405c-8fc1-88157e334a3c`). Comienza con la entrega de un pedido cuyo primer producto es exactamente `Serum Pilar`. Usa las unidades del pedido, no una etiqueta histórica de oferta.

| Unidades recibidas | Acompañamiento desde entrega | Primera oferta | Última oferta |
|---|---|---|---|
| 1 | Días 1 y 7 | Día 22 | Día 29 |
| 3 | Días 1, 7 y 21 | Día 82 | Día 89 |
| 4 | Días 1, 7 y 21 | Día 112 | Día 119 |
| Otra cantidad | Días 1, 7 y 21 | Sin estimación automática | Sin oferta automática |

Las fechas de reposición presuponen uso consecutivo por una persona. Si el cliente comparte unidades o cambia su consumo, la IA conversa para aclarar cuándo conviene volver a contactar. No se inventa una duración a partir de texto libre.

Cualquier respuesta, por botón o texto libre, cancela la espera pendiente y entrega el contexto a la IA configurada. No hay ramas por palabras exactas, respuestas enlatadas ni asignación automática a humanos. La IA atiende dudas, incidencias, intención de compra y solicitudes de cambio con sus herramientas y permisos habituales.

La herramienta `gestionar_recompra` permite cancelar el permiso de este programa o reprogramar la siguiente etapa de una ejecución pausada, entre 1 y 365 días, después de un acuerdo explícito. No recibe identificadores elegidos por el modelo: obtiene cuenta, contacto y conversación del servidor. La reprogramación consume un token de pausa y conserva los pasos originales, que vuelven a comprobar permiso y compras. Si el ciclo ya terminó, no inventa un nuevo recordatorio ni promete una reprogramación que la herramienta no pudo hacer. La baja sí puede registrarse después del último mensaje.

Antes de cada envío, el recorrido exige su etiqueta de permiso verificado y ausencia de pausa. Las consultas de nueva compra se formulan como pregunta positiva: si el proveedor falla, el motor corta la rama en lugar de dar por hecho que no compró. Cualquier compra posterior detiene este ciclo conservador, aunque sea de otro producto.

Una compra nueva, cancelación o devolución invalida las esperas de recompra del contacto y sus tokens de reprogramación. Es una suspensión conservadora incluso si el evento corresponde a otro producto. El seguimiento se pausa desde la primera respuesta, no solamente después de una oferta. La IA no recibe las instrucciones de recuperación de pedidos pendientes cuando atiende una recompra.

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

El borrador antiguo `pilar_postventa_v1_recordatorio_solicitado` no forma parte del recorrido y se conserva sin uso. Las nuevas instalaciones crean únicamente las plantillas utilizadas. El último mensaje ofrece recompra, ayuda o baja; no ofrece aplazar un ciclo que ya terminó.

## Biblioteca global

La galería y Operador ofrecen una sola opción: **Recompras**. Integra acompañamiento, consulta de experiencia y reposición opcional en una automatización con cinco plantillas de partida. Las respuestas continúan con la IA. Sustituye las anteriores tarjetas separadas de postventa y encuesta.

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

No se cargan pedidos antiguos ni se disparan mensajes atrasados. Antes de activar hay que verificar que el asistente configurado esté activo y pueda usar la herramienta de gestión de recompra. Las respuestas libres pausan la secuencia igual que las respuestas a botones.

## Validación

Pruebas con reloj simulado comprueban los días reales de cada oferta, la ausencia de reposición para cantidades desconocidas, permisos, pausas, compras posteriores y respuestas tempranas. Se validan los componentes de WhatsApp, los pasos nativos y la separación del contenido en inglés. Las pruebas de la herramienta cubren aislamiento por cuenta y contacto, confirmación, permisos, tokens y bajas después del último mensaje. La migración verifica una sola raíz y ninguna rama de respuestas, conservando el estado de borrador y las plantillas existentes.

### Revisión del 12 de septiembre de 2026

Se consultaron los 110 elementos guardados de Pilar: 67 condiciones, 18 esperas, 18 envíos, cuatro altas de etiqueta y tres actualizaciones de contexto. La validación estructural no encontró errores. Los siete nombres de plantilla y las tres etiquetas utilizadas existen en la misma cuenta; la asesora configurada también pertenece a Pilar. No había ejecuciones pendientes ni en curso. Se verificaron los textos, variables de nombre, botones y componentes de las siete plantillas guardadas.

Se corrigió el cálculo de las ramas anidadas: cada abanico mide sus propias filas y reserva toda su altura, evitando superponer Sí/No. Las condiciones muestran la etiqueta concreta y el resumen completo queda disponible al pasar el cursor. Una prueba del componente real en Chrome comprobó siete abanicos y 29 tarjetas/etiquetas sin solapamientos al 50 %, 100 % y 150 %, con tarjeta cerrada y desplegada.

Se corrigieron los borradores de experiencia y último recordatorio: ya no ofrecen aplazar cuando pueden ser el último paso del ciclo. Se conservan la conversación con IA, ayuda y baja. Las nuevas instalaciones no crean el recordatorio solicitado que no tenía ningún paso asociado. El script `scripts/repair-pilar-reorder-templates.ts` aplica la reparación únicamente a los borradores conocidos, con respaldo y comprobación de cambios concurrentes.

Esta revisión no equivale a un envío real ni a una aprobación de Meta. Siguen aplicando los requisitos de activación y las limitaciones de pedidos mixtos y suscripciones descritos arriba.
