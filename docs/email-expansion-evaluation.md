# X4 — evaluación de correo adicional

La condición del plan es «ampliar proveedores de correo si la demanda lo justifica», conservando Gmail, Outlook y Zoho. La evidencia de esta sesión no identifica un proveedor adicional solicitado, un comercio que necesite IMAP/SMTP ni un caso que los canales actuales no cubran. La decisión es conservarlos y completar SMS/reseñas; no añadir un cuarto formulario de correo sin necesidad comprobada. Esto cierra la evaluación condicional, no declara construido un adaptador SMTP/IMAP.

## Base verificada en código

| Canal | Implementación conservada |
| --- | --- |
| Gmail | `src/lib/channels/gmail/adapter.ts`, `poll.ts`, `watch.ts`: OAuth, actualización de token, respuestas con RFC Message-ID/hilo, adjuntos y lectura incremental. Crons de polling y renovación de watch. |
| Outlook | `src/lib/channels/outlook/adapter.ts`, `poll.ts`, `watch.ts`: Graph, OAuth, respuestas, adjuntos, notificaciones y polling. El archivo describe cobertura de cuentas personales y Microsoft 365; no se probó una cuenta real para acreditarla. |
| Zoho | `src/lib/channels/zoho/adapter.ts`, `auth.ts`, `poll.ts`: cuenta/región explícitas, actualización de token, respuestas y adjuntos; ingreso por polling. No se inventa un webhook equivalente a Google/Microsoft. |

El registro común mantiene sus adaptadores y controles de envío. La política de correo del negocio, identidad por conversación y referencias de WhatsApp existentes permanecen. No se reconecta una cuenta por la ausencia de credenciales en el entorno de QA.

## Alternativas evaluadas para una necesidad futura concreta

1. **API/OAuth nativos del proveedor identificado:** encaja con el ejecutor propio, cursores y aislamiento de Riverz; comprobar scopes, expiración, región, hilos y callbacks antes de fijar cobertura.
2. **Reenvío entrante:** necesita un alias por negocio, procedencia verificada y deduplicación; por sí solo no acredita autorización para responder desde el buzón original. Separar lectura de envío.
3. **IMAP + SMTP:** requiere ejecutor propio con conexiones y TLS, UIDVALIDITY/UID y recuperación de cursores, control de adjuntos, credenciales por tenant, pruebas de threading y tratamiento del resultado SMTP incierto sin reenvío ciego. No se reemplazan los adaptadores actuales ni se introduce n8n/Make.

Una ampliación se acepta con un proveedor/caso específico, lectura aislada, permiso de envío, respuesta en el hilo correcto y recuperación de fallos sin duplicación. Los costes de infraestructura y de IA se distinguen: instalar un transporte no crea por sí mismo una llamada al modelo. No hay cambio de pricing, aprovisionamiento ni prueba sobre buzones reales en esta evaluación.

Revisión de código: 2 de octubre de 2026. El despliegue de Riverz no acredita conectividad física de un buzón concreto.
