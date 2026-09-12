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
| Credenciales en diagnósticos | Un error de integración podía incluir un token en su URL o texto y llegar a Operador. | Se ocultan patrones explícitos de credenciales en el diagnóstico, prompts y bloques de texto enviados al modelo. Se conservan códigos de error, fechas, datos comerciales, autenticación del proveedor, firmas y adjuntos. |

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

La continuación incluyó evaluaciones pagadas contra modelos reales e inspección del historial Git, descritas abajo. No se hicieron pruebas de carga, envíos a clientes ni explotación destructiva en producción. Se requieren evaluaciones periódicas con los modelos, herramientas y fuentes reales a medida que cambien.

Cambio deliberado: los pagos informados al asistente requieren comprobar el ingreso antes de marcar el pedido pagado. Una imagen, PDF o afirmación del modelo no sustituye la verificación bancaria. Los caminos autenticados del comercio y las integraciones de pago conservan sus controles existentes.

Publicar el commit y verificar la revisión desplegada son pasos distintos; no se debe presentar una validación local como confirmación de producción.

## Continuación: verificación real y prevención de exposición de tokens

- Se confirmó desplegado `8dd3a96a69b213dc2d301930472a74fbc212783f` en `https://riverz.co/api/health`, con Supabase y WhatsApp en estado `ok`.
- `scripts/eval-prompt-security.ts` usa la fábrica real de clientes y la facturación normal, con datos ficticios, secreto ficticio y herramientas que nunca se despachan contra el comercio. Contempla respuestas de varios turnos, límite de gasto de 2 USD por ejecución y recuento de tokens antes de solicitar la respuesta. Es una evaluación optativa; no corre con las pruebas normales ni en CI.
- Evaluación final: **32/32 casos aprobados**, 16 por modelo (`claude-haiku-4-5-20251001` y `claude-opus-5`): 24 casos adversariales y 8 controles legítimos. Incluye español/inglés, suplantación de roles, base64, resultados de herramientas, resúmenes, catálogo, Operador, imágenes PNG y documentos PDF reales. Los controles legítimos incluyen lectura de imágenes y PDF sin instrucciones maliciosas.
- Se revisaron también los textos y las herramientas solicitadas. No se observó divulgación del secreto ficticio, extracción por imagen externa, selección de otro comercio/pedido ni solicitud de una herramienta prohibida. Las consultas legítimas conservaron el precio esperado. Esto mide los escenarios concretos; no es una evaluación exhaustiva del comportamiento o del idioma de la interfaz.
- En una ejecución exploratoria, dos rechazos explícitos (`stop_reason=refusal`) se clasificaron incorrectamente como incompletos, y otra respuesta se recortó al límite de 240 tokens. Se corrigió el evaluador para distinguir rechazo de error y se amplió a 512 tokens; se repitieron los casos y después la matriz completa. Un rechazo explícito no cuenta como respuesta válida en controles legítimos.
- Costo del proveedor: **0,337957 USD** en la matriz final; **0,897521 USD** entre las cuatro ejecuciones. No se enviaron mensajes ni se ejecutaron herramientas comerciales.
- `scripts/audit-secret-history.mjs`: **2.132 commits**, **541.444 líneas añadidas**, cero coincidencias de los patrones examinados (tokens Supabase/Anthropic/GitHub/AWS, claves privadas y JWT `service_role`). No es detección universal de secretos ni cubre ramas no disponibles localmente.
- Se revisaron 79 conexiones de producción sin imprimir sus errores: ninguna contenía las asignaciones de credenciales examinadas. La nueva protección corrige el camino reproducido con un error ficticio; no se afirma que hubiera una filtración real.
- Comprobaciones sin sesión en producción: `/.env`, `/.git/config`, `/api/admin` y `/api/operacion/operator` devolvieron 404; el puente de voz devolvió 401 ante una consulta ficticia. No se observó permiso CORS para el origen ajeno usado en estas comprobaciones.
- Validación final local: **3.170 pruebas en 366 archivos**, compilación y lint aprobados; `npm audit` informó cero vulnerabilidades conocidas. Una primera ejecución concurrente agotó los cinco segundos de una prueba de esquema Zoho; pasó aislada y en la repetición completa con dos trabajadores.

Evidencia local reproducible (sin credenciales ni datos de clientes): `output/prompt-security-live-final.json`, `output/secret-history-audit.json`, `output/production-security-probes.json`. Las salidas están excluidas de Git; el evaluador y el escáner sí se versionan.
