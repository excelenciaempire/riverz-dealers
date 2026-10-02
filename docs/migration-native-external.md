# Migraciones nativas: Kommo y ManyChat

ES: extracción privada y revisión separada de contactos. La UI pública continúa apagada; el flujo está disponible en la comparación local con datos ficticios. No llama a IA, envía mensajes, ejecuta automatizaciones ni modifica precios.

EN: private contact collection with separate import review. Public UI remains disabled; the flow is available in the local comparison with fictional data. It does not call AI, send messages, execute automations or change prices.

## Cobertura comprobada

| Fuente | Consulta construida | Límites |
| --- | --- | --- |
| Kommo | `GET /api/v4/contacts`, 25 registros por página, orden ID ascendente. Comprueba `account_id`, página, orden y duplicados. | Hasta 5.000 contactos, 8 MB de preparación y 128 KB por respuesta. El total permanece desconocido hasta el final. |
| ManyChat | `GET /fb/page/getInfo` y `GET /fb/subscriber/getInfo?subscriber_id=…`. Comprueba Page propietaria del token y Page/ID de cada suscriptor. | Hasta 100 IDs seleccionados por el operador, sin enumerar otros IDs ni afirmar exportación de toda la cuenta. |

Los conectores usan únicamente recursos GET y hosts exactos del proveedor. No siguen enlaces devueltos ni redirecciones. DNS público fijado, TLS verificado, 8 segundos por consulta; credenciales Bearer sin headers arbitrarios. Un token distinto, proveedor, cuenta, actor, negocio, trabajo o selección cambia la identidad de reintento. AES-GCM protege la credencial y su contexto; nunca se guarda el token en URLs o almacenamiento del navegador.

Kommo no proporciona aquí un snapshot atómico: cambios concurrentes pueden alterar la lista. Se detectan duplicados, desorden y cruces de cuenta; no se afirma que se detecta toda inserción o eliminación concurrente. Una página corta/204 termina la lectura observada, no demuestra que el proveedor carezca de otros datos inaccesibles. Campos extensos pueden detener una página por el límite de respuesta; no se convierte esa interrupción en éxito parcial.

ManyChat consulta la selección explícita, conservando su orden. No se fabricó un endpoint para listar toda la cuenta. Dos teléfonos distintos o múltiples valores PHONE/EMAIL de Kommo dejan ese campo vacío para excluir o revisar el registro; no se selecciona una identidad por prioridad. Solo se conservan ID, teléfono, nombre, email y empresa vacía. No se copian prompts, conversaciones, opt-ins, tokens, notas, fotos, etiquetas o campos arbitrarios. Identificadores de empresa no se presentan como nombres.

## Revisión y límites de autoridad

1. Un propietario o administrador con `/contactos` y negocio escribible inicia el trabajo con token autorizado.
2. El cron privado obtiene una lease nueva y comprueba los permisos actuales antes de descifrar y consultar cada página.
3. Se muestran avance y muestra paginada de hasta 25 registros. La credencial se borra al terminar o cancelar; preparación disponible durante dos horas.
4. “Preparar revisión de importación” bloquea el trabajo vigente dentro de la misma transacción. Cancelación, vencimiento o cohorte distinta impiden preparar una revisión copiada.
5. La revisión existente exige confirmación humana independiente. Conserva deduplicación, campos de origen declarado y bloqueo de unión; no acredita `wa_id` ni consentimiento de contacto.

Cola independiente de Chatwoot e historial: tres extracciones activas y diez preparaciones vigentes por negocio. Hasta dos leases por ronda, ocho rondas y 40 segundos por ejecución. Una pausa mínima entre páginas limita ráfagas; reintentos transitorios con pausas de 1/2/4 minutos, tres reintentos máximos. Fallos de permisos, autenticación, contenido o identidad detienen el trabajo y borran credenciales/datos. No se registra el error crudo del proveedor.

Tabla privada sin lectura directa para `anon`, `authenticated` o `service_role`; acceso únicamente mediante RPC con scope vigente. Purga diaria acotada a 500 preparaciones y 500 metadatos terminales: expiración se impone al consultar y recoger, incluso con cron retrasado. Metadatos terminales retenidos 30 días: conservan proveedor, dirección, cuenta y los IDs seleccionados inicialmente en ManyChat. Cancelar/vencer borra la credencial y los campos traídos de contactos; no borra de inmediato esa selección de origen ni el identificador del trabajo. La purga física de metadatos puede retrasarse si el cron está detenido o existe backlog.

## Fuentes primarias revisadas: 2026-10-02

- [Kommo: lista de contactos](https://developers.kommo.com/reference/contacts-list): GET, cuenta y paginación de contactos; no prueba de una cuenta comercial real.
- [ManyChat: especificación pública Page API](https://api.manychat.com/swagger/compileJson?type=Page_API): Page/getInfo y subscriber/getInfo; la especificación revisada no contiene una lista de todos los suscriptores. La copia de investigación es temporal y no contiene datos de clientes.
- [Leadsales: acceso al token](https://iozssqbrp.gleap.help/en/articles/9135023-how-to-generate-and-use-your-api-token-in-leadsales): suscripción y aprobación del dueño. No se compró acceso ni se inventaron endpoints sin especificación técnica.

Esta entrega original de Kommo/ManyChat se conserva con su QA propia. Gorgias/Zendesk se ampliaron posteriormente en [el contrato de cursores](migration-native-cursors.md); Leadsales y el historial de esas fuentes requieren su contrato correspondiente. CSV sigue disponible para las seis herramientas. Pruebas con fixtures y SQL aislado no acreditan autorización de cuentas, exportación comercial real o conversaciones entregadas por otras APIs.
