# Programa de afiliados

Página pública: https://riverz.co/afiliados (inglés: /affiliates).
Administración: /admin/afiliados.

- Aprobar una solicitud habilita su enlace y envía el correo de bienvenida mediante Resend.
- El enlace conserva la atribución durante 30 días. La atribución se fija al crear una cuenta nueva y se une al workspace del propietario al contratar.
- Cada factura de suscripción cobrada genera una comisión del 35%, con 30 días de validación. La factura de Stripe tiene identificador único para evitar duplicados.
- Los reembolsos y notas de crédito se concilian con el estado actual de Stripe. El importe ya transferido se conserva y los reembolsos posteriores aparecen como importe a recuperar.
- El operador realiza el pago mensual fuera de Riverz al medio acordado con el afiliado y después lo marca pagado. Este botón registra la transferencia; no envía dinero. Antes de registrarlo se reconcilia de nuevo la factura y se comprueba que el importe mostrado siga vigente.

## Configuración

Aplicar migraciones 286, 287 y 288. Todas las tablas son privadas, con RLS y acceso exclusivo desde el servidor. Las funciones de conciliación y registro de pago solo permiten el rol de servicio.

El webhook existente /api/billing/webhook debe recibir invoice.paid, invoice.voided, charge.refunded, refund.created, refund.updated, credit_note.created, credit_note.updated y credit_note.voided. Conserva sus eventos anteriores de facturación y billetera.

Usa STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET existentes. Los correos usan RESEND_API_KEY; AFFILIATE_FROM puede especificar un remitente verificado y, si no existe, se usa AUTH_EMAIL_FROM o cuentas@riverz.co. Las solicitudes nuevas se notifican a AFFILIATE_NOTIFY_EMAIL, WAITLIST_NOTIFY_EMAIL o al correo operativo existente.

La ilustración original de esta página está en public/afiliados/hero.webp, generada con la herramienta integrada de ImageGen. Dirección visual: ilustración editorial plana de una creadora latinoamericana conectando comercios mediante referidos recurrentes; crema, carbón y chartreuse, sin texto ni logotipos.
