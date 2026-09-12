# Defensa frente a prompt injection — 12 de septiembre de 2026

## Alcance y método

Revisión del código de Riverz, controles de ejecución y pruebas locales con respuestas hostiles de un modelo simulado. Se inspeccionó Neo en el commit `d27abf0ed1ea305bdfdf7fe9e300f107fba77ce3` del repositorio privado `excelenciaempire/neo`: README, metodología web/API y prevención de IDOR. Se aplicó su secuencia de inventario, reproducción mínima, corrección y evidencia. No se instalaron ni ejecutaron Kali, HexStrike, Raptor, Burp o WSTG-Scan; no se atribuyen resultados a esas herramientas.

Referencia específica de IA: [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Los prompts son una defensa de comportamiento; los permisos y las aprobaciones deben imponerse también fuera del modelo.

## Hallazgos corregidos

| Control | Antes | Después |
|---|---|---|
| Herramientas del chat y comentarios | El despachador aceptaba un nombre implementado aunque no estuviera ofrecido en ese turno. | Solo admite herramientas locales ofrecidas y argumentos de tipo objeto. Las rechazadas no ejecutan efectos. |
| Llamadas | El puente confiaba en la lista anunciada por el worker. | Revisa los permisos del agente en el servidor, rechaza nombres desconocidos y comprueba que contacto y agente pertenecen al comercio de la llamada. |
| Aprobaciones | `create_order`, `create_checkout` y `update_order` no coincidían con los nombres guardados en los permisos. | Una correspondencia explícita aplica «con aprobación» antes de ejecutar. La simulación no crea solicitudes reales ni avisos. |
| Operador | El llamador decidía si una construcción era inerte. | El ejecutor vuelve a comprobarlo; los argumentos no pueden concederse aprobación. |
| Comprobantes | Los datos extraídos por IA podían llegar al marcado automático del pago. | El camino de IA exige verificación humana, incluso con monto, referencia y archivo adjunto. Conserva evidencia y pausa recordatorios. |
| Instrucciones externas | La protección variaba entre superficies. | Política común sobre mensajes, PDF, OCR, audio, páginas, herramientas, integraciones y resúmenes. |
| Memoria y contexto | Algunos resúmenes y antecedentes se interpolaban como texto del sistema. | Bloques de datos con delimitadores escapados y contenido preservado. |

## Cobertura compartida

Los tres clientes Anthropic (normal, streaming y especialistas) agregan la política antes del transporte y de contabilizar tokens. Esto incluye chat, comentarios, seguimientos, resúmenes, búsqueda, investigación de productos, generación de agentes y contenido, segmentación, flujos y Operador. La política también se aplica a los proveedores alternativos de Instagram y al contexto de voz después del recorte del prompt. Se mantienen los bloques de caché y la autenticación del proveedor.

La selección de cuenta continúa bajo control del servidor. Esta revisión suma pruebas del puente de voz a las pruebas existentes de aislamiento del Operador. `send_whatsapp` conserva el destinatario de la llamada; no acepta otro destinatario desde el modelo.

## Verificación reproducible

- `npx vitest run --maxWorkers=4`: suite completa y regresiones de herramientas inventadas, permisos apagados, nombres alternativos, aprobación falsificada, registros de otra cuenta y comprobantes manipulables.
- Casos de datos hostiles en español e inglés, etiquetas de sistema falsas, cierre de delimitadores, texto codificado y enlaces de extracción. Prueban conservación y aislamiento estructural de datos, no una tasa de resistencia de un modelo real.
- `node scripts/audit-ai-security.mjs`: inspección de 1.341 archivos TypeScript de aplicación; tres constructores Anthropic en la fábrica compartida y cero coincidencias de los patrones de credenciales examinados. Se añade este control a CI. Es un control acotado, no un escáner universal de secretos.
- Resultado: 365 archivos de pruebas y 3.158 pruebas aprobadas en la suite completa. Tras reforzar el orden de simulación/aprobación, 25 pruebas dirigidas aprobadas, incluidas tres nuevas regresiones. Compilación, comprobación final de tipos y lint de archivos modificados aprobados.
- Auditoría de solo lectura del esquema de producción: cero tablas sin RLS, cero políticas de escritura irrestrictas y cero funciones privilegiadas expuestas según `scripts/audit-security.mjs`.

## Límites y cambio de comportamiento

No se puede demostrar ausencia universal de prompt injection. Un modelo aún puede generar una respuesta incorrecta o seguir instrucciones hostiles dentro de capacidades que sí tiene autorizadas. Los controles deterministas añadidos restringen los caminos reproducidos; la política de instrucciones no convierte contenido externo en fiable.

No se hicieron pruebas pagadas de jailbreak contra modelos reales, pruebas de carga, envíos a clientes ni explotación en producción. Tampoco se ha auditado todo el historial Git en busca de secretos. Se requieren evaluaciones periódicas con los modelos, herramientas y fuentes reales a medida que cambien.

Cambio deliberado: los pagos informados al asistente requieren comprobar el ingreso antes de marcar el pedido pagado. Una imagen, PDF o afirmación del modelo no sustituye la verificación bancaria. Los caminos autenticados del comercio y las integraciones de pago conservan sus controles existentes.

Publicar el commit y verificar la revisión desplegada son pasos distintos; no se debe presentar una validación local como confirmación de producción.
