# Plan final de mejoras de Riverz basado en Commslayer

Fecha: 29 de septiembre de 2026.

Este plan amplía las capacidades de Riverz manteniendo su interfaz, navegación y funcionalidades actuales. El producto sigue centrado en un superasistente preparado para cada negocio, que conoce sus productos y políticas, ejecuta las acciones autorizadas y pide intervención cuando necesita una decisión. Campañas, plantillas, automatizaciones y los demás módulos conservan sus pantallas y controles.

El resultado buscado es que Riverz resuelva más trabajo de atención, ventas y operación con menos esfuerzo del negocio. La comparación con Commslayer sirve para identificar capacidades útiles; no obliga a copiar su interfaz ni su posicionamiento de helpdesk.

## 1 Alcance y decisiones acordadas

1. Conservar el menú, los nombres, las rutas, las pantallas y la identidad visual actuales. La maqueta simplificada de Paper no se usará como propuesta de navegación.
2. Mantener todas las funciones existentes. Las mejoras se incorporan en el módulo correspondiente mediante controles y paneles contextuales. Un recurso externo nuevo, como un portal para clientes, puede necesitar una página propia sin reorganizar el CRM.
3. Presentar ventas, soporte, cobros y logística como capacidades del mismo superasistente. Los componentes internos especializados pueden continuar; no se exige una reescritura de la arquitectura ni unificar registros existentes para cambiar el mensaje comercial.
4. Conservar los editores manuales. El Operador permite pedir y preparar cambios por conversación, utilizando los mismos mecanismos de validación, permisos y ejecución que esos editores.
5. Mantener las políticas y aprobaciones actuales. Cancelaciones y reembolsos siguen requiriendo aprobación; este plan no activa autonomía financiera ni cambia precios, prueba, facturación o condiciones comerciales.

Los controles de cerrar y asignar retirados de la cabecera de Bandeja, y la encuesta y el reparto retirados de Ajustes, no se restaurarán automáticamente. Su retiro fue una decisión del dueño. Las nuevas capacidades de equipo se diseñarán respetando esa decisión; cualquier reintroducción de esos controles queda fuera del alcance acordado.

## 2 Base de evidencia y clasificación de tareas

La referencia de código revisada es `excelenciaempire/riverz-crm`, rama `main`, commit `979cce85d1236cce872bf38367c6bf236afc50ca`, coincidente con GitHub al hacer la revisión. La investigación original de Commslayer es del 28 y 29 de septiembre de 2026. Los archivos de esa investigación y sus afirmaciones históricas no sustituyen una comprobación del código vigente.

La revisión de este plan fue de código y documentación. No se ejecutaron acciones sobre conversaciones, campañas, pedidos o dinero reales. Una capacidad encontrada en el repositorio no se declara por ello validada en producción.

Cada tarea tendrá una de estas clasificaciones antes de implementarse:

| Clasificación | Tratamiento |
| --- | --- |
| Existe y satisface el caso | Conservar. Verificar regresiones relevantes, sin reconstruirla. |
| Existe parcialmente o solo en un motor | Ampliar o conectar con la experiencia correspondiente. |
| Falta y aporta una capacidad útil | Construir sobre los mecanismos actuales. |
| Fue retirada por decisión del dueño | Mantener la decisión; no registrarla como error. |
| Depende de un proveedor o no está suficientemente comprobada | Validar acceso y comportamiento antes de comprometer implementación. |

### 2A Capacidades que ya forman parte de Riverz

Esta tabla combina el inventario anterior con las comprobaciones actuales señaladas en las referencias. Las ampliaciones concretas se verifican de nuevo al iniciar su bloque.

| Área | Base existente que se conserva | Ampliación buscada |
| --- | --- | --- |
| Atención y canales | Bandeja, WhatsApp, Instagram y Messenger, comentarios, correo con proveedores conectados, chat web y voz. Transferencia a humano con contexto. | Colaboración, filtros, seguimiento, traducción y explicación de acciones. |
| Crecimiento | Campañas con audiencias, variables, pruebas, programación y métricas; plantillas con vista previa y estados de Meta; automatizaciones; flujos; prospección. | Generación contextual con IA, disparadores efectivos y observación de ejecuciones. |
| Superasistente | Conocimiento de productos y negocio, reglas, prueba como cliente, permisos de herramientas y registro de preguntas sin respuesta. El endpoint de Huecos guarda respuestas como FAQ de producto o regla de negocio. | Pruebas y versiones por regla, fuentes documentales, trazabilidad y consulta interna al dueño. |
| Comercio y postventa | Consulta y edición de pedidos mediante IA, cancelaciones y reembolsos con aprobación, devoluciones con estados y evidencia, cobros, logística y atribución. | Acciones humanas contextuales, autoservicio, reposiciones y devoluciones más completas. |
| Operación y plataforma | Operador, asignación mediante automatizaciones y reglas del motor, satisfacción según configuración, transcripción para IA, importación CSV, MCP con tokens, webhooks, mecanismos de Shopify Billing y sitio con demos y calculadora. | Exponer capacidades parciales, mejorar reportes, movilidad, integraciones y migración. |

### 2B Correcciones al informe anterior

1. El chat web ya consulta y modifica pedidos mediante conversación. El autoservicio visual es una ampliación, no la creación de esa capacidad desde cero.
2. Las reglas, el ensayo global, las preguntas sin respuesta y el aprendizaje de esas respuestas ya existen. Se ampliará su control y seguimiento.
3. Hay notas de contacto y una tarjeta de transferencia con contexto. Las notas privadas dentro del hilo, las menciones y la presencia de compañeros son capacidades distintas.
4. Ya existe medición de resolución con verificación y denominador. El informe histórico que describía una tasa siempre en cero quedó superado por la implementación documentada en `docs/results-dashboard.md`.
5. Ya existen MCP, tokens, webhooks, atribución, Shopify Billing y materiales comerciales. Las tareas correspondientes amplían cobertura, documentación o experiencia; no reconstruyen esas bases.

## 3 Orden de ejecución

Las estimaciones son rangos iniciales para una persona dedicada al desarrollo, con validación y entregas pequeñas. No son fechas comprometidas. Se ajustan al iniciar cada fase según la auditoría, las integraciones disponibles y el volumen real de trabajo. Las fases no se consideran listas por haber agotado su tiempo.

| Orden | Fase | Estimación inicial | Resultado |
| --- | --- | --- | --- |
| 0 | Fiabilidad de lo existente | 3 a 5 días laborables | Aprobaciones y funciones anunciadas se comportan correctamente. |
| 1 | Atención y pedidos | 4 a 6 semanas | El equipo puede resolver más casos dentro de Riverz. |
| 2 | Superasistente y crecimiento | 4 a 6 semanas | Más capacidades probables, observables y configurables sin trabajo técnico del dueño. |
| 3 | Autoservicio y operación | 4 a 6 semanas | El cliente y el asistente resuelven más incidencias de extremo a extremo. |
| 4 | Extensibilidad y expansión | 4 a 8 semanas para el paquete base | Documentos, conexiones y movilidad con una base estable. Integraciones adicionales se estiman por separado. |

El orden de magnitud del paquete base es de 17 a 27 semanas de una persona, incluyendo la fase inicial. Marketing puede avanzar en paralelo. Importadores adicionales, telefonía nueva, suscripciones y expansión a Estados Unidos tienen presupuestos propios; no se incluyen artificialmente dentro de ese rango.

Las dependencias que determinan el orden son P0A antes de B3 y O2; P0C antes de C2; B3 antes de O1 y O2; A1 y A2 antes de ampliar acciones autónomas en O3 y E2; A3 antes de E1; y el modelo de permisos de E4 en cada entrega desde P0, aunque su ampliación final se agrupe en la fase 4. Ningún bloque espera a la última fase para aplicar controles de seguridad.

## 4 Fase 0 Fiabilidad de las funciones actuales

### P0A Contrato de aprobaciones

**Estado:** incompatibilidad comprobada en el código actual. La pantalla envía `{ decision }` y el endpoint exige `{ aprobar: boolean }`.

**Trabajo:** unificar el contrato de aprobar y rechazar, conservar la resolución existente y comprobar que la pantalla y WhatsApp producen el mismo resultado. Mostrar los errores reales y evitar que una decisión repetida ejecute dos veces una acción.

**Aceptación:** aprobar o rechazar una solicitud de prueba funciona con sesión y permisos correctos; otra cuenta no puede decidirla; repetir la solicitud no duplica una devolución de dinero.

### P0B Cifras del Operador

**Estado:** incompatibilidad comprobada. El consumidor busca `ai` y `human`, mientras el informe entrega `ia` y `humano` en `by_handler`.

**Trabajo:** corregir el contrato, comprobar las dos tarjetas y preservar la distinción entre ventas con evidencia y ventas posteriores a una conversación. No llamar venta cerrada por IA a una cifra que solo identifica quién atendió el hilo.

**Aceptación:** las tarjetas usan el informe real, presentan categorías y monedas correctas y diferencian ausencia de datos de un valor cero.

### P0C Disparadores de automatización

**Estado:** el registro del Operador documenta que `tag_added` y `time_based` se ofrecen en el constructor pero no tienen un emisor efectivo. Esa observación debe comprobarse de extremo a extremo antes de modificar el motor.

**Trabajo:** completar el evento al añadir una etiqueta y la ejecución programada, reutilizando el motor actual. Centralizar las escrituras relevantes, evitar bucles y disparos duplicados, y conservar las automatizaciones creadas. Si la auditoría detecta una función inoperante, informar su estado y evitar activaciones engañosas mientras se completa; no eliminarla del producto.

**Aceptación:** un cambio real y una fecha programada ejecutan una sola vez la automatización correcta para la cuenta correspondiente. Los reintentos no duplican mensajes y una automatización no puede realimentarse indefinidamente.

### P0D Textos y generación de plantillas

**Estado:** la calculadora consulta `landingV4.pricingPerContact`, mientras el catálogo revisado contiene `pricingPerContactMath`. El endpoint de generación de plantillas y su uso desde el Operador existen; el constructor manual necesita un acceso equivalente.

**Trabajo:** corregir la clave de traducción y añadir generación con IA al constructor existente, con un borrador editable y vista previa. Revisar el subtítulo de Pedidos contra la cobertura real de `/api/orders`; el informe anterior no basta para afirmar que ese texto es incorrecto.

**Aceptación:** no aparecen claves de traducción en español o inglés. Generar una plantilla no la publica ni la envía sin la acción correspondiente del usuario.

### P0E Acceso a funciones y regresión

**Trabajo:** comprobar los accesos actuales a aprobaciones, devoluciones y logística. Cuando un recurso no resulte localizable, añadir un acceso contextual dentro de Bandeja, Pedidos o el módulo que corresponda, respetando el menú. Mantener los resultados y la verificación actuales y comprobar que ninguna mejora altera campañas, plantillas o automatizaciones existentes.

**Aceptación:** se llega a los recursos necesarios sin memorizar una URL; no se reorganiza la navegación ni se habilita logística simulada como si ejecutara acciones reales.

## 5 Fase 1 Atención y pedidos dentro de Riverz

### B1 Trabajo compartido en Bandeja

**Base:** notas de contacto, transferencia con contexto, asignación desde automatizaciones y reglas del motor. El inventario anterior encontró filtros guardados en API; su superficie actual se comprueba al iniciar.

**Ampliaciones:** notas internas dentro del hilo con menciones y avisos al destinatario; presencia de compañeros y aviso de respuesta simultánea; vistas guardadas personales o compartidas con contadores; prioridad y seguimiento de casos. Separar notas internas de mensajes al cliente en almacenamiento, envío y exportación.

Las vistas permiten filtrar por responsable, canal, estado y motivo sin añadir nuevas entradas al menú principal. Distinguir las etiquetas del contacto de una clasificación específica del caso. Para hilos duplicados, ofrecer unión manual o referencias cruzadas con vista previa y trazabilidad, solo tras verificar que corresponden a la misma persona; no fusionar identidades ambiguas automáticamente.

**Aceptación:** tres asesores trabajan sobre casos compartidos sin enviar notas privadas al cliente, perder contexto ni responder por accidente al mismo tiempo. La IA dispone de las notas que corresponda según la política definida.

### B2 Seguimiento y herramientas del equipo

**Ampliaciones:** posponer un caso hasta una fecha y reabrirlo; recordatorios; macros que combinen acciones autorizadas; acciones masivas con alcance visible; atajos de teclado para tareas disponibles; agrupación del equipo y asignación con capacidad y disponibilidad.

Los mecanismos nuevos complementan el motor existente. No reintroducen los controles retirados de la cabecera ni el antiguo panel de Ajustes. El diseño de su superficie respeta esa exclusión.

**Aceptación:** un caso pospuesto reaparece a tiempo, una macro informa qué hizo y una acción masiva solo alcanza los casos seleccionados y permitidos. La asignación no entrega trabajo a usuarios inhabilitados ni pierde casos si no hay disponibilidad.

### B3 Acciones humanas sobre pedidos

**Base:** la IA ya tiene herramientas de pedidos y el motor de aprobaciones ejecuta cancelaciones y reembolsos. El panel contextual de Shopify revisado muestra datos y enlaces.

**Ampliaciones:** acciones de cambio de productos, variantes y cantidades; dirección; cancelación; reembolso total o parcial; preparación de reposición como borrador; retención del despacho cuando la integración lo permita. Incorporar crédito de tienda cuando exista un mecanismo compatible, sin presentarlo como un reembolso en efectivo.

Usar los mismos servicios para la pantalla y la IA. Validar identidad, pedido, estado de despacho, diferencias de precio y permisos antes de ejecutar. Registrar quién pidió, aprobó y ejecutó cada acción, importe y resultado.

**Aceptación:** el equipo resuelve un cambio de talla o dirección desde el contexto del caso, sin abrir Shopify para la operación soportada. Un pedido despachado no se modifica silenciosamente y un reembolso fallido nunca aparece como completado.

### B4 Comprensión de mensajes y audios

**Base:** Riverz ya transcribe para la IA y conserva resúmenes de conversación o llamada según el flujo.

**Ampliaciones:** mostrar transcripción y resumen de audios en el hilo; resumir una conversación a demanda; traducción entrante y saliente con original, idioma y vista previa; marcar como no leído, spam o bloquear dentro de los permisos aplicables; exportar una conversación con sus archivos y controles de acceso.

**Aceptación:** un asesor entiende un audio sin escucharlo, revisa una traducción antes de enviarla y puede recuperar el original. Ninguna exportación contiene información de otra cuenta o notas privadas no autorizadas.

## 6 Fase 2 Superasistente y crecimiento

### A1 Reglas probadas y observables

**Base:** reglas de negocio, interruptores, prueba como cliente y permisos de herramientas.

**Ampliaciones:** estados Borrador, Prueba y Activa; prueba por regla con conversaciones reales reproducidas sin enviar mensajes ni ejecutar cobros; versiones y retorno a una versión anterior; permisos de acción por contexto; detección de conflictos con las políticas existentes.

**Aceptación:** el dueño prueba una política sin afectar a sus clientes y sabe qué versión está activa. La prueba no ejecuta acciones externas; una regla nunca anula los controles globales de seguridad o dinero.

### A2 Explicación de acciones y métricas por regla

**Ampliaciones:** desde un mensaje, ver la regla aplicada, las fuentes consultadas, las herramientas ejecutadas, su resultado y el motivo de transferencia. Mostrar un resumen legible y permitir abrir detalles necesarios, sin exponer razonamiento privado del modelo ni secretos.

Medir aplicación, fallo y transferencia por regla. Para resoluciones, reutilizar las definiciones verificadas y declarar cómo se asigna el resultado si intervinieron varias reglas.

**Aceptación:** un caso real puede reproducirse en modo de prueba y una acción tiene evidencia inspeccionable. Los contadores no duplican conversaciones ni presentan respuestas emitidas como resoluciones demostradas.

### A3 Conocimiento y aprendizaje supervisado

**Base:** catálogo, conocimiento de negocio, sincronización desde URL y Huecos que convierte respuestas en FAQ o regla.

**Ampliaciones:** preguntas internas al dueño o equipo por WhatsApp y dentro de Riverz; agrupación de dudas repetidas; propuesta editable de conocimiento; fuente, fecha y responsable de cada actualización; manejo de respuestas contradictorias.

La respuesta humana resuelve la duda del caso. Convertirla en una política permanente requiere la autorización correspondiente y un destino claro. No aprender políticas de una afirmación del cliente ni crear una regla duplicada por cada repetición.

**Aceptación:** responder una duda actualiza el conocimiento adecuado y permite responder una pregunta equivalente posterior. Una excepción particular no se convierte automáticamente en política para todos los clientes.

### C1 Campañas y plantillas más asistidas

**Base:** conservar audiencias, variables, pruebas, costo estimado, programación, estados y métricas existentes.

**Ampliaciones:** generar y ajustar contenido dentro de los editores, usando productos y tono del negocio; preparar desde el Operador el mismo borrador editable; validar variables, consentimiento, exclusiones, destinatarios y estado de plantilla antes de enviar; mejorar diagnóstico de errores y reintentos cuando la auditoría lo requiera.

**Aceptación:** el dueño puede crear una campaña por cualquiera de los dos caminos y revisar el mismo contenido, audiencia y configuración. Una prueba o borrador no envía una campaña real; un reintento no vuelve a contactar a quien ya recibió el envío.

### C2 Automatizaciones y flujos más completos

**Base:** motores y constructores actuales, eventos comerciales, plantillas, voz, asignación, etiquetas y webhooks según sus capacidades vigentes.

**Ampliaciones:** historial de ejecución por contacto, paso y resultado; pruebas sin efectos reales; pausa y reanudación con alcance explícito; advertencias accionables; coherencia entre lo que puede crear el Operador y lo que soporta el constructor. Evitar que campañas, automatizaciones y seguimientos persigan simultáneamente al mismo cliente cuando la política lo impida.

El nodo HTTP y las acciones externas se implementan en E2. Los nuevos disparadores de P0C se usan solo después de superar su validación.

**Aceptación:** el dueño puede explicar por qué una automatización envió o no envió un mensaje. Una pausa detiene el trabajo pendiente definido sin borrar el historial ni duplicar envíos al reanudar.

## 7 Fase 3 Autoservicio y operación completa

### O1 Autoservicio de pedidos

**Base:** consulta y edición conversacional por IA, confirmación contraentrega y herramientas de postventa.

**Ampliaciones:** botones o formularios guiados para confirmar, corregir dirección, cambiar talla o color y solicitar cancelación. Extender al chat web la experiencia visual cuando resulte útil. Añadir posteriormente acceso desde la página de confirmación de compra de Shopify, sujeto a las posibilidades de la extensión y de la tienda.

Todos los accesos llaman a los mismos servicios de pedidos y conservan verificación de identidad, ventana de edición, bloqueo por despacho y aprobaciones.

**Aceptación:** un cliente autorizado corrige un dato antes del despacho y obtiene confirmación del cambio real. Conocer un número de pedido no permite editar el de otra persona.

### O2 Devoluciones y reposiciones

**Base:** solicitudes, motivos, fotos o evidencia, estados y herramientas de devolución y reembolso existentes.

**Ampliaciones:** políticas por producto y plazo, cambio o reposición, crédito de tienda, etiqueta o guía de retorno, seguimiento de recepción y propuesta de reembolso vinculada a la recepción. Validar compatibilidad de cada tienda y transportadora antes de ofrecer una ejecución automática.

**Aceptación:** un caso tiene historial desde la solicitud hasta el cierre, resultado comercial confirmado y trazabilidad del dinero. Las operaciones no soportadas se derivan con el contexto necesario.

### O3 Logística y funciones específicas de cuentas

**Base:** confirmación, novedades, seguimiento y mecanismos ya desarrollados para comercios concretos.

**Ampliaciones:** convertir los casos útiles en configuración por negocio; generalizar botones de corrección de datos, políticas de despacho y evidencia; documentar las excepciones que deban permanecer específicas. Reutilizar el conocimiento y permisos del superasistente.

**Aceptación:** una tienda nueva puede utilizar una capacidad general sin editar su identificador en el código. El sistema diferencia una simulación, una propuesta y una acción realmente confirmada por el proveedor.

### O4 Satisfacción y motivos de contacto

**Base:** etiquetado por IA, satisfacción según configuración, encuesta postentrega y mecanismos de reseñas.

**Ampliaciones:** clasificar motivos de contacto y mostrar tendencias; conectar satisfacción con el caso; ampliar solicitudes de opinión compatibles con cada canal y política del negocio. Conservar la decisión de no restaurar la encuesta retirada de Ajustes.

**Aceptación:** el negocio ve qué problemas generan consultas y qué respuestas de satisfacción se recogieron. CSAT, silencio y cierre no se cuentan por sí solos como resolución verificada.

### O5 Reportes útiles sobre la base actual

**Base:** resultados verificados, pendientes, atribución directa, ventas posteriores a conversación, canales y tiempos existentes.

**Ampliaciones:** tiempos de resolución, carga por asesor, motivos, fallos y transferencias del asistente; reportes por regla y por campaña, flujo o automatización donde la cobertura sea parcial; exportación CSV y filtros coherentes. Incorporar ajustes puntuales de visualización dentro de Panel, conservando su estructura.

**Aceptación:** el negocio puede abrir la evidencia que sostiene una cifra. Los datos ausentes no se convierten en cero; no se suman monedas diferentes ni se confunde asociación con ingreso incremental. Se comprueba qué desgloses ya están disponibles antes de desarrollarlos.

## 8 Fase 4 Extensibilidad y acceso

### E1 Fuentes documentales

**Ampliaciones:** importar PDF, Word y Excel; sincronizar Google Drive con permisos de acceso; mostrar procesamiento, fuente, fecha, fallos y versiones. Evitar que contenido de un archivo modifique permisos o se convierta en una orden de ejecución.

**Aceptación:** el asistente responde usando documentos autorizados, el negocio puede corregir o retirar una fuente y la retirada impide su uso posterior dentro del plazo definido por la sincronización. Un fallo de importación no aparece como entrenamiento completado.

### E2 Acciones externas y APIs

**Base:** MCP, tokens y webhooks. Revisar primero la cobertura efectiva de endpoints existentes.

**Ampliaciones:** acción HTTP configurable para el asistente y nodo HTTP para Flujos; credenciales protegidas; parámetros y respuestas definidos; plantillas para n8n, Make y sistemas propios. Completar la API REST donde sea necesario para conversaciones, contactos y reportes, con permisos, límites, documentación y revocación.

**Aceptación:** una integración autorizada consulta o ejecuta una acción sin acceso a otras cuentas ni exposición de secretos. Se bloquean destinos internos no autorizados y los reintentos de operaciones sensibles usan un identificador que evita duplicación.

### E3 Uso desde el celular

**Base:** interfaz responsive y manifest existentes; comprobar su cobertura actual antes de modificarla.

**Ampliaciones:** instalación PWA, notificaciones y accesos a casos o aprobaciones; respuesta y revisión cómodas desde móvil. Abrir una notificación de reembolso lleva a una revisión autenticada; la recepción de la notificación no constituye autorización para mover dinero.

**Aceptación:** el dueño abre un aviso, revisa el caso y toma la decisión desde el teléfono. La compatibilidad de notificaciones se valida por plataforma y no se promete funcionamiento idéntico en todos los dispositivos.

### E4 Confianza y aislamiento

**Trabajo:** ampliar permisos y auditoría para las funciones nuevas; comprobar 2FA disponible antes de añadir otra implementación; exportación de registros, estado del servicio y diagnóstico de integraciones. Preservar identidad por conversación y prohibir uniones ambiguas de contactos por decisión autónoma de la IA.

Mantener las políticas actuales de comentarios públicos. Su ampliación usa controles por canal, volumen, audiencia y moderación; no activa respuestas públicas de forma global.

**Aceptación:** ninguna función nueva permite leer o modificar otra cuenta, enviar a otro destinatario o ejecutar una acción sin permiso. Los fallos de integración se informan con evidencia; no se exige reconectar por una ausencia de configuración local no comprobada.

## 9 Paquetes posteriores con presupuesto propio

Estas capacidades permanecen en la cobertura del plan, pero no condicionan las mejoras centrales ni se consideran comprometidas antes de comprobar las APIs y permisos correspondientes.

| Paquete | Trabajo y aceptación | Estimación inicial |
| --- | --- | --- |
| X1 Portal de ayuda y seguimiento | Artículos con fuentes compartidas por el asistente, dominio o marca de la tienda y seguimiento de pedidos protegido. Medir adopción y consultas evitadas sin prometer una reducción previa. | 3 a 5 semanas. Depende de O3 y E1. |
| X2 Migración desde otras herramientas | Reutilizar CSV e importación existente; ampliar para Kommo, Leadsales, ManyChat y Chatwoot; después Gorgias y Zendesk. Vista previa, correspondencia de campos, deduplicación, adjuntos y registros de error. | 2 a 4 semanas para el primer conector; estimar cada adicional. |
| X3 Voz para humanos y WhatsApp Calling | Ampliar la voz actual con atención humana en navegador, transferencia, buzón y llamadas de WhatsApp cuando la cuenta y API lo permitan. Una transferencia mantiene contexto y resultado. | 3 a 6 semanas para el primer canal validado. |
| X4 Correo y canales adicionales | Ampliar proveedores de correo si la demanda lo justifica; evaluar reenvío, IMAP o SMTP sin rehacer Gmail, Outlook y Zoho. SMS y reseñas de tienda forman parte del paquete de expansión. | 2 a 4 semanas por integración inicial, sujeto al proveedor. |
| X5 Suscripciones | Integraciones con proveedores seleccionados de suscripción, consulta y cambios autorizados, retención y cancelación con trazabilidad. Validar Recharge, Loop o Skio antes de fijar cobertura. | 3 a 5 semanas para el primer proveedor. |

## 10 Instalación y operación que conservan el diferencial

La instalación se apoya en el onboarding y mecanismos actuales. El dueño no necesita convertirse en diseñador de automatizaciones para obtener valor.

1. Conectar los sistemas necesarios y cargar productos, políticas y conocimiento.
2. Preparar reglas y configuraciones desde plantillas por caso de uso y desde el Operador.
3. Probar ejemplos relevantes antes de habilitar acciones nuevas.
4. Mostrar al dueño qué hará el asistente, qué requiere aprobación y cómo detenerlo; aprovechar la aprobación y encendido existentes.
5. Revisar resultados, fallos y preguntas pendientes para mejorar el comportamiento sin duplicar configuraciones.

La configuración de una misma capacidad tiene una fuente de verdad. La pantalla y el Operador editan esa fuente; no crean dos versiones que puedan contradecirse. Las funciones manuales permanecen disponibles para quien las necesite.

## 11 Sitio y comunicación comercial

El mensaje guía es un superasistente preparado para cada negocio, acompañado por una plataforma completa que el cliente puede utilizar. No se sustituye ese posicionamiento por una colección de agentes que el dueño deba administrar.

### M1 Demostraciones basadas en funciones reales

Actualizar las demos actuales conforme se entreguen las mejoras: atención, campaña, cambio de pedido, consulta interna y aprobación. Ampliar la demo de voz. Cada ejemplo distingue ejecución real, propuesta y simulación.

### M2 Resultados y casos por negocio

Publicar casos con autorización, cifras trazables y período definido. Preparar ejemplos por rubro basados en configuraciones existentes. No atribuir al asistente ventas sin evidencia ni inventar horas ahorradas.

### M3 Comparativas y ahorro

Actualizar comparativas y calculadora existentes con precios y capacidades verificados al publicarlas. Explicar qué resuelve Riverz y qué exige una integración o servicio adicional. No cambiar precios de Riverz como consecuencia automática del precio de Commslayer.

### M4 Integraciones y documentación pública

Actualizar fichas de integración, ayuda, textos accesibles para motores de búsqueda y archivos `llms.txt` donde corresponda. Explicar qué puede hacer el dueño y qué ejecuta el asistente en cada integración, con estado de disponibilidad.

### M5 Lanzamientos

Publicar changelog y materiales breves de mejoras completadas. No anunciar una función como disponible antes de validarla en el entorno correspondiente. Cualquier contacto a clientes, solicitud de reseña o publicación externa debe seguir su autorización específica.

## 12 Expansión a Estados Unidos

1. Verificar el estado actual de la app de Shopify, su distribución y requisitos antes de planificar los pasos que falten. Los mecanismos de Shopify Billing existentes se reutilizan.
2. Estudiar segmentos y condiciones comerciales con datos vigentes. Precio, modalidad de cobro, invitaciones y duración de prueba son decisiones comerciales separadas; este plan no las cambia.
3. Priorizar marcas que necesiten operar en español e inglés y atender clientes de Estados Unidos y Latinoamérica. Mantener toda función nueva del producto en ambos idiomas.
4. Seleccionar integraciones de SMS, reseñas y suscripciones según la demanda; aprovechar X2 y X5 para migración y postventa.
5. Preparar documentación de seguridad y privacidad y evaluar certificaciones según requisitos reales. No anunciar SOC 2 u otro cumplimiento sin el proceso y la evidencia correspondientes.

## 13 Validación y publicación por entrega

Cada bloque sigue esta secuencia, sin esperar a terminar todo el plan:

1. Confirmar el comportamiento vigente, las decisiones históricas y la necesidad de la ampliación. Registrar alcance, dependencias y casos de aceptación.
2. Implementar una entrega pequeña sobre los módulos existentes, con compatibilidad de configuraciones y datos. Toda UI nueva funciona en español e inglés, en escritorio y móvil.
3. Validar los casos relevantes: permisos por cuenta, fallos de proveedor, reintentos, fechas y zonas horarias, destinatario, dinero y estados de ejecución cuando correspondan. Usar pruebas significativas, sin duplicar controles por rutina.
4. Publicar mediante la infraestructura vigente documentada del proyecto. No usar Vercel. Verificar migraciones necesarias antes del despliegue, conservar posibilidad de reversión y activar capacidades nuevas por negocio cuando proceda.
5. Comprobar el resultado en producción con casos autorizados que no creen campañas, mensajes, pedidos o pagos reales por accidente. Registrar evidencia de funcionamiento, límites y errores antes de ampliar la activación.

Las correcciones generales no se ocultan detrás de nuevos planes comerciales. Las nuevas capacidades que cambien comportamiento se prueban de forma controlada y respetan la configuración de cada negocio. No se activa una función riesgosa para toda la base por estar presente en el código.

## 14 Cómo se mide que Riverz mejoró

Se establece una línea base por negocio antes de activar cada mejora y se compara un período y muestra suficientes, indicando límites de atribución. No se fijan porcentajes de éxito inventados.

| Resultado | Medición |
| --- | --- |
| El asistente resuelve más trabajo | Casos resueltos verificados y solicitudes que requieren intervención, por tipo de caso. |
| El dueño trabaja menos para operar | Intervenciones necesarias por caso y tiempo de preparación de una campaña o política equivalente. |
| El equipo trabaja mejor | Tiempo de primera respuesta y resolución, casos sin seguimiento, carga y colisiones registradas. |
| Las acciones son confiables | Ejecuciones confirmadas, fallos, reintentos duplicados, incidencias de dinero y de destinatario. |
| Las mejoras comerciales aportan valor | Pedidos pagados con evidencia de campaña, automatización o acción; satisfacción y devoluciones con su denominador. |

Una entrega se considera completa cuando supera su aceptación, conserva los flujos anteriores, funciona en ambos idiomas y cuenta con evidencia del entorno donde se declara disponible. El criterio principal es que el negocio complete el trabajo con menos esfuerzo, manteniendo control y contexto.

## 15 Referencias para retomar la ejecución

### Código y documentación del repositorio

| Tema | Referencia |
| --- | --- |
| Menú que se conserva | [Sidebar](../src/components/layout/sidebar.tsx). |
| Contrato de decisiones | [Pantalla de aprobaciones](../src/app/(dashboard)/aprobaciones/page.tsx) y [endpoint](../src/app/api/approvals/[id]/decide/route.ts). |
| Cifras y categorías de ventas | [Métricas del Operador](../src/lib/capabilities/metrics.ts) y [informe de atribución](../src/lib/attribution/informe.ts). |
| Resultados y resolución existentes | [Definiciones y verificación](results-dashboard.md), [cortes](../src/lib/dashboard/cortes.ts) y [outcomes](../src/lib/dashboard/outcomes.ts). |
| Plantillas y generación | [Constructor](../src/components/templates/template-builder.tsx) y [generación](../src/app/api/whatsapp/templates/generate/route.ts). |
| Disparadores y motor | [Registro del Operador](../src/lib/automations/ai-steps.ts), [constructor](../src/components/automations/activador.ts) y [motor](../src/lib/automations/engine.ts). |
| Conocimiento y aprendizaje | [Huecos](../src/app/api/huecos/responder/route.ts), [reglas](../src/lib/ai/guidance.ts) y [sincronización desde URL](../src/app/api/ai/agents/[id]/sync-knowledge/route.ts). |
| Acciones y permisos actuales | [Herramientas del asistente](../src/lib/ai/toolbox.ts) y [resolución de aprobaciones](../src/lib/approvals/resolve.ts). |
| Pedidos actuales | [Panel contextual Shopify](../src/components/inbox/shopify-contact-panel.tsx) y [API de pedidos](../src/app/api/orders/route.ts). |
| Conectividad existente | [MCP](../src/app/api/mcp/route.ts) y [tokens](../src/lib/mcp/tokens.ts). |
| Entregas y activación | [Runbook Riverz 2](riverz2-runbook.md); confirmar su vigencia técnica al ejecutar. |

### Investigación previa y decisiones

Informe original: `C:\Users\river\Desktop\Riverzz CRM\analisis-commslayer\report\index.html`, sección 11. Verificación histórica: `C:\Users\river\Desktop\Riverzz CRM\analisis-commslayer\research\wf_resultados.md`. Son referencias históricas; el código vigente y las decisiones de esta conversación mandan sobre el plan anterior.

Los cambios parciales de la antigua rama `claude/fase-0-commslayer` se pueden inspeccionar al comenzar P0, pero no se importan ni dan por aplicados sin revisar su compatibilidad y alcance. Este documento define trabajo futuro; guardarlo no declara implementadas las mejoras.
