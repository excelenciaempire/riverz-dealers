# Recompras desde la confirmación

Pilar conserva una sola automatización: **Recompras · Serum Pilar** (`fb865aa4-f84a-405c-8fc1-88157e334a3c`).

## Inicio

Regla indicada por el dueño el 13 de septiembre de 2026:

- Pago anticipado: Shopify registra el pago acreditado (`paid`). Pendiente, autorizado o pago parcial no bastan.
- Contra entrega: el cliente confirma el pedido y la confirmación queda registrada en Shopify con la etiqueta exacta `Confirmado`, o la configurada en la conexión de voz. Una llamada confirmada escribe esa etiqueta cuando la integración está habilitada.
- Crear el pedido o entregarlo no reemplaza la confirmación. Una frase en el chat no confirma automáticamente cualquier pedido del contacto.

El recorrido no exige una etiqueta manual de permiso. Conserva bajas y pausas. Cada cuenta, automatización y pedido tiene un identificador de ejecución determinista para evitar recorridos duplicados. Los eventos del webhook se procesan en orden para terminar el seguimiento anterior antes de abrir el nuevo.

## Calendario

Días desde la confirmación, respetando el horario de recordatorios configurado:

| Unidades | Acompañamiento | Primera oferta | Última oferta |
|---|---|---|---|
| 1 | 1 y 7 | 22 | 29 |
| 3 | 1, 7 y 21 | 82 | 89 |
| 4 | 1, 7 y 21 | 112 | 119 |
| Otra cantidad | 1, 7 y 21 | Sin oferta automática | Sin oferta automática |

El primer mensaje pregunta por dudas sobre el pedido, sin afirmar que ya llegó. Los tiempos de reposición son configurables. Los pedidos mixtos cuentan únicamente las líneas del producto elegido. Pilar tiene una variante estándar; otros comercios deben verificar las unidades físicas de sus packs.

## Respuestas y bajas

Cualquier respuesta pausa la espera y entrega el contexto a la asesora de Pilar. No hay ramas por palabras clave para resolver la conversación.

`gestionar_recompra` permite reprogramar una espera pausada entre 1 y 365 días tras un acuerdo explícito. La baja agrega la etiqueta de pausa; una nueva compra no la elimina. Los flujos anteriores que utilizan permiso conservan su mecanismo de baja anterior.

Antes de cada envío se revisan pausa y compra posterior. Se mantienen las protecciones generales de Riverz. No se promete reprogramar un ciclo terminado.

## Plantillas

Las siete plantillas utilizadas tienen el prefijo `pilar_postventa_v1_`: `pedido_confirmado`, `acompanamiento`, `experiencia`, `reponer_1`, `reponer_3`, `reponer_4` y `ultimo_recordatorio`.

`pedido_confirmado` reemplaza a `entrega` para no confundir confirmación con recepción. Requiere aprobación de Meta antes de activar. Las plantillas antiguas sin uso se conservan. Los mensajes no fijan precios: la IA consulta las opciones vigentes antes de cotizar.

La recompra anterior ya estaba archivada y no tiene esperas pendientes.

## Biblioteca global y validación

La biblioteca instala una sola automatización con la misma regla de confirmación, en español o inglés. Hay que seleccionar el producto antes de activar. No crea suscripciones ni cobros recurrentes.

Las pruebas cubren pagos acreditados frente a pendientes/autorizados, contra entrega sin y con confirmación, cancelación, aislamiento por cuenta/pedido, calendario, cantidades mixtas, bajas y reprogramación. La migración conserva el flujo y los pasos restantes, exige que no haya esperas pendientes y deja el flujo inactivo hasta verificar aprobación y despliegue.
