# Toma humana de una llamada existente

X3 conserva Llamadas, campañas de voz, ficha de cliente, herramientas, grabación y resultado actuales. Añade un detalle plegable en una llamada en curso; no incorpora una nueva plataforma ni cambia la navegación o el pricing. Está oculto con `NEXT_PUBLIC_RIVERZ_UI_STAGE` sin configurar. La comparación privada usa el componente real con un transporte ficticio sin micrófono, telefonía, credenciales o IA.

## Protocolo

1. El worker registra una llamada contestada: mismo `call_id`, sala y participante SIP observados por el SDK del servidor; nonce inmutable por llamada. La identidad saliente es `caller-<call_id>`; la entrante requiere el identificador de sesión original exacto. El servidor comprueba que sea SIP y tenga estado `active`.
2. Una persona con permiso vigente sobre `/voz`, contacto, negocio y conversación puede solicitar una toma exclusiva. Las conversaciones de correo personal conservan la propiedad de la conexión, incluso frente al dueño del workspace. La solicitud vence en 45 segundos y no puede reemplazarse por otro controlador.
3. El worker apaga entrada/salida de IA y espera el cierre de `AgentSession`. Se conserva la sala, el participante telefónico, la grabación habilitada y el finalizador. Las herramientas de negocio tienen slots durables que el backend libera en `finally` después de terminar; cancelar el HTTP del worker no prueba que una herramienta terminó. Los slots viejos no se limpian por tiempo en una llamada activa. Una transferencia SIP REFER en curso impide la entrada del navegador.
4. Solo con IA cerrada y slots vacíos se confirma `ready`. Pulsar Entrar con micrófono solicita un token efímero, limitado a esa sala/actor/trabajo, con un máximo de 30 segundos y publicación exclusiva de micrófono. No incluye permisos de administración, SIP, datos, métricas o control de agentes. Se revalida autoridad después de observar al cliente. Ningún token se conserva en URLs o almacenamiento del navegador.
5. El cliente se suscribe únicamente al audio del participante SIP exacto, sin auto-suscripción ni reconexión automática. El worker y el servidor observan la identidad real `human_<trabajo>` y sus atributos firmados antes de confirmar `connected`; el navegador no declara su propia conexión.
6. El navegador consulta cada cinco segundos y renueva cada quince, con un lease conectado de treinta. El worker consulta cada dos y se considera disponible por quince segundos. Cada operación vuelve a comprobar permisos, negocio y facturación. Pérdida de control, vencimiento, cierre de vista o salida del participante llevan al cierre; no se reanuda silenciosamente la IA ni se crea otra sala.
7. Finalizar llamada cierra audio local y registra una solicitud de cierre. El worker pide retirar/revocar el participante humano y eliminar la sala, con el finalizador existente para resultado, grabación y coste. Un acuse de base de datos no acredita por sí solo que el proveedor ya desconectó a todos. El timeout máximo de llamada se mantiene; el guard de silencio de IA se detiene durante la toma humana.

## Costes y evidencia

La toma humana cierra STT/LLM/TTS de la sesión. Telefonía y grabación habilitada conservan sus costes habituales; el pricing permanece igual. No se añade transcripción de la conversación humana. El resumen final existente puede seguir utilizando IA para el tramo previo del asistente. La ficha explica que resumen/transcripción cubren ese tramo; no presenta el audio humano como texto conocido o resolución automática.

La medición real de STT tiene prioridad. Si falta, su estimación se limita al instante privado e inmutable en que el worker confirmó IA cerrada/herramientas drenadas; el tiempo humano posterior no se estima como STT. Sin el flag, no hay registro/polling de toma humana, slots adicionales por herramienta, tokens, media nueva ni lecturas adicionales de esa frontera. La facturación conserva su comprobante idempotente actual.

## Protección y despliegue

Migración 369: tres tablas privadas con RLS, sin acceso directo de anon/authenticated/service_role. Operaciones definidoras solo para servicio, contexto estricto y search path fijo. Un probe invoker comprueba los metadatos y el build lo requiere cuando hay entorno configurado. La retención diaria elimina hasta 100 controles de llamadas terminales de más de treinta días; nunca borra el barrier de una llamada activa.

El worker Render conserva su filtro `voice-worker/**`. Su margen de apagado pasa de 30 a 300 segundos, el máximo soportado por Render, para dar tiempo al drenaje SIGTERM existente. Ese margen no garantiza terminar llamadas configuradas de hasta una hora; se verifica actividad antes del push y no se prueban interrupciones con clientes reales. [Documentación oficial de despliegues](https://render.com/docs/deploys).

Esta construcción no acredita una prueba física de audio con clientes ni cierra las otras partes de X3: WhatsApp Calling y buzón/cola de voz continúan dentro del alcance. Tampoco cierra X2, X4, X5 o el plan completo.

## Validación del bloque

861 pruebas en 76 archivos y 10 pruebas Python con proveedores/medios ficticios. Ambos builds completos con TypeScript terminaron correctamente. Cuatro recorridos nativos ES/EN, escritorio/móvil, validaron la ficha real, preparación, entrada explícita, confirmación, silencio y cierre, sin acceso a micrófonos o llamadas reales. [Evidencia, hashes y capturas](voice-human-handoff-qa.json).
