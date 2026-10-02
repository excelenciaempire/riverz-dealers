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

X1–X5 se separaron inicialmente porque requieren proveedores, permisos y presupuestos propios. La instrucción de terminar todo incluye su construcción. Su disponibilidad en un negocio conserva las condiciones reales de cada integración.

| Paquete | Entrega construida | Evidencia y condición externa |
| --- | --- | --- |
| X1 Portal | Fuentes compartidas/versionadas, marca, pedidos del visitante firmado y métricas separadas de adopción/contacto evitado declarado. | [Contrato](help-portal-reviewed-sources.md), [QA](help-portal-qa.json). Publicado, oculto; no acredita publicaciones ni resultados comerciales de clientes. |
| X2 Migraciones | CSV de Kommo, Leadsales, ManyChat, Chatwoot, Gorgias y Zendesk; Chatwoot nativo con historial/adjuntos, Kommo nativo, ManyChat por IDs seleccionados y Gorgias/Zendesk por cursor. | [CSV](migration-contact-import.md), [Chatwoot](migration-native-chatwoot.md), [historial](migration-private-history.md), [Kommo/ManyChat](migration-native-external.md), [cursores](migration-native-cursors.md). Conectores construidos publicados, ocultos. No hay exportación global de ManyChat ni históricos nativos de todas las fuentes. |
| X3 Voz | Toma humana de la llamada existente, respaldo/contexto conservado, buzón optativo y WhatsApp Calling revisado. | [Toma humana](voice-human-handoff-qa.json), [buzón](voice-mailbox-qa.json), [WhatsApp Calling](voice-whatsapp-calling-qa.json). App/worker publicados, ocultos; fixtures no acreditan una llamada física o elegibilidad de Meta. |
| X4 Canales | SMS con consentimiento/revisión/comprobantes y Judge.me con respuesta revisada; evaluación de correo cerrada conservando Gmail/Outlook/Zoho. | [SMS](native-sms-qa.json), [Judge.me](native-store-reviews-qa.json), [correo](email-expansion-evaluation.md). Publicados, ocultos. Sin adaptador SMTP/IMAP adicional no demandado ni envíos reales como QA. |
| X5 Suscripciones | Recharge seleccionado: cliente vinculado, consultas, cantidad, frecuencia, fecha, cancelación, reactivación y salto de una entrega revisados. Intento durable e incertidumbre conservada. | [Contrato](subscriptions-recharge-contract.md), [implementación](native-subscriptions.md), [QA](native-subscriptions-qa.json). 452 pruebas, ambos builds, cuatro recorridos con 22 controles y seis controles adicionales de incertidumbre. Despliegue de este incremento en curso; no acredita instalación o cobro reales, ni Loop/Skio. |

El único adaptador nativo de migración cuya implementación sigue detenida es Leadsales: [contrato técnico no recuperable desde las fuentes públicas consultadas](migration-leadsales-contract.md). Firecrawl agotó las fuentes disponibles sin crear cuentas ni acceder a clientes. Su CSV funciona. Leadsales es una fuente opcional para negocios que llegan desde ese CRM; Riverz no depende de él y el dueño no necesita abrir una cuenta o proporcionar claves. No se interpreta CSV como prueba de una API nativa ni se inventan endpoints. Este límite no detiene los demás bloques.

La matriz conserva separadas construcción, operaciones físicas, publicación y decisiones comerciales. La [comparación privada](commslayer-comparison-guide.md) incluye 21 secciones con controles reales y datos ficticios. La QA histórica de cada ampliación conserva su fecha y bundle; no equivale a repetir todo el catálogo sobre el último bundle. Campañas, plantillas, automatizaciones, precios y navegación permanecen.

La sección 12 cuenta con [evaluación privada de expansión](commslayer-us-expansion-review.md) y [ficha técnica de seguridad ES/EN](commslayer-security-review-pack.md). Son documentos preparados, sin cambio de oferta, distribución, términos legales o certificación. Los permisos de Google/Meta, la entrega de push en un dispositivo y la distribución de Shopify se comprueban en su entorno correspondiente; no son resultados acreditados por una compilación.
