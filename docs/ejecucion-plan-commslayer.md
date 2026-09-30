# Ejecución del plan de mejoras de Riverz

Referencia: [plan final](plan-final-mejoras-riverz-commslayer.md). Inicio: 29 de septiembre de 2026.

Esta lista registra el estado real del trabajo. Una implementación local, una validación automatizada y una comprobación en producción son estados separados.

| Bloque | Implementación | Validación | Producción |
| --- | --- | --- | --- |
| P0A Contrato y ejecución de aprobaciones | Implementada | Pruebas y build correctos | Publicada; revisión de salud correcta |
| P0B Cifras del Operador | Implementada | Pruebas y build correctos | Publicada; revisión de salud correcta |
| P0C Disparadores de etiquetas y fecha | Implementada | Pruebas SQL y build correctos | Esquema y código publicados |
| P0D Plantillas y traducciones | Implementada | Pruebas y build correctos | Publicada; revisión de salud correcta |
| P0E Accesos y regresión | Implementada | Pruebas de aislamiento y build correctos | Publicada; revisión de salud correcta |
| B1 Colaboración en bandeja | Implementada | 147 pruebas, lint sin errores y build correctos | Publicada; salud de producción verificada |
| B2 Seguimiento y herramientas del equipo | Implementada | 569 pruebas, TypeScript, lint de cambios y build correctos | Publicada; salud de producción verificada |
| B3 Acciones de pedidos | Implementadas en la ficha: reembolsos, cancelaciones, dirección, artículos, reposiciones, retenciones compatibles y crédito de tienda | 852 pruebas, lint de cambios y build completo correctos; esquema 310 verificado | Publicadas; salud de producción verificada |
| B4 Comprensión de mensajes y audios | En ejecución: audios, resumen, traducciones y exportación; controles de spam, bloqueo y no leído en desarrollo | 949 pruebas, lint sin errores, TypeScript y build completo correctos | Resúmenes y traducciones publicados; transcripción a demanda y exportación en publicación |
| A1 a A3 Superasistente | Pendiente | Pendiente | Pendiente |
| C1 y C2 Crecimiento | Pendiente | Pendiente | Pendiente |
| O1 a O5 Autoservicio y operación | Pendiente | Pendiente | Pendiente |
| E1 a E4 Extensibilidad | Pendiente | Pendiente | Pendiente |
| X1 a X5 Paquetes posteriores | Pendiente | Pendiente | Pendiente |
| M1 a M5 Comunicación | Pendiente | Pendiente | Pendiente |
| Expansión a Estados Unidos | Decisiones comerciales pendientes | No modificada | No modificada |

## Entrega P0

- Contrato estricto de aprobar/rechazar, compatibilidad durante el despliegue, decisión atómica y comprobación de caducidad. Fallos de carga visibles con reintento.
- Atribución del Operador consume las categorías reales `ia`/`humano`; las etiquetas indican quién atendió, sin atribuir causalidad de cierre.
- Etiquetas: evento de base de datos únicamente en inserciones nuevas, automatización y cuenta exactas, cadena de hasta ocho reglas y corte de ciclos. Horarios: HH:mm o cron de cinco campos con zona del negocio o zona explícita; deduplicación de cada horario local, incluida la hora repetida por cambio de horario.
- Cola persistente con reclamo atómico y caducidad. Una ejecución interrumpida queda con resultado incierto y no se repite automáticamente. Las esperas y el historial por pasos siguen usando el motor actual.
- Generación con IA dentro del editor manual de plantillas: borrador editable y aplicación explícita. No lo envía a Meta. Calculadora localizada en ambos idiomas.
- Accesos desde la ficha del contacto a aprobaciones, devoluciones y logística, con filtro por contacto para las dos primeras. Aprobaciones antiguas se asocian por pedido. La navegación principal se conserva.

Validación del 29 de septiembre: **52 archivos y 452 pruebas correctas**, lint de las superficies nuevas y build completo de Next.js. Migración **303** aplicada de forma atómica; guard de esquema comprobado contra Supabase. La comprobación del despliegue se registra después del push, sin ejecutar envíos ni movimientos financieros como prueba.

P0 publicado: `riverz.co/api/health` devolvió estado `ok`, Supabase y WhatsApp `ok`, revisión `c48994f0764bdf83b8ca62fe1d5045f13397cc72`, descendiente del commit P0 `8a14ad80`. Esto verifica que el código está desplegado y el servicio responde; no sustituye una prueba funcional con acciones externas reales.

## Entrega B1

- Notas privadas separadas de los mensajes al cliente, menciones internas y notificaciones personales. Las inserciones y reintentos son atómicos e idempotentes. Los correos personales mantienen su restricción por dueño del buzón, también si una conversación cambia de canal o se elimina.
- Presencia por sesión con caducidad y versiones monotónicas. Aviso al escribir y revisión antes de enviar texto, archivos o plantillas si otro compañero está componiendo. Una caída del servicio de presencia permite revisar explícitamente el envío.
- Prioridad y motivo del caso dentro de un panel plegable, sin restaurar los controles retirados de la cabecera.
- Vistas personales o compartidas con canal, estado, responsable, prioridad y motivo; contadores consultados sobre el conjunto autorizado. Las configuraciones antiguas incompatibles se conservan y no se interpretan como filtros vacíos.
- Referencias manuales entre conversaciones del mismo contacto, con vista previa y confirmación; comprobación de acceso a ambos hilos y conservación del historial al retirar una referencia. No une automáticamente identidades ni conversaciones.
- Superficies y errores disponibles en español e inglés. La navegación actual se conserva.

Validación B1: **22 archivos y 147 pruebas correctas**, incluidos SQL, aislamiento, privacidad, reintentos, presencia fuera de orden y eliminación de referencias. TypeScript completo correcto, lint sin errores y build completo de Next.js correcto. Migración **304** aplicada de forma atómica y guard de esquema comprobado en Supabase. No se realizaron envíos a clientes para probar este bloque.

B1 publicado: salud `ok`, Supabase y WhatsApp `ok`, revisión de producción `6aa5f2c1356a637515f2331b80e274f5f19dfa4e`, comprobada el 30 de septiembre.

## Entrega B2

- Posponer y retomar un caso, con una vista de pospuestos y retorno automático por fecha o nuevo mensaje del cliente. Recordatorios personales, cancelación y avisos privados persistentes. No dependen de mantener una pestaña abierta.
- Macros compartidas con hasta diez acciones: prioridad y motivo, notas, etiquetas, seguimiento y asignación. Vista previa de destinos y confirmación explícita. Edición por versión y archivo; una versión cambiada exige revisión nueva. Cada caso se aplica en una transacción y un reintento conserva su resultado. Añadir etiquetas puede iniciar las automatizaciones activas existentes, y la vista previa lo indica.
- Acciones masivas sobre hasta cien identificadores seleccionados y revisados; nunca amplían el alcance a todo un canal. Se comprueba acceso a toda la selección antes de escribir y se devuelve éxito o fallo por caso. Reintentar los fallidos no duplica los completados. El borrado masivo sigue limitado a administradores y también usa la selección explícita.
- Equipos opcionales, disponibilidad individual, capacidad administrada y carga activa. Las reglas existentes y las automatizaciones usan el mismo control atómico de membresía, disponibilidad, privacidad del buzón y capacidad. Los casos en una cola de equipo se revisan cuando hay capacidad de nuevo; las asignaciones existentes se conservan.
- Atajos Alt+J/K para navegar y Alt+R/F para enfocar respuesta o búsqueda, fuera de campos de texto y diálogos. No envían mensajes, borran ni aprueban dinero. Herramientas plegables en la bandeja actual, en ambos idiomas.

Validación B2: **65 archivos y 569 pruebas correctas**, incluidos SQL real con PGlite, privacidad de recordatorios y su historial, permisos, reversión completa, recuperación por versión, selección explícita y atajos. TypeScript y build completo correctos; lint de las superficies modificadas sin errores, con advertencias existentes. La compilación se verificó en un worktree aislado con los cambios de este bloque porque había otras ediciones concurrentes sin publicar. Migración **307** aplicada atómicamente y guard verificado contra Supabase. No se usaron envíos a clientes ni movimientos financieros como pruebas.

B2 publicado: `riverz.co/api/health` devolvió salud `ok`, Supabase y WhatsApp `ok`, revisión `674ce85099dda48515a50bd9b887bdf7e476c54d`, el 30 de septiembre a las 05:18 UTC. Un mensaje histórico sincronizado no reabre un caso pospuesto después de su fecha original.

## Ejecución B3

La revisión del servicio compartido de reembolsos encontró que se calculaba sobre los cobros originales sin descontar devoluciones anteriores y que el espejo local marcaba un reembolso parcial como total. La corrección calcula el saldo real por transacción con aritmética decimal exacta, respeta pagos divididos, bloquea importes inválidos y devoluciones en proceso, verifica las transacciones devueltas por Shopify y consulta el estado financiero real antes de actualizar Riverz. Una respuesta HTTP exitosa sin confirmación financiera exige revisión y no se repite automáticamente. Estas correcciones preparan las acciones del panel; por sí solas no completan B3.

Validación de la base B3: **41 archivos y 222 pruebas correctas**, lint de los archivos modificados sin errores y build completo correcto en el worktree aislado. No se crearon reembolsos reales como prueba. Las acciones adicionales del panel siguen en ejecución.

La base B3, commit `37c722fb`, está publicada: salud `ok`, Supabase y WhatsApp `ok`, revisión `75b72c87cf6cee4d9183c650eeed1b3a8111e2e0`, descendiente de ese commit, comprobada el 30 de septiembre a las 06:15 UTC.

Primera entrega de controles B3:

- Cancelar y devolver el saldo cobrado, o devolver un importe parcial o total, dentro de la tarjeta de pedido existente. El panel permanece plegado hasta que se necesita.
- Vista previa persistente de diez minutos con pedido, saldo, moneda, pago, despacho y motivo. Se comprueban la tienda activa, la asociación local al contacto, su identidad en Shopify, los permisos concedidos y las devoluciones anteriores o pendientes. Un pedido cambiado exige una revisión nueva.
- Un agente puede preparar; la ejecución requiere confirmación explícita de un administrador vigente. La misma restricción se comprueba antes de consumir aprobaciones financieras existentes. El destinatario de una aprobación por WhatsApp debe seguir siendo el destinatario actual del negocio.
- Las aprobaciones por MCP conservan el usuario autenticado que creó la llave. No usan el nombre de la llave como UUID de usuario ni aceptan una identidad en los argumentos; se comprueba su rol actual antes de consumir una decisión financiera. Las llaves sin un emisor verificable no pueden autorizar esos movimientos.
- Un bloqueo persistente por pedido se comparte entre la bandeja y las aprobaciones del superasistente. Un resultado incierto no se repite ni libera automáticamente. Una revisión posterior verifica de nuevo el saldo y registra administrador, motivo y estado observado; una operación que sigue ejecutándose no se libera desde esa revisión.
- El historial guarda solicitante, aprobador, importe realmente devuelto, moneda, referencia y estado financiero observado. Las aprobaciones existentes también guardan un resultado estructurado. La cancelación se comprueba en Shopify antes de presentarla como realizada; el reembolso es un resultado separado.
- Contratos estrictos, CSRF, aislamiento por cuenta y contacto, privacidad de buzones personales y control de solo lectura por suscripción. Textos en español e inglés.

Validación: **83 archivos y 687 pruebas correctas**, incluidas diez pruebas de PostgreSQL real con PGlite, autorización previa a la decisión, identidad autenticada del MCP, concurrencia entre canales de aprobación, caducidad, resultados inciertos, cambios de pedido e importes exactos. Lint del nuevo panel, servicios, contratos, APIs y adaptadores sin errores. Build completo correcto en la copia aislada; se instalaron allí sus dependencias para independizarla del entorno compartido. Migración **310** aplicada atómicamente y guard de tablas y RPC comprobado contra Supabase. Las modificaciones de productos, variantes, cantidades y dirección, los borradores de reemplazo, la retención del despacho y el crédito de tienda siguen en desarrollo; esta entrega no completa B3. No se hicieron movimientos financieros reales como prueba.

Los controles de la ficha B3 están publicados: `riverz.co/api/health` devolvió salud `ok`, Supabase y WhatsApp `ok`, revisión `801846d143d35d5dca64c5abc08e003783ac9d27`, el 30 de septiembre a las 07:20 UTC.

Segunda entrega B3, cambios de dirección:

- Formulario dentro de las acciones plegables del pedido, rellenado con su dirección actual y selector de países en ambos idiomas. Conserva el destinatario, su teléfono y su empresa; permite cambiar únicamente los campos de envío.
- Vista previa de dirección actual y nueva, motivo y validación. Reutiliza Google cuando el negocio lo tiene conectado; una configuración ilegible o una caída de la validación no se interpreta como integración desactivada. Las coincidencias dudosas requieren revisión explícita; los datos incorrectos bloquean la preparación.
- Confirmación de administrador vigente, caducidad y bloqueo compartidos con las otras acciones del pedido. Un cambio en Shopify o en la dirección normalizada exige preparar otra vista previa. No exige un saldo cobrado para corregir un pedido pendiente de pago.
- Servicio compartido que vuelve a consultar el estado antes de modificar, impide cambios en pedidos cancelados o cuyo despacho comenzó y verifica la dirección guardada y el destinatario después de la respuesta. Historial de dirección anterior y posterior; los resultados inciertos no se repiten y su revisión consulta la dirección real, sin sustituirla por una comprobación del saldo.

Validación de dirección: **86 archivos y 711 pruebas correctas**, incluidos los contratos anidados, conservación del destinatario, revisión del estado antes de modificar, verificación posterior, rechazo de países distintos, validación caída, recuperación idempotente y bloqueo frente a aprobaciones financieras. Lint de los servicios, contratos, panel y APIs modificados sin errores; build completo correcto en la copia aislada. Reutiliza el esquema 310; no requiere una migración nueva. No se cambiaron direcciones reales de clientes como prueba.

Dirección publicada: salud `ok`, Supabase y WhatsApp `ok`, revisión `a6652cd5be9306dc2cd3d976125efe752d64bfe7`, comprobada el 30 de septiembre a las 07:48 UTC.

Tercera entrega B3, productos, variantes y cantidades:

- Selector del catálogo de la tienda activa, dentro de las acciones del pedido. Búsqueda por nombre, cantidades enteras, adición o retirada de líneas y descuentos explícitos del 100 %. No requiere escribir identificadores de Shopify; hasta veinte líneas y cien unidades por solicitud.
- Preparación de una edición provisional en Shopify, sin confirmar el pedido ni enviar avisos. La vista previa registra los productos actuales y propuestos, el total recalculado por Shopify en la moneda del comprador y la diferencia exacta, incluidos sus impuestos y descuentos. El cambio no cobra ni devuelve dinero; cualquier ajuste financiero se gestiona por separado.
- La confirmación usa la sesión y la cotización persistidas. Un cambio de pedido, precio, productos, cantidades o despacho exige otra revisión; no se reconstruye una edición diferente después de autorizarla. Se comprueba la escritura permitida por suscripción antes de iniciar la preparación.
- El superasistente y la ficha comparten los servicios de preparación y confirmación. Los servicios rechazan cantidades truncadas, variantes malformadas y listas incompletas, y verifican los artículos activos después de confirmar. La ficha además comprueba el total real y los descuentos gratuitos solicitados. El superasistente reconoce ahora una respuesta incierta al confirmar como resultado que necesita revisión.
- Las acciones humanas no modifican pedidos enviados a Dropi sin verificar primero su despacho en esa integración. Los resultados inciertos permanecen bloqueados; su revisión muestra los productos, cantidades y total actual, en lugar de sustituir esa comprobación por un saldo de reembolso.
- Historial con cotización, solicitante, confirmador, artículos verificados, total real y diferencia. Importes visibles con hasta seis decimales cuando el proveedor los devuelve, sin redondear silenciosamente una cifra revisada. Textos y selección disponibles en español e inglés.

Validación de productos: **97 archivos y 796 pruebas correctas**, incluidos aislamiento del catálogo, privacidad de la conversación, consentimiento previo, contratos de cantidades y descuentos, cotización cambiada, listas paginadas incompletas, despacho que inicia antes de confirmar, importe o variantes diferentes después de confirmar y recuperación de un resultado incierto. Ocho archivos y sesenta pruebas de regresión del superasistente incluidos. Lint de los servicios, contratos, paneles, APIs y adaptación del superasistente sin errores; build completo correcto en la copia aislada. Reutiliza el esquema 310, sin migración nueva. No se confirmaron ediciones de pedidos reales de clientes como prueba. Los borradores de reposición, la retención del despacho y el crédito de tienda siguen en desarrollo; B3 todavía no está completo.

Productos publicados: salud `ok`, Supabase y WhatsApp `ok`, revisión `74b730ec3a0db2ad72e3cb8444552ce9c209fbad`, comprobada el 30 de septiembre a las 08:41 UTC.

Cuarta entrega B3, borradores de reposición:

- Selección de variantes, cantidades y gratuidad desde el mismo panel plegable. Consulta el cliente actual del pedido y exige que coincida con el contacto autorizado; un correo histórico del pedido no basta para emitir un borrador a otro perfil. Conserva la dirección y el destinatario originales.
- La vista previa calcula artículos, descuentos y total con Shopify sin crear un borrador. La confirmación requiere administrador, versión de acción explícita, cotización sin cambios y bloqueo persistente. Las pantallas antiguas no pueden confirmar una reposición sin mostrar su revisión.
- Crea una sola vez un borrador oculto para el cliente, sin enviar factura, cobrar, completar el pedido ni solicitar despacho. Comprueba después su cliente, dirección, destinatario, moneda, artículos, total, estado e inexistencia de factura enviada o pedido confirmado. Los resultados incompletos permanecen inciertos y no se repiten automáticamente.
- La etiqueta de reposición forma parte de la creación inicial, evitando que el webhook lo incorpore antes a recuperación de borradores abandonados. Una referencia persistida mantiene la exclusión si después cambian sus etiquetas. No se crea un contacto para esa campaña; si la comprobación de exclusión falla, se captura el fallo sin encolar el borrador. La recuperación de ventas normales conserva su comportamiento.
- Historial con referencia y estado observado del borrador. Una respuesta perdida se puede inspeccionar por la etiqueta única de la operación; la revisión se vincula al borrador encontrado y no al saldo del pedido original. Ambigüedad, coincidencias múltiples o permisos insuficientes mantienen el bloqueo. Textos en español e inglés.

Validación de reposiciones: **100 archivos y 820 pruebas correctas**, incluidos perfil ajeno, cotización cambiada, cantidades y descuentos, borrador visible o facturado, dirección alterada, respuesta perdida, exclusión de campañas, firmas del webhook y confirmación de pantallas antiguas. Lint de los archivos modificados sin errores y build completo correcto en la copia aislada. Reutiliza el esquema 310; no requiere migración nueva. No se crearon borradores en tiendas reales ni se enviaron facturas para probar el cambio. Retención y crédito siguen en desarrollo; B3 todavía no está completo.

Permiso de reposición publicado en Shopify: configuración pública y legacy validada por CLI; versiones activas `riverz-reviewed-replacements-0930-v2` verificadas en ambas apps. La extensión de chat existente se conserva. OAuth solicita `write_draft_orders`; cada acción comprueba el permiso realmente concedido al token, sin asumir que publicar la configuración lo otorga automáticamente a las tiendas ya instaladas.

Reposiciones publicadas en Riverz: salud `ok`, Supabase y WhatsApp `ok`, revisión `edb99fe8a86598cc8c424551b933094d4363b45f`, comprobada el 30 de septiembre a las 09:15 UTC.

Quinta entrega B3, retención de preparación en Shopify:

- Acción en el mismo panel plegable, con vista previa de las preparaciones visibles y compatibles, sus ubicaciones, artículos, cantidades pendientes y retenciones actuales. Consulta permisos reales y las acciones que Shopify admite para cada preparación; bloquea listas incompletas, trabajo iniciado, pedidos despachados o enviados a Dropi. El alcance visible depende de los permisos de Shopify, y el panel lo explica sin presentar una retención en Shopify como parada de transportadoras externas.
- La vista previa no modifica Shopify. La confirmación vuelve a comprobar el pedido y la preparación revisada, incluida su ubicación y estado. Requiere administrador vigente, acción explícita y bloqueo persistente; los identificadores de preparación se derivan en el servidor y no se admiten en el formulario.
- Crea una retención con referencia única por operación para cada preparación revisada, sin avisos, cancelaciones, reembolsos ni despacho. Verifica el estado retenido y las referencias y motivos reales. Un resultado parcial o una respuesta perdida conserva las referencias obtenidas y queda incierto; no repite ni revierte automáticamente las retenciones. La liberación se gestiona en Shopify.
- La revisión consulta las preparaciones originales, incluso si después se cerraron o cambiaron; se vincula a cada estado observado. También exige un cliente que muestre la revisión correcta de dirección, artículos, reposición o retención. Una pantalla antigua que solo conoce saldos financieros no puede liberar esos bloqueos; las revisiones financieras anteriores siguen siendo compatibles.
- Historial de la vista previa, administrador, estado comprobado y referencias. Textos en español e inglés, con la navegación y los módulos existentes conservados.

Validación de retención: **102 archivos y 837 pruebas correctas**, incluidos preparación ajena, cambios de ubicación, despacho iniciado, listas paginadas, permisos, retención ajena, ejecución parcial, respuesta perdida, identificación de acción y revisión con una pantalla antigua. Lint de los cambios sin errores y build completo correcto en la copia aislada. La suite final se ejecutó sin compilación simultánea, con cuatro procesos: una prueba existente de credenciales había excedido cinco segundos bajo carga y pasó sin modificar su límite. Reutiliza el esquema 310, sin migración nueva. No se retuvieron preparaciones reales como prueba. El crédito de tienda seguía en desarrollo en esta entrega.

Retenciones publicadas: salud `ok`, Supabase y WhatsApp `ok`, revisión `288ae920831ac4e736109b71dc7740e711e3fc10`, comprobada el 30 de septiembre a las 09:51 UTC.

Sexta entrega B3, crédito de tienda:

- Vista previa sobre el perfil actual del cliente, con cuenta, saldo, moneda, importe explícito y saldo estimado. No emite fondos. Exige los permisos reales de cuentas y transacciones de crédito, una moneda compatible y las nuevas cuentas de cliente de Shopify.
- Confirmación por administrador con revisión del cliente, moneda, importe y disponibilidad del crédito en el checkout. Shopify no expone en esta consulta el interruptor del checkout: el administrador debe confirmar que su tienda admite ese medio. Emite crédito sin caducidad; no devuelve efectivo, cancela el pedido ni lo marca reembolsado.
- Verifica antes de emitir que la cuenta y el saldo revisados siguen vigentes. Usa un solo intento y el bloqueo persistente del pedido. Comprueba después la transacción real, su propietario, importe, moneda y ausencia de caducidad; distingue el saldo después de esa transacción del saldo actual, que puede cambiar por otros movimientos.
- Una respuesta perdida queda incierta y no se reemite automáticamente. La revisión muestra el saldo real y, cuando no hay referencia, los últimos veinte créditos. Un importe parecido no identifica la operación. La revisión humana registra el estado observado y libera el bloqueo sin presentar la operación original como completada.
- Panel e historial en español e inglés, con confirmación y revisión específicas de crédito; las pantallas antiguas que muestran únicamente reembolsos no pueden confirmarlo. Conserva los módulos, campañas, plantillas y navegación actuales.

Validación de crédito: **103 archivos y 852 pruebas correctas**, lint de los archivos modificados sin errores y build completo correcto en la copia aislada. Incluye contratos de importe, cuenta ajena, compatibilidad, permisos, cambios de saldo, recibos incorrectos, respuesta perdida y atribución de transacciones. Reutiliza el esquema 310; no requiere migración nueva. No se emitió crédito real como prueba.

Permisos publicados y verificados en Shopify: versiones activas `riverz-reviewed-credit-0930`, pública `1149540302849` y legacy `1149541318657`. Se conservan la configuración vigente y la extensión de chat. Publicar permisos no modifica automáticamente los permisos de tokens instalados: el servidor comprueba lo realmente concedido.

Las acciones contextuales manuales B3 están implementadas y validadas. El despliegue de crédito se comprueba después del push. Esta entrega no completa los bloques posteriores del plan ni incorpora estas acciones nuevas automáticamente a las herramientas del superasistente.

Crédito publicado: salud `ok`, Supabase y WhatsApp `ok`, revisión `bdaaf2656f33802455d804615aad94789273f6db`, comprobada el 30 de septiembre a las 10:08 UTC.

## Ejecución B4

Primera entrega de comprensión:

- Transcripciones ya guardadas visibles en el hilo, incluidas las de varios audios adjuntos, sin volver a pagar por leerlas. Resumen del audio a demanda sobre esa transcripción; las observaciones de imágenes no se presentan como audio transcrito.
- Resumen a demanda dentro de un panel plegable. Trabaja sobre un máximo de doscientos mensajes recientes no borrados y sesenta mil caracteres. Muestra el tramo y el número de mensajes cubiertos e indica las omisiones. No modifica la memoria del superasistente, los mensajes ni las notas privadas.
- Traducción a español, inglés, portugués, francés, italiano o alemán. La entrante consulta únicamente el mensaje autorizado; la saliente muestra original y traducción antes de aplicarla explícitamente al borrador. Permite restaurar el original y nunca envía por sí sola. Una vista previa cuyo borrador cambió se oculta para impedir aplicar una respuesta a un texto diferente.
- CSRF, pertenencia al negocio, privacidad de buzones personales y comprobación de acceso de nuevo después de la llamada al modelo. Reutiliza los límites y la facturación de IA existentes. No admite destinos externos, contenido entrante inventado ni operaciones de envío en el contrato.

Validación: **105 archivos y 865 pruebas correctas**, lint de los cambios sin errores, con siete advertencias preexistentes, y build completo correcto en la copia aislada. La comprobación inicial directa de TypeScript agotó el límite predeterminado de dos GB; el build completo terminó TypeScript correctamente con el límite de ocho GB ya usado por este proyecto. No se llamó al modelo con conversaciones reales ni se enviaron mensajes para probar estas superficies. No requiere migración nueva. La transcripción a demanda de audios pendientes, la exportación y los controles de spam, bloqueo y no leído continúan dentro de B4.

Comprensión publicada: salud `ok`, Supabase y WhatsApp `ok`, revisión `e90d5cab1ffe15060277b6e95d9063a947047ace`, comprobada el 30 de septiembre a las 10:31 UTC.

Segunda entrega de comprensión, audios pendientes y exportación:

- Transcripción a demanda sobre el archivo real del mensaje autorizado. Detecta el idioma en esta solicitud; los flujos anteriores conservan su configuración. Reutiliza transcripciones guardadas sin otro gasto y respeta el saldo y los límites de IA. El usuario puede resumir el audio desde el mismo hilo.
- Lectura de adjuntos privados restringida al negocio y al caso exactos. WhatsApp antiguo usa únicamente las credenciales de ese negocio para recuperar el archivo real. No descarga URLs arbitrarias, otros buzones ni objetos de otra conversación; controla bytes y tiempo.
- Comprobación de acceso antes del procesamiento y de nuevo antes de devolver el resultado. La escritura de la transcripción compara el archivo y la evidencia anteriores: un cambio concurrente se informa y no sobrescribe el mensaje nuevo ni otras observaciones de los adjuntos.
- ZIP con conversación legible, JSON y archivos disponibles, excluyendo notas internas, HTML activo, metadatos del proveedor y enlaces de adjuntos firmados. Pagina el historial por fecha e identificador y conserva el original. Límites explícitos de cinco mil mensajes, diez MB de texto y mil referencias de adjuntos; no entrega una conversación truncada como si estuviera completa.
- Incluye hasta cien archivos y cincuenta MB de contenido. Los archivos inaccesibles o excluidos por límites se identifican en el manifiesto y en el aviso de descarga. Los nombres se normalizan para impedir rutas fuera del ZIP y colisiones. El archivo no queda publicado en almacenamiento compartido. Recomprueba el acceso antes de permitir la descarga.

Validación: **113 archivos y 949 pruebas correctas**, incluidas pruebas de privacidad de archivos, descargas con DNS público verificado, límites, paginación, archivo ZIP, facturación y detección de idioma. Lint de los cambios sin errores y build completo correcto en la copia aislada. La comprobación final del archivo cambiado pasó otras once pruebas y TypeScript completo. Una prueba inicial reutilizaba el mismo objeto Response y fallaba al leerlo por segunda vez; se corrigió el simulador para generar una respuesta nueva por solicitud, sin debilitar la comprobación de facturación. No se transcribieron archivos de clientes reales ni se exportaron sus conversaciones como QA. No requiere migración nueva. Spam, bloqueo y no leído siguen en ejecución.

Audios y exportación publicados: salud `ok`, Supabase y WhatsApp `ok`, revisión `addc51a50a9a70206ef62b700083f76df4e536b8`, comprobada el 30 de septiembre a las 10:51 UTC.

Tercera entrega B4, disposición de casos:

- Marcar como no leído desde el panel plegable actual. La marca sigue contando después de una respuesta del equipo o de la IA y se conserva mientras el caso continúa abierto. Al volver a abrirlo se registra la lectura; no se elimina automáticamente una marca manual recién creada.
- Spam conserva mensajes, estado, asignación y configuración de IA. Sale de la bandeja ordinaria y de sus contadores; puede encontrarse con la búsqueda o una vista guardada de Spam, incluso si estaba pospuesto. Restaurar conserva la configuración anterior.
- El ingreso unificado sigue guardando mensajes y consentimiento. Los casos en spam no disparan respuestas ni flujos desde ese ingreso; el runner del asistente comprueba el estado antes de generar. Los adaptadores de salida comprueban de nuevo el caso y el negocio antes de enviar texto, archivos o plantillas, incluidos trabajos que comenzaron antes de marcar spam. El compositor indica que es necesario restaurar el caso.
- Comandos atómicos con versión esperada, recibo persistente e identificador de operación. Un reintento recupera su recibo; una decisión antigua no sobrescribe a otro asesor. El registro es accesible solo a miembros actuales y al propietario en los buzones personales. Las nuevas columnas no admiten cambios directos del cliente que eviten la auditoría.
- Leer sigue disponible cuando la suscripción está en modo de lectura; el endpoint exento solo acepta lectura y no permite spam, restauración ni marcar no leído. No cambia la política comercial. Interfaz y errores en español e inglés, conservando la navegación existente.

Validación: **121 archivos y 1.014 pruebas correctas**, TypeScript y build completo correctos, lint sin errores y siete advertencias existentes. Incluye aislamiento de negocio, privacidad de correo, versión concurrente, reintentos, preservación de ajustes, factura pendiente, protección de columnas y eliminación del autor sin perder el registro. La suite también detectó dos motivos existentes de comentarios sin política declarada: ahora conservan la decisión del equipo y tienen texto legible en ambos idiomas. La migración 311 pasó pruebas reales de PostgreSQL embebido, se aplicó dos veces de forma atómica y su contrato se comprobó contra Supabase. La credencial heredada de sesión produjo un HTTP 401 inicial; la credencial local vigente permitió aplicar el esquema. No se marcaron casos de clientes reales como QA.

Spam es una disposición del caso en Riverz. El bloqueo nativo de WhatsApp continúa como la siguiente parte de B4; esta entrega no declara un bloqueo del número en Meta ni completa las fases posteriores del plan.

Disposición publicada: salud `ok`, Supabase y WhatsApp `ok`, revisión `672a840559d5ad87d6933c1105fa6d05f64aa34b`, comprobada el 30 de septiembre a las 11:39 UTC.

Cuarta entrega B4, bloqueo nativo de WhatsApp:

- Consulta real de la lista de bloqueados de la cuenta correspondiente. Comprueba la identidad externa registrada del contacto, el negocio, el caso y la conexión actual; no utiliza un teléfono enviado por el navegador ni el campo de teléfono editable. Las identidades o conexiones que no se pueden comprobar muestran indisponibilidad.
- Vista previa con el contacto, destinatario exacto, cuenta de WhatsApp, estado actual y acción propuesta. Un administrador confirma el cambio; se comprueban otra vez identidad, configuración y estado antes de actuar. El historial se encuentra en el mismo panel plegable y muestra estados reales.
- Bloqueo y desbloqueo por los endpoints nativos de Meta. Exige un recibo individual del destinatario exacto y comprueba después su estado real; HTTP 200 por sí solo no significa éxito. Una lista incompleta o malformada nunca demuestra ausencia de bloqueo. La paginación reconstruye únicamente el endpoint fijo de Graph, sin reenviar credenciales a enlaces de continuación.
- Vista previa de diez minutos, operación persistente y bloqueo compartido por cuenta y destinatario. Un reintento recupera el resultado registrado y no vuelve a enviar el cambio. La autorización de despacho solo se consume una vez y vence a los sesenta segundos; comprueba los permisos actuales del administrador.
- Respuesta perdida o fallo de comprobación posterior conserva un resultado incierto. La revisión por administrador consulta de nuevo a Meta, registra motivo y estado observado y libera la operación pendiente sin atribuir ese estado a la solicitud original. Una operación en curso no admite revisión; una abandonada durante más de dos minutos puede revisarse y su permiso de despacho ya venció. No hay recuperación automática del cambio.
- Los registros y bloqueos se conservan al eliminar el caso, la conexión o el autor, dentro del negocio. Los buzones ajenos y otros negocios no participan. Textos y errores en español e inglés. Un fallo al refrescar la pantalla conserva el registro de la operación y exige consultar el estado antes de preparar otro cambio.

Validación: **125 archivos y 1.041 pruebas correctas**, TypeScript correcto y lint sin errores. Pruebas de recibos individuales, paginación, estados incompletos, pérdida de respuesta, permisos retirados, aislamiento, cambios de configuración, concurrencia, vencimiento de despacho, revisión y eliminación del autor o caso. La migración 312 pasó PostgreSQL embebido, se aplicó dos veces atómicamente y su esquema y contratos se comprobaron contra Supabase. No se bloquearon ni desbloquearon contactos reales como QA. Build completo correcto en la copia aislada; la publicación se comprueba después del push.

Referencia técnica primaria: [colección oficial de Meta, Block Users](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-bfd53137-07a0-4f88-a0bc-a15615a6dee2). Los adaptadores existentes conservan su versión de Graph; los endpoints nuevos utilizan v22.0. El bloqueo de Meta pertenece a esa cuenta de WhatsApp y no modifica el consentimiento, las listas de campañas, el spam local ni otros canales.

Bloqueo nativo publicado: salud `ok`, Supabase y WhatsApp `ok`, revisión `b6e0035148247e3c8c702aaee226409b0d149a15`, comprobada el 30 de septiembre a las 12:26 UTC.

## Ejecución A1

Primera entrega, versiones y borradores de reglas:

- Las reglas existentes conservan contenido, estado, orden y alcance. Cada cambio nuevo de los flujos manuales, del cuestionario, de Huecos o de mejoras supervisadas registra la versión observada, autor disponible y origen. La migración crea una línea inicial del estado actual; no inventa historial anterior.
- Edición y versiones dentro de un panel plegable en la pantalla actual. Los miembros preparan borradores; publicar, activar, apagar, eliminar o restaurar una regla publicada requiere administrador. Los borradores nuevos permanecen apagados. La creación tradicional por API conserva su contrato para administradores.
- Comparación de versiones de regla y borrador en operaciones atómicas. Un editor antiguo no sobrescribe a otra persona; un borrador basado en una regla cambiada requiere revisar y guardar sobre la versión actual. Restaurar conserva también estado, orden y alcance de la versión revisada.
- Historial paginado y solo lectura para el cliente. Se conserva al borrar una regla o su autor y se elimina con el negocio. La eliminación del negocio funciona incluso en modo de lectura. Los registros no contienen claves de proveedor ni contenido de conversaciones.
- Corrección de un fallo comprobado en Supabase: el constraint de origen rechazaba `base` y `hueco`, aunque los flujos existentes los escriben. Ahora reconoce esas fuentes sin recrear reglas eliminadas. El endpoint de reglas usa el negocio activo y no la primera membresía disponible. El límite de reglas activas se comprueba contra la capacidad real del prompt.

Validación: **133 archivos y 1.083 pruebas correctas**, TypeScript y build completos correctos en la copia aislada, lint de los cambios sin errores. La prueba de recorrido de archivos excedió cinco segundos cuando competía con el build; pasó aislada con veinte segundos de límite. La migración 313 se probó dos veces en PostgreSQL embebido, se aplicó dos veces de forma atómica y los cinco contratos se verificaron contra Supabase con contextos inválidos que no escriben datos. No se editaron reglas de clientes como QA. La prueba individual con conversaciones y sus conflictos continúa en A1; esta entrega no declara completado ese bloque ni las fases posteriores. Publicación por comprobar después del push.
