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

Versiones de reglas publicadas: salud `ok`, Supabase y WhatsApp `ok`, revisión `1299d93430c56b6ca37ee69e3d156c3686bac1e0`, comprobada el 30 de septiembre a las 12:56 UTC.

Segunda entrega A1, prueba individual con conversaciones:

- Selector de conversaciones recientes y búsqueda por nombre dentro del panel actual de cada regla. Solo incluye casos vivos del negocio activo y respeta la propiedad de Gmail, Outlook y Zoho, comprobada de nuevo antes de devolver resultados.
- Prueba sobre el borrador guardado o la versión actual y el historial hasta el último mensaje del cliente. Excluye las respuestas posteriores para no reutilizar como propuesta lo que el asistente ya contestó. Utiliza hasta doscientos mensajes y sesenta mil caracteres de texto y transcripciones existentes; indica cobertura y omisiones.
- La prueba usa personalidad, reglas compatibles y permisos actuales. Es una prueba limitada de reglas: no consulta el catálogo en vivo ni ejecuta herramientas. La respuesta siempre aparece como propuesta no enviada; los conflictos son observaciones posibles, sin certificar ausencia cuando el modelo no señala ninguno.
- Una llamada de texto con los límites, saldo, clave y medición actuales, conservando la posibilidad existente de probar antes del pago inicial. No se envían mensajes, no se ejecutan cobros ni otras acciones, no se modifica memoria ni se publica la regla. Los contenidos del cliente no autorizan operaciones.
- Registro persistente de versión actual y borrador, reglas del contexto, cobertura, huella del texto consultado y resultado público. Solo se admite JSON acotado, sin razonamiento privado ni referencias a reglas desconocidas. No guarda una copia adicional del hilo ni notas internas. La lectura del registro exige pertenencia y acceso actual al caso; se elimina con la conversación o el negocio y conserva referencias al eliminar la regla o el autor.
- La escritura final comprueba revisiones de regla, borrador y reglas del contexto, configuración y actividad del asistente, acceso al buzón y modo de lectura. Solo un resultado correspondiente al borrador actual lo marca como Prueba; editarlo vuelve a Borrador. Publicar sigue siendo una decisión separada del administrador.

Validación: **136 archivos y 1.099 pruebas correctas**, TypeScript y build completo correctos, lint sin errores. Incluye revocación de acceso, aislamiento del negocio, exclusión de respuestas posteriores, omisiones, presupuesto, respuestas inválidas y cambios concurrentes. La migración 314 pasó PostgreSQL embebido dos veces, se aplicó dos veces de forma atómica y su contrato se verificó en Supabase sin escribir casos reales. El modelo se simuló en QA: no se gastó saldo de clientes ni se reproducían conversaciones privadas reales. Publicación por comprobar después del push. La conexión de permisos de acciones contextuales, la explicación de herramientas y las métricas siguen en ejecución; no se declara completado el plan.

Prueba individual de reglas publicada dentro de la revisión `3fdd05562c3f5fa44bc040b2625ace924f41b19c`, que contiene `31bbdd36`. Salud, Supabase y WhatsApp `ok`, comprobados el 30 de septiembre a las 13:28 UTC. La revisión posterior incluye otros cambios del proyecto.

## Ejecución A2

Primera entrega de actividad observable:

- Un icono contextual en los mensajes del cliente y del superasistente abre la actividad de ese turno. Conserva la barra de acciones y no agrega navegación. Distingue respuesta enviada, omitida, pendiente, fallida o resultado sin registrar, y traduce los motivos existentes.
- Versiones y nombres de las reglas disponibles, referencias del catálogo y de mensajes preparados en el contexto. No afirma que todas las reglas se aplicaron ni que una referencia explica cada afirmación del modelo. El nombre y la versión observados se conservan aunque la regla cambie después.
- Herramientas observadas en orden: solicitud bloqueada, respuesta recibida, error informado, aprobación solicitada o resultado sin verificar. Una respuesta `ok` no se convierte en evidencia de una acción completada. Las herramientas del proveedor registran la solicitud observada sin inventar su resultado. No guarda argumentos, consultas privadas, respuestas crudas del proveedor, claves ni razonamiento del modelo.
- Un registro por intento del runner, con aislamiento entre turnos concurrentes. Vincula todos los mensajes y archivos efectivamente generados en esa respuesta. Un fallo posterior conserva sus referencias y se presenta como fallo del turno; no afirma que nada se envió. La auditoría no modifica herramientas, permisos, reintentos o decisiones existentes. Un fallo de almacenamiento nunca repite una acción ni convierte una respuesta enviada en otro intento.
- Lectura restringida al negocio activo, caso vivo y acceso actual a buzones personales. El servidor comprueba el acceso de nuevo tras consultar los registros. No devuelve el campo de error crudo de los registros antiguos. Las referencias se verifican contra mensajes del caso y `shopify_products` del mismo negocio. El registro se elimina con el caso o el negocio y conserva la historia cuando se elimina el asistente.
- Contadores de treinta días por regla, dentro de su panel plegable: turnos registrados, conversaciones distintas, turnos fallidos y turnos que solicitaron aprobación. Solo cuentan casos actualmente accesibles, sin duplicar conversaciones. Son observaciones de contexto; no se presentan como aplicación o resolución atribuida a la regla. Los turnos anteriores a la instrumentación no se inventan.
- Los registros anteriores de `ai_replies` siguen disponibles con modelo, nombres de herramientas y estado. La ausencia de un registro nuevo no se interpreta como ausencia de reglas o acciones. La instrumentación nueva cubre el runner unificado; las superficies que generan por otro motor mantienen su registro existente y no se declaran instrumentadas por esta entrega.

Validación acumulada: **206 archivos y 1.703 pruebas correctas**, TypeScript completo y build correctos en la copia aislada, lint sin errores. La suite completa inicial pasó 1.700 pruebas y encontró un simulador antiguo del SDK que no implementaba las lecturas de mensualidad; se corrigió el simulador y se comprobó además que una deuda vencida evita el transporte y la reserva de saldo. La revisión del catálogo corrigió el nombre de tabla en auditoría y en el fixture y añadió una prueba positiva y una negativa de pertenencia. La migración 316 se comprobó con PostgreSQL embebido, se aplicó atómicamente y se volvieron a verificar contratos y dependencias reales en Supabase antes del push. El número 315 pertenece a otra tarea concurrente y no se mezcló con esta entrega. No se generaron respuestas ni ejecutaron operaciones sobre clientes reales para QA. La compilación se congeló sobre `110c5a34` y los cambios propios; los cambios ajenos sin commit se conservaron fuera de la validación y del commit. Publicación por comprobar después del push. La atribución comprobable de aplicación, resolución y fuentes por afirmación, y los permisos adicionales de acciones contextuales, continúan en ejecución.


## Presentacion reservada para comparacion (instruccion del dueno, 30 de septiembre)

El dueno solicito ocultar todas las incorporaciones visuales de este plan mientras sigue el desarrollo y comparar la interfaz actual con la nueva al terminar. Las incorporaciones quedan detras de `SHOW_RIVERZ_IMPROVEMENTS`, apagado por defecto; solo un build de comparacion configurado expresamente con `NEXT_PUBLIC_RIVERZ_UI_STAGE=comparison` las muestra. No se configura ese valor en produccion. La condicion afecta presentacion, nunca permisos ni autorizacion de APIs. Toda ampliacion visual posterior debe usar la misma condicion.

Se ocultan Equipo y notas, Herramientas del caso, traduccion por mensaje y de borradores, evidencias del asistente, vistas guardadas, avisos y capacidad del equipo, macros y acciones masivas nuevas, distintivos de prioridad, accesos operativos y acciones de pedidos, versiones/pruebas/actividad de reglas, generacion de plantillas y ajustes adicionales de horario. Las pantallas y controles anteriores permanecen. La creacion tradicional de una regla vuelve a su formulario anterior para administradores, sin crear borradores inaccesibles; conserva validacion, auditoria y comprobacion de permisos. La seleccion masiva anterior permanece disponible para administradores.

Los arreglos de contratos, privacidad, errores y seguridad permanecen. El trabajo parcial A3 y los cambios concurrentes de otras tareas no forman parte de esta publicacion de visibilidad. Validacion y revision desplegada se registran tras comprobarlas.

Validacion de la reserva visual: **32 archivos y 243 pruebas correctas**, TypeScript y build completos correctos sobre `bc3418b9` mas los cambios propios. La prueba comprueba que los controles nuevos no se montan en sus padres normales, y que solo el valor explicito de comparacion los habilita. Lint no introduce errores: conserva un error previo de `react-hooks/set-state-in-effect` en el panel Shopify (comprobado en el commit base) y quince advertencias existentes. No se modifico ese efecto durante esta entrega. Publicacion por comprobar despues del push.

Auditoria A2 publicada: salud, Supabase y WhatsApp `ok`, revision `d5c40ef19ea73c16749fc6551f8641bfb7d90bfe`, comprobada el 30 de septiembre a las 15:11 UTC.

Reserva visual publicada: salud, Supabase y WhatsApp `ok`, revisión `60148d35410ae1a52bebc2d9eba940e2a08e2740`, comprobada el 30 de septiembre a las 15:43 UTC. Las incorporaciones visuales permanecen apagadas en el build habitual.

## Primera entrega A3: respuestas humanas con origen y guardado atómico

La agrupación de Huecos, el formulario para responder y los destinos FAQ de producto o regla de negocio ya existían. Se conservan; esta entrega mejora sus permisos, comprobantes y supervisión. No crea una segunda fuente de conocimiento.

- El negocio activo y el usuario se obtienen de la sesión actual. La lectura de preguntas, resolución manual, revisión y confirmación comprueban pertenencia, existencia del caso y propiedad actual de los buzones personales. La misma lectura se utiliza desde el Operador y MCP; el autor MCP es su emisor autenticado, nunca la etiqueta de una llave. Los detalles de preguntas dentro del caso utilizan el mismo filtro.
- La pregunta revisada debe corresponder a registros pendientes realmente accesibles. La revisión recoge destino, respuesta humana, respuestas equivalentes que se sustituirán, autor, fuentes y fecha; vence en diez minutos. Prepararla no modifica FAQ, regla ni estado de las preguntas.
- Confirmar utiliza únicamente el identificador de esa revisión. La transacción comprueba de nuevo accesos y permisos, plazo, estado de las preguntas, modo de lectura y la instantánea del destino. Bloquea las filas relevantes y comprueba otra vez autorización y plazo después de esperar por los bloqueos. Un editor simultáneo provoca conflicto; no se sobrescriben sus cambios.
- La FAQ y su material de entrenamiento se guardan juntos, utilizando el compilador compartido existente. Una regla conserva el origen `hueco` y el historial real de versiones con su autor. Publicar una política del negocio exige administrador, como en el editor de reglas actual. Una confirmación repetida devuelve el comprobante previo sin duplicar escrituras. Las preguntas nuevas posteriores a la revisión permanecen pendientes.
- El Operador y MCP reutilizan el mismo servicio cuando se indica una pregunta pendiente. No cierran grupos privados mediante una actualización independiente. La edición genérica de una FAQ, sin pregunta pendiente, conserva su comportamiento anterior y no afirma haber cerrado un hueco.
- El historial registra las respuestas humanas publicadas, su destino, autor, fecha y registros de origen. No inventa historia previa. Se conserva al eliminar al autor, sin retener su identidad eliminada, y se borra con el negocio. La lectura exige acceso actual a todas sus fuentes. Borrar o revocar el caso no convierte su pregunta en una pregunta pública: la procedencia permanece marcada, también tras borrar físicamente la conversación. Los registros históricos huérfanos sin procedencia recuperable se excluyen; no se eliminan.
- Las claves mantienen la agrupación existente para preguntas cortas en español, admiten alfabetos distintos del latino y evitan unir preguntas largas que comparten un prefijo. Las FAQs con la misma pregunta normalizada se sustituyen juntas, preservando las otras. No se certifica una equivalencia semántica mediante IA.
- El panel indica errores reales en lugar de mostrar una lista vacía como si hubiera cargado correctamente. Los contadores son incidencias de la muestra accesible, no personas distintas. La comparación reservada incorpora revisión previa, origen y un historial plegable. Esos controles usan la misma condición de visibilidad apagada por defecto; el formulario habitual conserva su botón Guardar y prepara y confirma internamente el comprobante de la respuesta que el usuario escribió. Una llamada antigua sin revisión recibe un error explícito, evitando un éxito aparente en clientes con código en caché.
- La herramienta que registra una pregunta ya no afirma que fue guardada cuando falla la escritura. Si la pregunta se guardó pero el traspaso no se confirmó, distingue ambos resultados y no promete que alguien recibió un aviso. Guardar conocimiento no envía una respuesta al cliente ni garantiza lo que un modelo responderá posteriormente.

Validación acumulada: **213 archivos y 1.767 pruebas correctas**. El recorrido amplio inicial pasó 1.765 de 1.766; el único fallo era el simulador del endpoint que devolvía 502 para un contexto inexistente en lugar del 404 real. Se corrigió ese simulador, se volvió a comprobar la suite del bloque y se añadió el caso de borrado físico: 46 pruebas finales y 13 del SQL con bloqueos y permisos. TypeScript, build completo y lint de los cambios correctos. La copia se congeló sobre `bb9faea2` y los cambios propios, conservando fuera las ediciones concurrentes.

La migración 317 se probó dos veces en PostgreSQL embebido y se aplicó y volvió a aplicar atómicamente. Sus cinco RPC y dependencias se verificaron con contextos inválidos que no escriben datos. Una comprobación de solo lectura sobre Supabase confirmó que las instantáneas reales de producto y regla obtenidas por REST coinciden con la comparación SQL; no se escribieron preguntas, FAQs, reglas ni mensajes de clientes para QA. El build de producción exige este esquema antes de compilar. Publicación por comprobar después del push.

La consulta interna al dueño y su aprendizaje contextual continúan en A3 sobre los avisos existentes. Esta entrega no declara completado todo A3, A1/A2 ni el plan; tampoco activa los controles nuevos en la interfaz habitual.

Primera entrega A3 publicada: salud, Supabase y WhatsApp `ok`, revisión `1b9bc83668565db69dd3e11e553bd177c55585f0`, comprobada el 30 de septiembre a las 16:55 UTC.

Ajuste de supervisión A3: `productos.responder_hueco` exige la confirmación existente del Operador y MCP antes de publicar una respuesta generada como conocimiento para futuros clientes. El historial la presenta como respuesta revisada, sin afirmar que fue redactada exclusivamente por una persona. La reserva visual permanece apagada. Validación del ajuste: **30 archivos y 345 pruebas correctas**, TypeScript y lint correctos en la copia aislada; no se enviaron mensajes ni se publicó conocimiento de clientes para QA. Publicación del ajuste por comprobar después del push.

Ajuste de supervisión publicado: salud, Supabase y WhatsApp `ok`, revisión `89d0c643fd7e298f13e8f2fabde3e1dfaac00860`, comprobada el 30 de septiembre a las 17:22 UTC.

## Segunda entrega A3: respuesta interna limitada al caso

- Reutiliza las preguntas realmente registradas en `answer_gaps`, dentro del caso vivo y del negocio activo. El equipo puede guardar una respuesta específica para esa conversación sin publicarla en FAQs ni reglas. No cierra el hueco de conocimiento, reanuda el asistente ni envía un mensaje al cliente. El conocimiento permanente continúa por la revisión separada de la primera entrega.
- Guarda versiones inmutables con autor y fecha. Un comprobante UUID permite reconocer un reintento idéntico; un editor desactualizado encuentra conflicto en lugar de reemplazar al compañero. Una respuesta cuyo caso o buzón dejó de ser accesible tampoco se devuelve ni admite reintentos.
- La transacción bloquea pertenencia, negocio, pregunta, conversación y buzón antes de volver a comprobar el acceso. Conserva comprobantes anteriores al pasar a modo de lectura; impide nuevas escrituras. Las respuestas se borran con su conversación, pregunta o negocio y eliminan la identidad del autor cuando se elimina su cuenta. Los clientes no pueden escribir directamente ni invocar las RPC de servicio.
- El panel nuevo queda plegado dentro de Equipo y notas y detrás de `SHOW_RIVERZ_IMPROVEMENTS`, apagado por defecto. Muestra la respuesta actual, versión y fecha, permite editarla y copiarla para una respuesta manual, y declara expresamente que guardar no envía nada. No reemplaza borradores del compositor. Carga una muestra acotada de las cincuenta preguntas recientes del caso y distingue fallos de una lista vacía.

Validación: **42 archivos y 314 pruebas correctas**, incluyendo diez pruebas del esquema con PostgreSQL embebido y aplicación repetida de la migración. Build completo, TypeScript y lint correctos sobre `023e4222` más los cambios propios. La primera comprobación de tipos, ejecutada simultáneamente con la regeneración de rutas del build, leyó tipos de rutas incompletos de `.next`; el build terminó correctamente y la comprobación independiente pasó después de su generación. La migración 318 se aplicó atómicamente y el guard verificó tabla y dos RPC con contextos inválidos sin escribir casos reales. El guard de conocimiento existente exige también este esquema en producción. No se enviaron mensajes, no se consultaron modelos ni se modificaron preguntas reales para QA.

La solicitud al equipo por WhatsApp y el uso contextual de una respuesta humana por el modelo siguen en A3. Esta entrega agrega el destino interno explícito del caso y no declara terminado ese bloque ni el plan completo. Publicación por comprobar después del push; la interfaz habitual continúa reservada.

## Tercera entrega A3: solicitud interna por WhatsApp con comprobante

- Un miembro con acceso actual al caso puede solicitar un aviso a los destinatarios existentes de operación. Reutiliza el WhatsApp de plataforma y su plantilla configurada, sin crear una nueva integración. El aviso contiene un enlace al caso que exige sesión y acceso actual; no incluye el nombre, mensajes ni pregunta del cliente. El equipo responde dentro de Riverz, con el destino limitado al caso de la entrega anterior. No recibe respuestas por WhatsApp en esta entrega.
- Los avisos nuevos requieren `RIVERZ_CASE_QUESTION_WHATSAPP=enabled` en el servidor; cualquier otro valor los mantiene apagados. No se habilita esa variable durante la publicación. El control visual continúa dentro del componente de comparación reservado, y además solo aparece si el servidor habilitó el transporte. Los avisos de escalada anteriores conservan su comportamiento.
- Una reserva por pregunta y comprobante UUID evita duplicación. Cada destinatario se reclama antes de llamar al proveedor y vuelve a comprobar acceso, origen, modo de lectura, resolución de la pregunta y destinatarios actuales. Las preguntas ya contestadas dentro del caso tampoco generan un aviso nuevo. La reserva se limita a veinte preguntas por negocio durante una hora y a diez destinatarios configurados por solicitud.
- Una confirmación con identificador real de WhatsApp se muestra como solicitud aceptada por el proveedor, sin prometer entrega o lectura. Un rechazo explícito se distingue de un resultado incierto. Un transporte reclamado sin comprobante, incluido un proceso interrumpido tras intentar el envío, no se repite. Los destinatarios que dejaron de estar configurados se cancelan antes del intento. Los pendientes aún no reclamados pueden continuar con el mismo comprobante y autor; otro comprobante solo devuelve el estado existente.
- Guarda hashes de destinatarios y comprobantes del proveedor con acceso de servicio, sin números de teléfono ni contenido del cliente. La API devuelve únicamente contadores y fecha. Conserva los resultados del transporte aunque se elimine el autor, para poder registrar una acción ya intentada; revoca la lectura al perder acceso al caso. Los registros se eliminan con la pregunta, caso o negocio.

Validación: **46 archivos y 349 pruebas correctas**, nueve pruebas SQL nuevas y siete del endpoint de aviso. Build completo con TypeScript y lint correctos sobre `4eafbe20` más los cambios propios, sin incorporar cambios concurrentes de trazas o MCP. La migración 319 pasó aplicación repetida en PostgreSQL embebido, se aplicó atómicamente y sus dos tablas y cinco RPC se verificaron en Supabase con contextos inválidos que no escriben. No se envió ningún aviso real ni se gastó saldo de clientes en QA; el transporte se simuló. El guard de conocimiento exige el nuevo esquema antes de compilar en producción.

La API de Render confirmó el 30 de septiembre a las 17:54 UTC que `e1cfdb16`, que contiene la segunda entrega A3, seguía compilando, con otra revisión posterior en cola. Salud actual, Supabase y WhatsApp `ok`, todavía en `b4bf2618`. Esa entrega no se declara desplegada hasta comprobar un SHA que la contenga. La tercera entrega se comprobará después del push. El uso de la respuesta autorizada en el contexto del modelo y la detección de contradicciones continúan; A3 y el plan completo permanecen en ejecución.
