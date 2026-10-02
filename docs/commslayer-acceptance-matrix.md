# Matriz de aceptación del plan Commslayer

Referencia: [plan acordado](plan-final-mejoras-riverz-commslayer.md), [registro de ejecución y pruebas por entrega](ejecucion-plan-commslayer.md) y [comparación privada](commslayer-comparison-guide.md). Fecha de consolidación: 2 de octubre de 2026.

Esta matriz separa construcción, comprobaciones y condiciones de disponibilidad. Una prueba aislada o un build no acredita una entrega física, un consentimiento externo, una autorización de cliente o un resultado comercial. Los controles nuevos permanecen ocultos en producción. Se conservan la navegación, campañas, plantillas, automatizaciones, precios y servicios personalizados.

## Fiabilidad y atención

| Bloque | Construcción y evidencia | Condición de aceptación |
| --- | --- | --- |
| P0A | Contrato y decisión compartidos; pruebas de `approvals/decision`, `resolve`, `execution-guard` y API de decisión. | Sesión/rol vigentes, un solo comprobante y resultados inciertos bloqueados. No se usó dinero real como QA. |
| P0B | Resúmenes monetarios y tarjetas del Operador; `dashboard/order-summary`, `metricas/resumen` y pruebas de agregación. | Monedas separadas, decimales exactos, dato ausente distinto de cero y asociación distinta de atribución causal. |
| P0C | Eventos, scheduler y worker personalizados; `automations/event-schema`, `event-worker`, `event-entries`, `schedule`. | Reintentos, límites de realimentación y pertenencia comprobados con SQL/motores aislados. |
| P0D | Traducción corregida y `templates/template-ai-draft`; pruebas de contexto y generación. | Propuesta editable; generar no publica ni envía. La llamada real al modelo no se usa como QA comercial. |
| P0E | Accesos contextuales; menú real conservado en el arnés. | Las rutas no representadas por el arnés se identifican; ninguna ausencia del fixture se interpreta como ausencia del producto. |
| B1 | Colaboración, notas, presencia, vistas y referencias; `inbox/collaboration`, `saved-views`, `related-conversations`. | Notas internas separadas del transporte/exportación y acceso actual por caso/buzón. Referencia manual no fusiona una identidad ambigua. |
| B2 | Seguimiento, macros, acciones masivas, atajos y capacidad; servicios y SQL registrados en B2. | Alcance seleccionado, recordatorio privado, disponibilidad y capacidad; reanudación sin perder historial. |
| B3 | Dirección, artículos, cancelación/reembolso, reposición, retención y crédito; servicios compartidos en `inbox/order-actions` y `shopify`. | Pedido/cliente/despacho actuales, aprobación, bloqueo duradero y comprobación posterior. Permisos y compatibilidad reales del proveedor son requisitos por operación. |
| B4 | Transcripción, resumen, traducción, exportación, disposición y bloqueo nativo. | Original recuperable, notas excluidas de exportación y datos de otra cuenta inaccesibles. El bloqueo requiere soporte real del canal. |

## Asistente y crecimiento

| Bloque | Construcción y evidencia | Condición de aceptación |
| --- | --- | --- |
| A1 | Versiones/borradores/restauración, replay individual, conflictos y restricciones por canal; `ai/guidance-versions`, `guidance-replay`, `tool-context`. | Prueba sin herramientas externas, versión y cobertura visibles, límites de permisos/dinero conservados. |
| A2 | Comprobantes de turno, fuentes versionadas y evaluación histórica por regla; `ai/turn-evidence`, `rule-reviews`, migración 356. | Contexto disponible distinto de aplicación demostrada; evaluación humana y denominador explícitos. No se inventa resolución atribuible a una regla entre varias. |
| A3 | Huecos, propuestas, conflictos, preguntas internas y respuestas limitadas al caso; `ai/gap-knowledge`, `case-gap-answers`, `case-gap-context`, avisos con comprobante. | Una excepción no se publica como política general; destino/origen/revisión y permisos vigentes. Avisar por WhatsApp está separado de guardar conocimiento. |
| C1 | Borrador compartido Operador/editor, selección contextual de productos, variables y comprobantes de envío; `broadcasts/draft` y servicios de campañas. | Mismo contenido/configuración; prueba y borrador separados de envío. Reintentos no vuelven a enviar a destinatarios ya intentados o confirmados. |
| C2 | Historial por contacto/paso, simulador, pausa/reanudación, enfriamiento y revisión de seguimientos. | El alcance de pausa se explica y se conserva historial. Una campaña sin conversación también cuenta para el enfriamiento configurado. |

## Operación y extensibilidad

| Bloque | Construcción y evidencia | Condición de aceptación |
| --- | --- | --- |
| O1 | Solicitudes guiadas y de dirección con autorización del visitante, revisión compartida y comprobante; migración 355. | Un número de pedido no autoriza a editarlo. Confirmación solo tras comprobar el dato real; ningún pedido real se modificó como QA. |
| O2 | Autoridad/transiciones del expediente, historial, logística declarada, recepción, reembolso vinculado y política por producto; migraciones 351–354. | Guía declarada distinta de etiqueta automática; recepción declarada distinta de aceptación física. Reembolso y crédito conservan revisión y resultados separados. |
| O3 | Historial privado, configuración general de novedades y fuente de identidad actual. | Configuración por negocio sin editar IDs; excepciones históricas deliberadas documentadas. No se habilita despacho simulado ni se trata un POST de creación como liberación idempotente. |
| O4 | Motivos, satisfacción con denominador y clasificación opcional sobre el turno existente; migraciones 328/347. | Otro distinto de sin clasificar; ausencia de CSAT distinta de negativo. Encuesta retirada no restaurada. |
| O5 | Evidencia por caso, carga/tiempos existentes, reglas, Flujos y chat web; migraciones 356–359 y corrección `5a068332`. | Cohortes autorizadas/completas, ventanas coherentes, CSV sin datos privados, monedas separadas y muestras visibles. Tiempo hasta revisión incluye su demora y no representa resolución automática por episodio. |
| E1 | PDF/DOCX/XLSX, texto revisable, versiones/retirada, Drive seleccionado y versiones en los turnos; migraciones 329/345/348. | Parser Linux comprobado; fallo no equivale a entrenamiento. Drive necesita consentimiento y acceso de Google; no se simula su concesión como éxito. |
| E2 | REST de consulta, HTTP propio con secretos protegidos, propuestas/revisión, Flujos/MCP/Operador e historial; migraciones y guards registrados en E2. | Destinos privados bloqueados, actor actual y comprobantes duraderos. Un ACK HTTP no demuestra cumplimiento comercial; un POST incierto no se reintenta automáticamente. |
| E3 | Instalación PWA y push privado voluntario por dispositivo; migración 350. | Abrir una notificación requiere sesión y permiso del caso; recibirla no autoriza dinero. Entrega física y compatibilidad se verifican en el dispositivo/proveedor correspondiente. |
| E4 | Aislamiento por negocio/caso/buzón, revocación, identidad transaccional, auditoría y diagnóstico. | No inferir reconexión por ausencia local; TOTP disponible comprobado sin enrolar al dueño ni cambiar políticas globales. |

## Comunicación y paquetes expresamente condicionados

M1–M5 tienen un [paquete privado de revisión](commslayer-release-materials.md). Material ilustrativo, pricing con fecha, fichas y changelog preparados no equivalen a publicación externa, testimonial autorizado ni resultados de clientes. Las demos públicas actuales permanecen mientras se compara el conjunto nuevo.

X1–X5 tienen en el plan un presupuesto propio y selección de proveedores/permiso: portal, conectores de migración, voz humana/WhatsApp Calling, canales adicionales y suscripciones. La instrucción más reciente de terminar todo se aplica incluyendo su construcción, con dependencias reales conservadas. X2 ya incluye revisión CSV local y [contactos con preparación privada, confirmación y comprobantes](migration-contact-import.md); El primer [conector nativo de contactos de Chatwoot](migration-native-chatwoot.md) está construido con extracción privada y revisión separada; el [archivo privado de historial y adjuntos](migration-private-history.md) está construido y publicado con revisión separada; los siguientes conectores continúan en construcción. No se declaran los paquetes “completos” por construir el núcleo o una vista previa. La expansión a Estados Unidos mantiene sus decisiones comerciales; configuración local de Shopify no acredita distribución o revisión del Dev Dashboard.

X1 tiene el [centro de ayuda y seguimiento protegido](help-portal-reviewed-sources.md) construido y validado: fuentes compartidas/versionadas, marca de la tienda, pedidos del visitante firmado y métricas de adopción/contacto evitado declarado. Su [QA propia](help-portal-qa.json) registra 151 pruebas y ocho revisiones nativas con fixtures. No acredita entregas físicas, causalidad comercial o publicación de artículos de clientes. X2–X5 no se declaran completos.

X2 incorpora [listado nativo de Kommo y selección de ManyChat](migration-native-external.md), con cola privada, credenciales vinculadas al negocio/actor/cuenta/selección y preparación de revisión bajo bloqueo transaccional. La selección de ManyChat no representa exportación de toda la cuenta; el listado de Kommo no es un snapshot atómico. Los siguientes conectores y X3–X5 continúan abiertos. [QA y capturas de esta ampliación](migration-native-external-qa.json).

La matriz conserva separadas construcción, pruebas físicas, publicaciones y decisiones comerciales. Cualquier declaración del 100 % debe identificar cuál alcance terminó y conservar estos límites.

La sección 12 cuenta con [evaluación privada de expansión](commslayer-us-expansion-review.md) y [ficha técnica de seguridad ES/EN](commslayer-security-review-pack.md). Son documentos preparados, sin cambio de oferta, distribución, términos legales o certificación.
