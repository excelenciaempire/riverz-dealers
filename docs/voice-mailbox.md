# Buzón de voz dentro de la operación actual

Amplía el fallback de llamadas entrantes. Conserva la transferencia telefónica, la ficha de llamada, el bucket privado, la bandeja y sus herramientas de seguimiento. Los controles nuevos y la activación del worker están apagados sin `NEXT_PUBLIC_RIVERZ_UI_STAGE=comparison`.

## Comportamiento

1. Un administrador puede elegir grabar cuando no hay destino humano o la transferencia recibió un rechazo SIP explícito. No cambia el número, permisos regulatorios, política de grabación de las llamadas de IA o capacidad existentes. La duración después del aviso/tono debe ser un entero de 15 a 120 segundos; el valor inicial es 60. Escritura bloqueada por mensualidad vencida o estado de pago ilegible.
2. La llamada entrante conserva una decisión de buzón versionada en su contexto. Reentregar esa sesión no activa retroactivamente el buzón con una configuración nueva. Una llamada de IA sana continúa por su flujo actual; kill switch, DID ambiguo y desconexión mantienen sus bloqueos.
3. El worker usa un aviso fijo ES/EN y un tono, sintetizados localmente una sola vez con eSpeak NG/WASM. No hay TTS, STT, LLM o transcripción de buzón en ejecución. Egress debe aceptar la grabación antes de anunciarla; inicio limitado a diez segundos y aviso a quince. Si falla, se cierra la llamada sin presentar una grabación lograda.
4. La captura termina al salir el participante SIP exacto o al agotarse el máximo. Antes de pedir cerrar la sala se registra el resultado, para que el finalizador conserve ese estado. Un timeout de REFER o transporte no inicia el buzón: la transferencia podría seguir ejecutándose. Los rechazos SIP explícitos compatibles se prueban aparte.
5. El comprobante dice `recording_requested`, no que se haya subido el objeto, que el cliente habló o que pidió una devolución de llamada. La conversación entra sin transcripción en la bandeja actual. El equipo puede escuchar y usar el seguimiento existente; no hay devolución de llamada ni respuesta de IA automática añadidas.
6. La reproducción del buzón exige negocio seleccionado, rol/sección/contacto/conversación actuales y propiedad de un eventual correo personal. Se vuelve a comprobar acceso después de Storage. Solo se firma `<call_id>.ogg` en el bucket privado durante 60 segundos; no se expone una URL propuesta por el worker. Un objeto aún ausente mantiene el audio vacío.

Telefonía y grabación conservan sus costes existentes; el pricing mensual permanece igual. El fallback sin agente no se estima como STT/LLM/TTS. Una grabación no es resolución automática ni evidencia de contenido conocido.

## Fuentes y límites

[LiveKit: grabación de sala con audio](https://docs.livekit.io/transport/media/ingress-egress/egress/room-composite/) y [AudioSource](https://docs.livekit.io/reference/python/livekit/rtc/audio_source.html). La implementación conserva RoomComposite/audio-only y el destino privado existentes. [eSpeak NG](https://github.com/espeak-ng/espeak-ng) y [paquete WASM utilizado fuera del producto](https://github.com/ianmarmour/espeak-ng.js): versión npm `1.0.2`, integridad SHA-512 comprobada. El paquete no se instala en Riverz ni en Render y no añade dependencias de ejecución. La revisión automática rechazó extraer un MSI; se conservó esa limitación y se generaron los avisos con WASM sin instalador o scripts de instalación.

## Validación de esta entrega

345 pruebas en 40 archivos de regresión y 18 pruebas Python, TypeScript completo, lint final sin errores/avisos y builds normal y de comparación completos. Quince archivos fuente y siete CSS coinciden entre trabajo, validación y comparación. [QA y hashes](voice-mailbox-qa.json) conserva cuatro recorridos nativos, ocho paneles ES/EN y escritorio/móvil: 121 segundos no se guarda, 45 sí, número/idioma actuales preservados, desactivación y ficha sin audio inexistente correctos. Sin desbordamientos ni errores nuevos; dos errores históricos de consola permanecen registrados. Escritorio ES y móvil EN inspeccionados visualmente. El servidor privado bloquea APIs/escrituras, archivos privados, hosts ajenos y conexiones externas.

No se hicieron llamadas de prueba a clientes, grabaciones en producción o accesos a objetos reales. La comparación usa configuración/llamada ficticias y no reproduce audio externo. WhatsApp Calling y las demás ampliaciones X2/X4/X5 siguen dentro del objetivo; este bloque no termina el plan completo.
