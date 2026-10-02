# WhatsApp Calling: ampliación privada de la voz actual

Riverz conserva su asistente entrenado, llamadas telefónicas, campañas, plantillas y automatizaciones. Esta ampliación añade llamadas de WhatsApp mediante el conector de LiveKit, cuando la cuenta de Meta, su permiso vigente y las tarifas configuradas lo permiten. La UI pública sigue apagada hasta comparar el conjunto del plan. No se habilita Calling en Meta ni se cambia SIP, horarios, permisos o precios mensuales automáticamente.

## Recorrido del negocio

1. En la sección actual de voz, un bloque plegable permite optar por entrantes y salientes por separado. Ambas opciones empiezan apagadas.
2. La ficha del contacto conserva el botón telefónico y añade el de WhatsApp. Un administrador debe revisar el nombre/número y confirmar antes de iniciar.
3. La solicitud conserva su identificador en la sesión. Ante pérdida de respuesta, consultar el estado no marca otra vez. Si todavía no existe un comprobante, una nueva revisión permite reenviar **la misma solicitud**, protegida por la reserva durable del servidor.
4. El estado «solicitud iniciada» no significa que contestaron. Riverz muestra conexión solo después de observar al participante exacto y confirmarlo en el servidor.
5. Preparar otra llamada exige resultado terminal y cierre confirmado, o cancelación previa a cualquier efecto del proveedor. Un cierre incierto impide marcar nuevamente al mismo destinatario hasta confirmar la terminación.

Todo el texto nuevo tiene español e inglés. La configuración adicional queda plegada; la bandeja y los controles actuales se conservan. La toma humana del primer bloque de X3 corresponde a la llamada SIP existente: este conector no se presenta como si ya incluyera toma humana o transferencia SIP de WhatsApp.

## Autoridad y transporte

Los webhooks se procesan después de la comprobación HMAC existente del cuerpo original. Se vinculan cuenta WABA, phone-number ID, dirección, cliente y el ID opaco de la llamada. Ofertas entrantes tienen frescura limitada; respuestas y terminaciones salientes pueden vincularse mediante `biz_opaque_callback_data` con el UUID reservado por Riverz. Un evento de terminación gana frente a una oferta tardía. IDs de Meta son opacos: se limitan longitud, espacios y controles, sin inventar un alfabeto Base64.

Las tablas privadas y las funciones de autoridad de 370 reservan una sola operación y nonce. Se vuelven a comprobar permisos actuales del administrador, sección, negocio, facturación, asistente activo, opt-out, número revisado, límites de concurrencia y minutos. La capacidad global usa el mismo bloqueo que el despachador telefónico. Duplicados no repiten el RPC del proveedor; una respuesta incierta tampoco provoca failover o reintento automático. 371 reduce el diagnóstico de metadatos a SECURITY INVOKER con search path vacío, conservando privadas las funciones que sí requieren autoridad del servidor.

Las consultas a Meta son GET a rutas fijas, con Bearer y app-secret proof, límites de tiempo/cuerpo, JSON estricto y sin redirecciones. Antes de una saliente se comprueban Calling habilitado, compatibilidad con Graph, país del número del negocio y permiso vigente para ese destinatario. Un opt-in local no concede permiso de Meta. No se envían solicitudes de permiso ni plantillas de autorización automáticamente. El conector documentado requiere teléfono internacional sin `+`; un BSUID sin teléfono se conserva como tal y se rechaza para este transporte, sin adivinarlo.

La app usa `ConnectorClient` del SDK existente de LiveKit. El worker espera explícitamente la identidad vinculada y `ParticipantKind.CONNECTOR` (7), valida sus atributos y obtiene confirmación del servidor antes de arrancar el asistente. La versión fijada de LiveKit Agents 1.6.7 incluye CONNECTOR entre sus tipos predeterminados; el filtro explícito sirve para exigir **este** cliente, no para corregir un supuesto predeterminado que lo excluya.

Una terminación informada por Meta limpia el conector como USER_INITIATED sin reenviar token; un cierre iniciado por Riverz usa la conexión privada original y su credencial actual. El cierre se reclama una vez y registra ACK o incertidumbre. Cerrar la sala no demuestra por sí solo el cierre de Meta. No hay reconexión, remarcación automática ni envío a la cola PSTN.

## Privacidad y costes

La llamada reutiliza instrucciones, catálogo y herramientas del asistente del negocio. Su historial usa la familia de identidad verificada y excluye Gmail, Outlook y Zoho, considerados buzones personales por la política vigente. También se omiten los resúmenes antiguos de contacto y conversaciones, porque su procedencia de buzón no está registrada. Mensajes recientes de canales compartidos y datos del negocio permanecen disponibles. Los bindings internos `__whatsapp_call` no se exponen al modelo.

El presupuesto de medios se reserva antes de cualquier RPC que inicia la llamada. Un fallo previo al proveedor cancela la preparación y concilia a cero el consumo real; esto incluye revocación del permiso durante una preparación lenta. Las salientes requieren una comprobación reciente, sin reutilizar permisos históricos. La grabación empieza apagada salvo configuración explícita del negocio; si se habilita, conserva el aviso correspondiente.

| Configuración del servidor | Condición |
| --- | --- |
| `VOICE_WHATSAPP_INBOUND_USD_PER_MIN` | Tarifa entrante acordada; número finito mayor o igual a cero. |
| `VOICE_WHATSAPP_OUTBOUND_USD_PER_MIN` | Tarifa saliente acordada; número finito mayor o igual a cero. |
| `LIVEKIT_URL` y credenciales existentes | LiveKit Cloud; no se cambian ni se muestran al cliente. |
| `NEXT_PUBLIC_RIVERZ_UI_STAGE` | Permanece sin configurar en la app pública. `comparison` solo expone el entorno de comparación autorizado. |

Si una tarifa falta, esa dirección no puede habilitarse. No se copia la tarifa de telefonía ni se inventa un acuerdo comercial. STT/LLM/TTS y transporte mantienen su consumo real; el plan mensual actual no cambia. Construir o mostrar el control no ejecuta IA ni llamadas. Una llamada sí utiliza saldo y está sujeta a la disponibilidad y condiciones actuales del proveedor.

## Validación y límites

La validación usa SDKs y datos ficticios, PGlite local, compilaciones completas, tipos y revisiones privadas ES/EN en escritorio/móvil. El esquema real se verifica con metadatos y contextos nulos: no se crean llamadas, contactos, permisos, grabaciones, reservas de saldo o tareas de purga como QA. La evidencia final y sus hashes se registran aparte cuando termina el cierre del bloque.

Un build y un despliegue no acreditan una llamada física, aprobación de la cuenta de Meta, permiso de un cliente, tarifa comercial o calidad de audio. Esas condiciones siguen siendo obligatorias para el uso real; no se sustituyen por respuestas ficticias. Los controles de transferencia/toma humana SIP existentes permanecen en su transporte actual.

## Contratos consultados

- [Meta: llamadas iniciadas por usuarios](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-initiated-calls).
- [Meta: llamadas iniciadas por el negocio](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/business-initiated-calls).
- [Meta: Calling y permisos](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/).
- [LiveKit: conector de WhatsApp](https://docs.livekit.io/telephony/connectors/whatsapp/).
- [LiveKit: API del conector](https://docs.livekit.io/reference/telephony/connectors-api/).
- [Protocolo del conector](https://github.com/livekit/protocol/blob/main/protobufs/livekit_connector_whatsapp.proto).
- [LiveKit Agents 1.6.7: job.py](https://github.com/livekit/agents/blob/livekit-agents%401.6.7/livekit-agents/livekit/agents/job.py).

Consulta de fuentes públicas: 2 de octubre de 2026. Ninguna cuenta de proveedor se usó como prueba.
