# Comparación privada de Riverz

La comparación conserva el posicionamiento de un superasistente preparado para cada negocio y los módulos vigentes. Usa componentes reales del repositorio con fixtures ficticios. No inicia una sesión comercial, carga credenciales, envía mensajes, llama modelos, cambia pedidos ni cobra dinero.

La [matriz de aceptación](commslayer-acceptance-matrix.md) y la [preparación de proveedores](commslayer-provider-readiness.md) distinguen construcción, publicación de código y comprobaciones externas.

## Abrir y comparar

1. Completar la compilación validada en `.b2-validation-0930`. El arnés reutiliza su CSS y fuentes; no sustituye el diseño por una maqueta nueva.
2. Desde el repositorio, ejecutar `node scripts/comparison/build.mjs`.
3. Ejecutar `node scripts/comparison/serve.mjs` y abrir `http://127.0.0.1:3107/compare?locale=es&page=inbox` para las dos variantes lado a lado. La vista individual está en `http://127.0.0.1:3107/?stage=current&locale=es&page=inbox`.
4. Usar **Versión actual / Mejoras** sobre la misma pestaña y sección. Cambiar ES/EN y el ancho del dispositivo conserva el contexto de comparación.
5. Ejecutar `node scripts/comparison/check.mjs` para comprobar el aislamiento del servidor y del bundle.

El servidor escucha únicamente en loopback. El navegador de esta tarea permanece invisible hasta entregar la comparación; no se configura `NEXT_PUBLIC_RIVERZ_UI_STAGE` en Render. Las escrituras de los ejemplos que admiten edición solo viven en memoria local y se reinician al navegar. Las operaciones externas y la generación de IA están bloqueadas con un error explícito, no simuladas como éxitos reales.

## Qué se puede revisar

| Sección | Controles reales incluidos |
| --- | --- |
| Bandeja | Mensajes, notas/presencia, vistas guardadas, acciones masivas, seguimiento/macros, respuestas internas del caso, comprensión/exportación, disposición/bloqueo, equipo/capacidad y evidencia de turnos/reglas/documentos. |
| Reglas | Versiones, borrador, prueba individual, actividad/evaluaciones y restricciones de herramientas por canal. |
| Documentos | Importación, revisión, activación/retirada, historial y conexión de Drive. |
| Reportes | Casos con revisión vigente, tiempos y CSV; motivos, satisfacción y evidencia filtrada. |
| Flujos | Cohorte, estados, entradas por nodo, casos y exportación. |
| Postventa | Política por producto, historial del expediente y guía/recepción declaradas. |
| Pedidos | Siete acciones soportadas y solicitudes de dirección, con revisión previa. |
| HTTP | Configuración del sistema propio y formularios existentes. |
| Plantillas | Texto editable y acceso al borrador asistido. |
| Campañas | Constructor vigente con audiencia, horario, plantillas, voz, variables y costes. |
| Automatizaciones | Historial vigente con filtros nuevos y recorrido por pasos. |
| Móvil | Instalación y avisos voluntarios del dispositivo. |
| Lanzamiento | Seis demostraciones ilustrativas, ejemplos por negocio, pricing con fecha, fichas y changelog preparado. |
| Migraciones | Revisión local y persistente de contactos CSV, conteos existentes, confirmación explícita, comprobante y recuperación. El adaptador local simula escrituras; no extrae cuentas ni importa datos reales. |
| Ayuda | Centro con marca y artículos revisados; vista del chat con pedidos ficticios y respuestas declaradas del visitante. Su edición se revisa dentro de Documentos. |
| Llamadas | Ficha real en ambos lados; toma humana exclusiva, entrada explícita, silencio y cierre con audio simulado solo en la propuesta. |
| Buzón | Configuración actual de respaldo en ambos lados; grabación opcional, duración y aviso en la propuesta. Ficha de ejemplo sin prometer un audio todavía ausente. |

## Límites de la comparación

Es un catálogo interactivo de controles añadidos, no una copia íntegra de todas las pantallas del CRM. Campañas y registros de automatización usan su pantalla real; otros apartados presentan los componentes nuevos en contexto. La columna actual conserva el menú y la base mostrada, pero no sustituye una sesión autenticada de producción. Un módulo no reproducido informa esa limitación; nunca aparece como una función eliminada de Riverz.

Los datos son ficticios y explícitos. Una reserva particular no se presenta como regla global; una devolución abierta no representa dinero devuelto. La evaluación humana de una regla no prueba causalidad y un tiempo hasta revisión no representa resolución automática. Las fuentes o resultados de proveedores solo pueden declararse verificados con evidencia del entorno correspondiente.

Las capturas y resultados de QA se guardan aparte. No existe ruta pública de comparación, cambio de pricing, rediseño del menú ni dependencia de n8n/Make. Los cambios de fiabilidad ya publicados se encuentran en ambas variantes: **Actual** significa las mejoras visuales apagadas, no una recreación de errores antiguos.

## Evidencia visual

[QA de las 52 revisiones / 104 paneles](commslayer-comparison-qa.json), con datos ficticios y límites anteriores.

La sección añadida de migraciones tiene [cuatro revisiones propias / ocho paneles](migration-contact-preview-qa.json), ES/EN y escritorio/móvil, con archivo ficticio, conteos, ausencia de llamadas, limpieza al cerrar y control oculto en la columna actual. La prueba anterior de trece secciones conserva su fecha y bundle; no se presenta como una nueva ejecución completa sobre esta ampliación.

La ampliación persistente tiene [cuatro revisiones adicionales / ocho paneles](migration-contact-import-qa.json) sobre su bundle final: preparación, casilla obligatoria, confirmación y recuperación. Sus dos POST y dos GET por revisión pertenecen al adaptador ficticio en memoria; no fueron solicitudes de importación a un comercio. Los resultados de base de datos se validan aparte con PGlite y el esquema real se comprueba solo mediante metadatos e identidades nulas.

La misma sección incluye ahora [extracción de contactos de Chatwoot](migration-native-chatwoot.md), con formulario privado y revisión independiente. La comparación responde la extracción con tres contactos ficticios, dos importables y uno excluido por teléfono; no consulta Chatwoot ni acredita una migración real. El recorrido conserva casilla, comprobante y recuperación; cerrar limpia el token. Su QA final se registra aparte del de CSV y las trece secciones anteriores.

![Bandeja: actual y controles nuevos](comparison-preview/inbox-es-desktop.png)

![Reglas y sus versiones](comparison-preview/rules-es-desktop.png)

![Campañas conservadas en ambas variantes](comparison-preview/campaigns-es-desktop.png)

![Automatizaciones y filtros nuevos](comparison-preview/automations-es-desktop.png)

La [QA nativa final de Chatwoot](migration-native-chatwoot-qa.json) registra cuatro revisiones propias, ocho paneles ES/EN/escritorio/móvil. Los cuatro POST y tres GET por revisión se responden con fixtures; no consultan la fuente ni importan clientes reales. Los errores de claves duplicadas de la iteración inicial permanecen en la evidencia histórica; no hay entradas nuevas después del bundle corregido.

La misma sección añade [Kommo y ManyChat](migration-native-external.md). Su [QA independiente](migration-native-external-qa.json) registra cuatro recorridos y ocho paneles: extracción, revisión separada, casilla obligatoria, cancelación de Kommo y selección explícita de ManyChat. Cinco POST y dos GET por recorrido son fixtures en memoria; no se confirma ninguna importación ni se accede a una cuenta real. El panel actual conserva apagadas las adiciones. La prueba histórica de trece secciones y el portal mantienen sus fechas y bundles originales.


La misma sección incorpora [Gorgias/Zendesk por cursor](migration-native-cursors.md). La [QA independiente](migration-native-cursors-qa.json) registra cuatro recorridos ES/EN, escritorio/móvil, ocho paneles: token OAuth, cuenta sin ID inventado, extracción, revisión separada, casilla y cancelación. Los siete intercambios por recorrido son fixtures en memoria; no son solicitudes a fuentes ni importaciones reales. La evidencia anterior conserva sus fechas/bundles.

La sección Llamadas usa la ficha real de Riverz en ambas variantes. La [toma humana construida](voice-human-handoff.md) añade controles dentro de ella, conservando metadatos y transcripción. [Cuatro revisiones / ocho paneles](voice-human-handoff-qa.json) ES/EN, escritorio/móvil, comprobaron preparación, entrada explícita, confirmación, silencio y cierre. Todo el transporte de toma humana es ficticio: no accede al SDK de medios, micrófono, telefonía o IA. La columna actual no realiza solicitudes de ese control. Las otras secciones conservan su evidencia histórica; no se presenta este recorrido como una repetición completa de todo el catálogo.

La sección Buzón amplía el respaldo actual, con [QA independiente de cuatro recorridos / ocho paneles](voice-mailbox-qa.json). Ambas columnas preservan número e idioma de transferencia. La propuesta valida duración, guarda y desactiva una configuración ficticia, y explica en la ficha que el audio aparece cuando está disponible, sin transcripción o devolución automática. Sus GET/PUT son respuestas en memoria, no cambios de un comercio o grabaciones reales.

La sección Voz por WhatsApp conserva respaldo humano y botón telefónico. Añade [opt-in y llamada revisada](voice-whatsapp-calling.md), con [cuatro recorridos / ocho paneles propios](voice-whatsapp-calling-qa.json). Las tarifas de ejemplo del fixture no son acuerdos comerciales. Se comprueba solicitud incierta, recuperación de la misma llamada, conexión/cierre ficticios y confirmación nueva para otra llamada. Ningún POST llama a Meta, usa micrófono o consume IA. La evidencia anterior conserva sus fechas/bundles; las capturas siguen privadas hasta comparar el plan completo.

La sección SMS compara [configuración y composición revisada](native-sms.md) con datos ficticios y conserva la referencia a Gmail/Outlook/Zoho; no reproduce toda la pantalla de Canales. [Evidencia funcional y visual](native-sms-qa.json): cuatro combinaciones ES/EN/escritorio/móvil, con permiso explícito, texto exacto, doble clic, pérdida de ACK, comprobante en cola y callback ficticio. Los tres POST/cinco GET por recorrido no salen del adaptador en memoria. Ambos builds pasaron. El host se recuperó y permitió inspeccionar capturas ES/escritorio y EN/móvil; los fallos iniciales y el diagnóstico de la barra lateral permanecen en la evidencia histórica.

La sección Reseñas añade [Judge.me dentro de Productos y Canales](native-store-reviews.md), conservando catálogo y reseñas actuales de Mercado Libre. La configuración y consulta quedan plegadas y solo cargan al abrir/refrescar. La respuesta exige revisar el texto público y la reseña en la tienda; creación aceptada por Judge.me no se presenta como visibilidad comprobada. La comparación usa recibos ficticios, sin proveedor, correo, publicación o IA real. [QA propia](native-store-reviews-qa.json), fuentes y CSS se registran aparte; la columna actual no consulta esta API. Las capturas continúan privadas hasta comparar el plan completo.
