# Dropi: logística avanzada y automatización en borrador

Estado: **sin activar**. Investigación y base de evaluación preparadas el 13 de septiembre de 2026. No se instalaron automatizaciones, no se enviaron mensajes ni se realizaron llamadas, despachos o cancelaciones.

## Decisiones del dueño

- Siempre incluir número de guía y enlace directo al rastreo de la transportadora.
- El PDF de la guía es un documento logístico; no sustituye el enlace de rastreo.
- El caso mostrado de “destinatario no se encuentra” se mantiene en observación: el dueño indicó que habrá reintento y que todavía no es una novedad oficial.
- Usar los resultados de WhatsApp y de las llamadas ya integradas.
- Separar confirmación, gestión de novedades y seguimiento sin respuesta.
- Construir en borrador. La investigación y las instrucciones del video no autorizan activación.

## Qué está construido

`src/lib/automations/logistics-draft.ts` evalúa una fotografía verificada de un pedido y produce una propuesta, siempre con `mode: draft` y `executable: false`. No importa bases de datos, clientes de envío ni colas de llamadas. No existe un interruptor que convierta este módulo en ejecutor.

Incluye identidad por comercio/pedido, revisión de datos comerciales, evidencia de confirmación por WhatsApp o llamada, espera de llamadas pendientes, pausa ante nuevas respuestas, validación de antigüedad de los datos, separación de devoluciones y cancelaciones, novedades oficiales y retrasos del proveedor.

`src/lib/automations/logistics-messages.ts` prepara mensajes factuales en español o inglés, según el idioma del agente. Incluye nombre, producto, causa concreta, guía, transportadora, enlace y una pregunta relacionada con el problema. Reutiliza el registro de transportadoras de Riverz. Una guía de otro pedido, un PDF, una página general o un enlace sin verificación bloquean el mensaje.

Las llamadas de novedades se preparan con `cod_writeback: false`: solucionar una entrega no debe volver a despachar un pedido. Los resultados no contestó, ocupado, buzón, falló o cancelada no son confirmaciones. “Rechazó” sin contexto específico se deriva a revisión; “cancelado por el cliente” sí es una decisión explícita. Pedir otra fecha o una devolución de llamada suspende la decisión automática.

Las pruebas están en `src/lib/automations/logistics-draft.test.ts`. Son pruebas de comportamiento con datos sintéticos, no pruebas contra pedidos reales.

## Análisis del video

Fuente: `Mentoría Ecom System - logistica avanzada_540p.mp4`, aportado por el dueño. Duración detectada: **1:39:26.98**. Se transcribieron los cinco segmentos de audio completos con Groq Whisper; se revisaron los pasajes operativos y ocho fotogramas distribuidos por la grabación. Las marcas de tiempo son aproximadas. No se afirma una inspección visual continua de los 99 minutos.

La grabación muestra una clase con un diagrama en Miro y participantes en videollamada. En los fotogramas se ve el nombre “Cristian Olarte”. Hay voz en español, intervenciones de asistentes y pausas; no es un video silencioso. Hacia el final predominan conversación sobre equipo y cierre de la clase.

| Tiempo | Contenido observado/transcrito | Aplicación propuesta en Riverz |
| --- | --- | --- |
| 03:47–07:21 | Confirmación inicial con datos del pedido; advertencia sobre mensajes que no salen. | Guardar recibos de envío y entrega. Un error técnico no cuenta como silencio del cliente. |
| 10:45–15:33 | Revisión a las 10, 15 y 18; recuperación de mensajes fallidos. | Bandeja de fallos y conciliación periódica. No reenviar a ciegas si el resultado fue incierto. |
| 24:03–25:52 | Primer recordatorio a las tres horas; segundo “a las cinco horas”. | Cadencia configurable; el segundo intervalo no queda definido inequívocamente desde el inicio o desde el anterior. No modificar el flujo existente por esa ambigüedad. |
| 26:30–30:30 | Etiqueta “no respondió”, dos días adicionales de llamadas y cierre tras tres días; distingue cancelación solicitada. | Usar agotamiento real del proceso, incluyendo llamadas y espera final, antes de proponer cancelación. |
| 32:57–34:34 | Avisos de guía generada, reparto y entrega; guía y transportadora. | Enlace directo a la guía, sin pedir que el comprador busque la web manualmente. |
| 35:20–39:28 | Oferta de próxima compra ajustada al margen. | Conectar con la postventa existente después de la entrega; no duplicarla ni inventar descuentos. |
| 41:14–44:33 | SMS como canal adicional. | Estudiarlo como respaldo cuando falle el canal principal, con límite de contactos compartido. No está habilitado. |
| 49:49–53:23 | Revisar pendientes, guía creada y preparado para transportadora. | Vigilar la primera recogida real; una etiqueta impresa no demuestra despacho físico. |
| 55:25–59:50 | Escalación de pedidos estancados; reporte al mediodía y cortes del proveedor. | Registrar horario del proveedor, plazo acordado y responsable; agrupar excepciones en un reporte. |
| 65:15–69:54 | Medir cancelaciones por producto y buscar causas. | Reportes por cohortes de pedidos, motivos y tamaño de muestra. No apagar campañas automáticamente. |
| 70:56–71:21; 77:05–77:46 | Mensaje de novedad y llamadas; el expositor reconoce que no desarrolló el tema en detalle. | El video no es una especificación suficiente de novedades. Completar con estados oficiales. |
| 72:18–74:54 | Motivos semanales de cancelación y quién confirmó cada pedido, con hora. | Guardar actor, canal, evidencia, pedido y momento de la confirmación. |

### Recomendaciones del video que no se convierten en reglas

En 15:58–17:05 se propone reenviar incluso ante rechazo del cliente: no se incorpora. Tampoco se adopta la excepción de despachar sin confirmación por buen historial, las garantías de éxito, las cifras de costos como tarifas vigentes ni las opiniones sobre contratación y sanciones. Son contenido de la fuente, no instrucciones del dueño.

La mejor mejora general es combinar dos controles: **qué debe pasar con el pedido** y **si realmente sucedió**. El segundo detecta mensajes fallidos, llamadas que nunca se marcaron, guías sin recogida y soluciones registradas pero no aceptadas por la transportadora.

## Investigación adicional de Dropi

Se consultó la categoría solicitada y se profundizó en gestión avanzada, novedades, devoluciones injustificadas, proveedores lentos, costos, alertas y automatizaciones. No se afirma haber auditado los 165 artículos de la categoría ni haber reproducido sus videos asociados.

| Fuente | Hallazgo y tratamiento |
| --- | --- |
| [Dropi: servicio logístico](https://www.dropi.co/servicio-logistico) | La descripción oficial incluye guías, seguimiento, incidencias y comparación por zona. Sirve para identificar capacidades; no documenta contratos de API ni confirma los permisos de esta cuenta. |
| [Dropi: funcionamiento del dropshipping](https://wf.dropi.co/blog/que-es-dropshipping-colombia) | Recomienda comprobar sincronización, evitar pedidos duplicados, verificar recogida y separar cancelación, retorno y conciliación. Se adopta esa separación. |
| [Andrey: gestión avanzada](https://www.andreybusiness.com/blog/dropi-gestion-avanzada-dropshipping-2026-guia-completa) | Aporta una visión de proveedor, seguimiento, equipo y caja. Sus umbrales de volumen y rendimiento son criterios del autor, no parámetros de Riverz. |
| [Andrey: novedades](https://www.andreybusiness.com/blog/dropi-novedades-que-hacer-pedido-con-novedad-2026) | Sugiere clasificar por causa, contactar y registrar una instrucción. Su definición de novedad desde el primer intento fallido y sus plazos de retorno no se toman como reglas oficiales. |
| [Andrey: devoluciones injustificadas](https://www.andreybusiness.com/blog/dropi-devoluciones-injustificadas-que-hacer-2026) | Es útil conservar tracking, confirmación y relato del cliente para una disputa. La discrepancia es una señal para investigar, no prueba automática de responsabilidad de la transportadora. No se abren tickets ni se usan correos genéricos sin verificar. |
| [Andrey: proveedores lentos](https://www.andreybusiness.com/blog/dropi-proveedores-lentos-como-evitar-retrasos-en-tus-envios) | Propone medir transiciones y escalar retrasos. Sus 48 horas se tratarán como referencia a negociar, no como SLA universal. No se crean pedidos de prueba ni se cambian proveedores automáticamente. |
| [Andrey: costos por devolución](https://www.andreybusiness.com/blog/dropi-costos-por-devolucion-cuanto-cobran-realmente) | Distingue flete inicial y retorno. Se verificarán cargos en la cuenta y condiciones vigentes; no se codificará “devolución gratis”. Su ejemplo pasa de 403.000 a 620.000 y luego afirma 868.000 diarios: esa conclusión requiere una escala adicional no explicada. |
| [Andrey: municipios de riesgo](https://www.andreybusiness.com/blog/alertas-dropi-municipios-alto-riesgo-despacho-2026) | Interesa medir transportadora y destino. No se bloquean municipios con listas ajenas ni muestras pequeñas; una novedad tampoco equivale necesariamente a una devolución. |
| [Andrey: automatizaciones](https://www.andreybusiness.com/blog/automatizaciones-en-dropi-configuracion-completa-2026) | El URL dice 2026, el título 2025 y la fecha visible es diciembre de 2024. Es contexto histórico, no un manual técnico vigente para conectar Riverz. |

El blog mezcla experiencia propia, promoción y afirmaciones generales. Incluso presenta las alertas geográficas como función en una guía y como análisis propio en otra. Los porcentajes de recuperación, tiempos de devolución, número de intentos, tarifas y endpoints deben confirmarse por cuenta, país y transportadora antes de ejecutarse.

### Rastreo de Envía comprobado

El registro actual de Riverz ya contiene el enlace directo:

`https://hub.envia.co/landingrastreo/Rastreo/Index?guia={guia}`

Se hizo una consulta de lectura al dominio oficial con la guía aportada. La respuesta HTML mostró el título y campo de tracking correspondientes a esa misma guía. No se solicitó reintento ni se cambió ninguna instrucción de entrega. No se dedujo una novedad a partir del HTML o de los iconos.

La validación técnica conserva ceros iniciales, exige HTTPS, dominio esperado, guía coincidente y verificación reciente. Para otras transportadoras, un enlace general del registro existente no basta para este nuevo flujo: se debe verificar un enlace específico antes de preparar el mensaje.

## Proceso propuesto

### A. Confirmación y cierre

Pedido identificado → comprobar datos/stock → seguimiento vigente de WhatsApp → llamadas previstas → esperar resultado y cualquier devolución de llamada → confirmar evidencia → proponer despacho del pedido existente.

Si el cliente cancela explícitamente, proponer cancelación solo antes de despacho y cuando Dropi permita esa acción. Si no responde, exigir que termine la secuencia completa, no haya fallos técnicos sin resolver, no quede una llamada pendiente y venza la espera final. La cancelación por agotamiento está deshabilitada incluso como política predeterminada del borrador.

La propuesta del video de tres días sirve para revisar la configuración actual, no para reemplazarla automáticamente. Los horarios deben usar la zona del comercio y la disponibilidad del cliente. Un fallo de llamada o mensaje pasa a contingencia; no se considera intento humano efectivo sin evidencia.

### B. Novedad oficial

Leer registro oficial con identificador, causa, fecha, estado y necesidad de acción. Si únicamente hay nota de intento fallido o reintento previsto, observar. Si hay una novedad oficial activa, verificar guía/enlace y redactar según la causa. Daños, pérdida, rechazo, contradicciones y causa desconocida requieren revisión específica.

La respuesta del cliente pausa el seguimiento. Corregir dirección o acordar disponibilidad no implica que la transportadora haya aceptado la instrucción. Debe registrarse y comprobarse esa aceptación antes de prometer una fecha.

### C. Seguimiento de novedad sin respuesta

Se identifica por pedido **e identificador de novedad**. Comienza desde la entrega comprobada del aviso, no desde su creación. La propuesta inicial de espera es tres horas, configurable y sin programar. Después se prepara una llamada con el mismo contexto del chat y sin permiso de despacho.

Una novedad nueva no hereda el reloj de la anterior. Respuesta, entrega del paquete, resolución, rechazo de contacto o intervención humana detienen la secuencia. Al agotar el seguimiento se deriva a revisión; no se cancela un paquete en tránsito por silencio.

### D. Control general de la operación

Propuesta para la siguiente fase: mensajes fallidos o sin recibo, pedidos sin recogida, novedades cercanas a su plazo real, solicitudes al proveedor sin respuesta, devoluciones para investigar y pedidos entregados pendientes de conciliación.

El borrador detecta demora del proveedor desde 24 horas como alerta interna de prueba, no como incumplimiento contractual. Antes de operar se configura por proveedor, días hábiles y hora de corte.

Las métricas propuestas distinguen cancelaciones / pedidos creados, entregados / despachados y retornados / despachados; muestran pedidos todavía abiertos y fecha de corte. Se desglosan por producto, proveedor, ciudad, transportadora y motivo. Se mide recuperación de novedades por entrega final, no solo por mensajes respondidos. No se automatizan movimientos de wallet ni descuentos.

## Contrato pendiente para conectar a producción

1. Identificar IDs de comercio, pedido Shopify, pedido Dropi y contacto. La revisión comercial cambia cuando cambian producto, dirección o importe; no cambia con cada consulta de tracking.
2. Verificar lecturas disponibles de órdenes, historial, guía y módulo de novedades. Esta investigación no encontró documentación pública suficiente para implementar contratos autenticados de confirmación/cancelación/novedades sin verificarlos. No inventar URLs ni cuerpos de solicitudes.
3. Mapear “pendiente” posterior a confirmación a espera de proveedor; no volver a confirmar o crear la orden. El método existente `pushOrderToDropi` es creación/envío genérico y no sustituye una acción idempotente sobre una orden existente.
4. Conciliar los resultados reales de llamadas y mensajes en las evidencias normalizadas. El adaptador `confirmationFromVoice` está preparado, pero no está conectado al webhook vivo. Usar también el contexto privado que vincula agente y conversación.
5. Implementar persistencia con unicidad por comercio/pedido/acción/ciclo, bloqueo de concurrencia y bandeja transaccional de acciones. Las claves actuales son propuestas; no garantizan deduplicación persistente. Tras una respuesta incierta de Dropi, consultar el estado antes de reintentar.
6. Justo antes de ejecutar, volver a leer pedido, mensajes entrantes, llamadas y permiso operativo. Una vista previa nunca autoriza una ejecución posterior sobre datos que ya cambiaron.
7. Usar el envío de WhatsApp y la cola de voz existentes, con sus restricciones de entrega, idioma y horarios. No crear un segundo emisor en paralelo con Dropi/Chatea u otra automatización del comercio.
8. Verificar reglas de copia con conversaciones reales: retomar lo que ya dijo el cliente, no volver a pedir datos confirmados, no inventar visitas, disponibilidad, cobros, descuentos ni urgencia. Las cuatro variantes actuales son base factual; aún no hay reescritura por IA basada en historial.
9. Mantener el borrador sin consumidores de producción hasta que el dueño pida activarlo. El siguiente paso técnico es un adaptador de lectura y una vista de simulación con datos reales; no hay una activación pendiente de reloj.

La integración de llamadas que ya existía no se alteró. Antes de conectar este flujo debe verificarse su ruta actual de escritura COD para que ninguna llamada de incidencias pase por creación de pedidos. El contexto preparado aquí la deshabilita explícitamente.

## Avance implementado: revisión real y copy de confirmación

La pantalla `/logistica` (inglés `/logistics`), accesible desde Pedidos, consulta Shopify en páginas de 25 pedidos y cruza contactos, conversación reciente y llamadas de Riverz dentro del mismo comercio. Su endpoint autenticado es `GET /api/integrations/dropi/preview`. No envía mensajes, no agenda llamadas y no modifica órdenes. El historial de un contacto puede pertenecer a varios pedidos: se muestra como contexto, nunca como confirmación automática.

Una guía registrada no prueba recogida física. Una entrega parcial tampoco prueba la entrega completa. Los estados de Shopify no se convierten en novedades oficiales de Dropi. Los enlaces de transportadora se muestran con su guía y como pendientes de verificación; esta pantalla no autoriza su envío.

La consulta real del comercio encontró seis pedidos y 22 mensajes recientes. No encontró llamadas asociadas a esos pedidos ni una conexión de Dropi. El dueño confirmó que todavía no tiene acceso ni documentación. La conexión, escritura sobre órdenes existentes, recepción de novedades oficiales y ejecución persistente del seguimiento continúan pendientes de ese contrato; no se han simulado como funciones operativas ni activado consumidores de producción.

Las tres plantillas de confirmación, recordatorio y última revisión se reescribieron en español e inglés: saludo por primer nombre, emojis, párrafos cortos, producto real y total legible (`110.000 COP`). Se quitó DeUNA del cuerpo, conservando los nombres internos. No prometen despacho, descuentos ni fechas. El precio original del pedido se conserva; las variables de presentación son independientes.

Las seis versiones `*_datos_v3` se enviaron a Meta. El script `scripts/refresh-deuna-confirmation-copy.ts` consulta su aprobación. Solo `--apply --deployed-commit=<commit completo>` permite sustituir las referencias de los tres pasos existentes, después de comprobar aprobación española y despliegue de las variables nuevas. Preserva esperas, llamada, contexto de revisión de datos y estado de activación. No reenvía mensajes a clientes ni reinicia seguimientos.

Validación: casos de límites entre Shopify y Dropi, aislamiento de la consulta autenticada, formato de moneda, compatibilidad real de los seis cuerpos con el constructor de Meta y motor de decisiones del borrador. La aprobación de Meta es externa; enviar una plantilla a revisión no significa que esté aprobada o utilizada por el flujo.

## Avance implementado: novedades futuras de entrega

El 28 de septiembre de 2026 se conectó una señal operativa segura sin atribuirle a Dropi datos que Shopify no demuestra. El webhook de Shopify reconoce los estados logísticos estructurados `failure` y `attempted_delivery`. También acepta una convención explícita aplicada en Shopify por el comercio o por una integración autorizada: etiquetas exactas `NOVEDAD` / `NOVEDAD: <causa>` y `NOVEDAD SOLUCIONADA`. Una etiqueta no prueba por sí sola que Dropi la haya escrito. Notas libres y mensajes del cliente nunca se convierten en novedades oficiales.

La detección compara el estado anterior guardado con el nuevo. Una actualización repetida no vuelve a contactar al cliente. Una solución explícita o la reanudación comprobada del movimiento cierra la espera de esa novedad. Riverz publica además `delivery.incident.opened` y `delivery.incident.resolved` hacia los webhooks configurados por el comercio.

Para Riverz oficial se prepara de forma idempotente la automatización `DeUNA Shop · Novedad de entrega`. El primer paso usa una plantilla Utility bilingüe con producto, causa, guía y enlace directo; luego conserva una espera de 72 horas para que una respuesta entregue el chat a la asesora con el contexto completo. La plantilla se envía a revisión de Meta desde el trabajo periódico `dropi-incident-setup`; la automatización permanece armada, sin enviar, hasta que la versión española esté aprobada y WhatsApp esté operativo.

La guía del agente prohíbe prometer un nuevo intento o decir que Dropi aceptó una corrección sin evidencia. La novedad que ya existía antes de desplegar este cambio no se reprocesa ni contacta: el dueño pidió que el flujo aplique a las próximas.

La investigación local encontró y verificó contra Dropi la lectura `GET https://api.dropi.co/api/orders/myorders/novelties`, autenticada mediante `X-Authorization` y los encabezados de navegador documentados en el conector interno. No se incorporó todavía como fuente de producción: el acceso a `riverzoficial@gmail.com` llegó correctamente hasta el segundo factor de Dropi, pero no había un código TOTP autorizado en esta sesión; además, sin una fila real no se capturó el esquema de una novedad para enlazarla de forma fiable con pedido, cliente y conversación. La escritura para resolver novedades sigue deliberadamente deshabilitada porque su endpoint y forma no están verificados. Mientras tanto, Riverz usa solo las señales estructuradas de Shopify descritas arriba y publica la fuente exacta en cada evento.

Fuentes oficiales consultadas:

- https://www.dropi.co/servicio-logistico
- https://wf.dropi.co/integraciones
- https://dropi.co/terminos-y-condiciones
