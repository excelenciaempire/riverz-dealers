# Ficha técnica de seguridad / Technical security brief

Material privado para evaluación comercial y técnica, 2 de octubre de 2026. No modifica términos, políticas públicas, acceso de clientes ni configuración de proveedores. No es una certificación ni un acuerdo de tratamiento firmado.

## Español

Riverz reúne atención y operación en un superasistente preparado para cada negocio, con controles manuales y aprobación de acciones sensibles. Los módulos actuales se conservan. Los motores de automatización, Flujos y tareas son personalizados; no dependen de n8n o Make.

| Pregunta | Respuesta técnica y evidencia |
| --- | --- |
| ¿Cómo se separan los negocios? | Membresía, roles y acceso actual determinan el alcance. Las funciones nuevas comprueban negocio, conversación, contacto y conexión coherentes. Los reportes obtienen primero identificadores autorizados y vuelven a comprobar el alcance antes de devolver datos. [Autoridad de reportes](dashboard-case-authority.md). |
| ¿Puede otro miembro ver un correo personal? | Gmail, Outlook y Zoho conservan acceso ligado al actor que conectó el buzón; ser administrador o dueño del negocio no sustituye esa propiedad. [Implementación](../src/lib/inbox/access.ts). |
| ¿Dónde se guardan credenciales? | Las integraciones nuevas guardan tokens/secretos cifrados con el servicio del servidor; las nuevas escrituras usan AES-256-GCM con IV aleatorio y autenticación. El formato legado tiene lectura compatible: no se afirma que todas las filas históricas hayan sido recifradas. [Cifrado](../src/lib/whatsapp/encryption.ts), [Drive](drive-document-sources.md). |
| ¿Qué puede ejecutar la IA? | Herramientas y permisos del negocio actual, con restricciones por canal y aprobaciones compartidas. Una propuesta, autorización y ejecución son estados distintos. Un resultado incierto de dinero o escritura sensible no se transforma en éxito ni se repite automáticamente. [Matriz de aceptación](commslayer-acceptance-matrix.md). |
| ¿Cómo se usan documentos? | Texto extraído, revisable y versionado; una importación fallida no equivale a entrenamiento. Drive usa selección explícita y revisión de permisos; texto nuevo requiere activación humana. La revocación afecta lecturas posteriores, sin cancelar retroactivamente una llamada de modelo iniciada. [Contrato documental](drive-document-sources.md). |

### Evidencia, exportaciones y avisos

Los comprobantes distinguen herramienta intentada, respuesta observada y resultado comercial. La evaluación humana de una regla no se presenta como causalidad. Monedas y denominadores permanecen separados; datos ausentes no son ceros. Las nuevas exportaciones de agregados omiten cuerpos de mensajes, nombres, teléfonos y correos; esta afirmación no redefine la exportación autorizada de una conversación.

Las notas internas se separan del transporte al cliente. Los avisos de dispositivo son voluntarios y usan texto neutro en la pantalla bloqueada. Abrir un aviso exige sesión y permiso actuales; recibirlo no autoriza un pago. [Push y privacidad](browser-push-notices.md).

### Disponibilidad y aceptación

El código y esquemas centrales se publicaron en Render y Supabase, con pruebas registradas por incremento. La UI nueva permanece oculta hasta la comparación acordada. Las compilaciones, pruebas aisladas y salud no certifican funcionamiento universal de proveedores, recepción física o capacidad bajo cualquier carga. [Ejecución](ejecucion-plan-commslayer.md), [preparación de proveedores](commslayer-provider-readiness.md), [QA visual](commslayer-comparison-qa.json).

La página pública de privacidad ya existe en ES/EN. Su fuente conserva una revisión legal pendiente para transferencias internacionales, RGPD y CCPA; esta ficha no afirma cumplimiento, firma un DPA ni elimina ese requisito. No existe aquí evidencia para anunciar SOC 2, ISO 27001, residencia específica de datos, disponibilidad contractual o un período global de retención. Esos compromisos requieren información del proveedor, entidad contractual y proceso correspondiente. [Fuente de privacidad](../src/app/privacidad/page.tsx).

## English

Riverz combines customer service and operations through an assistant configured for each business, with manual controls and approval for sensitive actions. Existing modules remain available. Automation, Flows and scheduled work use Riverz's custom services, without n8n or Make dependencies.

| Question | Technical response and evidence |
| --- | --- |
| How are businesses isolated? | Current membership, role and access determine scope. New functions check business, conversation, contact and connection consistency. Reports first obtain authorized case IDs and recheck scope before returning data. [Report authority](dashboard-case-authority.md). |
| Can another member access a personal mailbox? | Gmail, Outlook and Zoho remain tied to the connecting actor; administrator or business-owner status does not replace mailbox ownership. [Implementation](../src/lib/inbox/access.ts). |
| How are credentials stored? | New integrations encrypt tokens/secrets server-side. New writes use authenticated AES-256-GCM with random IVs. Legacy ciphertext remains readable; this does not claim every historical row was re-encrypted. [Encryption](../src/lib/whatsapp/encryption.ts), [Drive](drive-document-sources.md). |
| What can AI execute? | Current business tools and permissions, channel restrictions and shared approvals. Proposal, authorization and execution are separate states. Uncertain sensitive writes or money operations are neither reported as success nor automatically replayed. [Acceptance matrix](commslayer-acceptance-matrix.md). |
| How are documents used? | Extracted text is reviewable and versioned; failed import is not successful training. Drive uses explicit selection and permission checks; new text needs human activation. Revocation applies to subsequent context reads without retroactively cancelling an already-started model call. [Document contract](drive-document-sources.md). |

### Evidence, exports and notices

Receipts separate attempted tools, observed responses and business outcomes. Human rule assessments do not establish causality. Currency and sample denominators stay explicit; missing data is not zero. New aggregate exports omit message bodies, names, phones and emails, without redefining authorized conversation exports.

Internal notes are separated from customer transport. Device notices are opt-in and use neutral lock-screen text. Opening a notice requires a current session and case access; receiving it does not authorize money movement. [Push privacy](browser-push-notices.md).

### Availability and acceptance

Core code and schemas were published through Render and Supabase with recorded incremental checks. New UI remains hidden until the agreed comparison. Builds, isolated tests and health checks do not certify universal provider support, physical delivery or arbitrary load capacity. [Execution](ejecucion-plan-commslayer.md), [provider readiness](commslayer-provider-readiness.md), [visual QA](commslayer-comparison-qa.json).

Public privacy pages already exist in Spanish and English. Their source retains a legal-review requirement for international transfers, GDPR and CCPA. This technical brief does not claim compliance, execute a DPA or remove that requirement. It supplies no evidence to advertise SOC 2, ISO 27001, specific data residency, contractual availability or a global retention period. Such commitments require provider evidence, the contracting entity and the corresponding process. [Privacy source](../src/app/privacidad/page.tsx).
