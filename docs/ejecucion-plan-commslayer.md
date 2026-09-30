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
| B3 Acciones de pedidos | Implementadas en la ficha: reembolsos, cancelaciones, dirección, artículos, reposiciones, retenciones compatibles y crédito de tienda | 852 pruebas, lint de cambios y build completo correctos; esquema 310 verificado | Todas salvo crédito verificadas en producción; crédito en publicación |
| B4 Comprensión de mensajes y audios | En ejecución: revisión de transcripciones y resúmenes existentes | Pendiente | Pendiente |
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

Productos publicados: salud `ok`, Supabase y WhatsApp `ok`, revisi?n `74b730ec3a0db2ad72e3cb8444552ce9c209fbad`, comprobada el 30 de septiembre a las 08:41 UTC.

Cuarta entrega B3, borradores de reposici?n:

- Selecci?n de variantes, cantidades y gratuidad desde el mismo panel plegable. Consulta el cliente actual del pedido y exige que coincida con el contacto autorizado; un correo hist?rico del pedido no basta para emitir un borrador a otro perfil. Conserva la direcci?n y el destinatario originales.
- La vista previa calcula art?culos, descuentos y total con Shopify sin crear un borrador. La confirmaci?n requiere administrador, versi?n de acci?n expl?cita, cotizaci?n sin cambios y bloqueo persistente. Las pantallas antiguas no pueden confirmar una reposici?n sin mostrar su revisi?n.
- Crea una sola vez un borrador oculto para el cliente, sin enviar factura, cobrar, completar el pedido ni solicitar despacho. Comprueba despu?s su cliente, direcci?n, destinatario, moneda, art?culos, total, estado e inexistencia de factura enviada o pedido confirmado. Los resultados incompletos permanecen inciertos y no se repiten autom?ticamente.
- La etiqueta de reposici?n forma parte de la creaci?n inicial, evitando que el webhook lo incorpore antes a recuperaci?n de borradores abandonados. Una referencia persistida mantiene la exclusi?n si despu?s cambian sus etiquetas. No se crea un contacto para esa campa?a; si la comprobaci?n de exclusi?n falla, se captura el fallo sin encolar el borrador. La recuperaci?n de ventas normales conserva su comportamiento.
- Historial con referencia y estado observado del borrador. Una respuesta perdida se puede inspeccionar por la etiqueta ?nica de la operaci?n; la revisi?n se vincula al borrador encontrado y no al saldo del pedido original. Ambig?edad, coincidencias m?ltiples o permisos insuficientes mantienen el bloqueo. Textos en espa?ol e ingl?s.

Validaci?n de reposiciones: **100 archivos y 820 pruebas correctas**, incluidos perfil ajeno, cotizaci?n cambiada, cantidades y descuentos, borrador visible o facturado, direcci?n alterada, respuesta perdida, exclusi?n de campa?as, firmas del webhook y confirmaci?n de pantallas antiguas. Lint de los archivos modificados sin errores y build completo correcto en la copia aislada. Reutiliza el esquema 310; no requiere migraci?n nueva. No se crearon borradores en tiendas reales ni se enviaron facturas para probar el cambio. Retenci?n y cr?dito siguen en desarrollo; B3 todav?a no est? completo.

Permiso de reposici?n publicado en Shopify: configuraci?n p?blica y legacy validada por CLI; versiones activas `riverz-reviewed-replacements-0930-v2` verificadas en ambas apps. La extensi?n de chat existente se conserva. OAuth solicita `write_draft_orders`; cada acci?n comprueba el permiso realmente concedido al token, sin asumir que publicar la configuraci?n lo otorga autom?ticamente a las tiendas ya instaladas.

Reposiciones publicadas en Riverz: salud `ok`, Supabase y WhatsApp `ok`, revisi?n `edb99fe8a86598cc8c424551b933094d4363b45f`, comprobada el 30 de septiembre a las 09:15 UTC.

Quinta entrega B3, retenci?n de preparaci?n en Shopify:

- Acci?n en el mismo panel plegable, con vista previa de las preparaciones visibles y compatibles, sus ubicaciones, art?culos, cantidades pendientes y retenciones actuales. Consulta permisos reales y las acciones que Shopify admite para cada preparaci?n; bloquea listas incompletas, trabajo iniciado, pedidos despachados o enviados a Dropi. El alcance visible depende de los permisos de Shopify, y el panel lo explica sin presentar una retenci?n en Shopify como parada de transportadoras externas.
- La vista previa no modifica Shopify. La confirmaci?n vuelve a comprobar el pedido y la preparaci?n revisada, incluida su ubicaci?n y estado. Requiere administrador vigente, acci?n expl?cita y bloqueo persistente; los identificadores de preparaci?n se derivan en el servidor y no se admiten en el formulario.
- Crea una retenci?n con referencia ?nica por operaci?n para cada preparaci?n revisada, sin avisos, cancelaciones, reembolsos ni despacho. Verifica el estado retenido y las referencias y motivos reales. Un resultado parcial o una respuesta perdida conserva las referencias obtenidas y queda incierto; no repite ni revierte autom?ticamente las retenciones. La liberaci?n se gestiona en Shopify.
- La revisi?n consulta las preparaciones originales, incluso si despu?s se cerraron o cambiaron; se vincula a cada estado observado. Tambi?n exige un cliente que muestre la revisi?n correcta de direcci?n, art?culos, reposici?n o retenci?n. Una pantalla antigua que solo conoce saldos financieros no puede liberar esos bloqueos; las revisiones financieras anteriores siguen siendo compatibles.
- Historial de la vista previa, administrador, estado comprobado y referencias. Textos en espa?ol e ingl?s, con la navegaci?n y los m?dulos existentes conservados.

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
