# Guía de Revitaly por correo

El comprador recibe un correo desde la casilla de Revitaly con el enlace al PDF gratuito cuando Shopify confirma el pago. No interviene la IA ni se usa WhatsApp; este envío no consume créditos de Riverz.

- Cuenta: Revitaly (`234604a9-909b-4e50-952b-acde4a85593a`).
- Correo: `revitalysoporteargentino@gmail.com`.
- Tienda: `tkjiax-hc.myshopify.com`.
- Shampoo: producto `9205987573891`.
- Guía incluida: producto `9241350406275`.
- El pedido debe conservar la guía y al menos 3 botellas del shampoo. Los packs revisados de 6 y 12 meses contienen 3 y 10 botellas, respectivamente.
- Solo compras creadas desde la activación. No se envía a compras anteriores, pedidos de prueba, cancelados, reembolsados ni pagos pendientes.
- Se usa el correo del pedido, sin exigir teléfono. Si falta, el envío espera a que se complete; no se cambia a WhatsApp.

El trabajo `post-purchase-guides` revisa las actualizaciones de Shopify cada cinco minutos y vuelve a comprobar el pedido antes del envío. La tabla `post_purchase_guides` guarda la configuración y el punto de lectura; `post_purchase_guide_deliveries` conserva una única entrega por guía y pedido. Ambas tablas están restringidas al servidor con RLS y permisos de servicio.

La aceptación de Gmail se guarda con su identificador. Cada entrega lleva una cabecera `X-Riverz-Guide-Delivery` estable, comprobada en un envío real. Si se interrumpe una respuesta, se consulta Enviados por destinatario y asunto y se verifica esa cabecera; no se depende del Message-ID, que Gmail reemplaza. Los rechazos explícitos por acceso o cuota pueden reintentarse hasta cinco veces; una respuesta ambigua queda para conciliación y nunca dispara un reenvío automático. Los fallos aparecen en el registro del trabajo y en la entrega.

Requiere la migración `336_post_purchase_guides.sql`, una conexión Gmail del mismo workspace y las credenciales Google ya usadas por el correo conectado. Se aplica con `node --env-file=.env.local scripts/apply-post-purchase-guides-schema.mjs`. Sin esa migración, el trabajo permanece deshabilitado y no envía correos. La guía permanece alojada en Shopify; el mensaje contiene su enlace, sin adjuntar ni modificar el documento.

## Consultas desde correo a WhatsApp

El cierre del correo de la guía dice «Si tienes alguna duda, escríbenos por WhatsApp» y usa `{{whatsapp_url}}`. El enlace abre el número conectado a Riverz, con un mensaje preparado y una referencia opaca. La misma referencia se incorpora a las derivaciones de correo hacia WhatsApp enviadas desde la bandeja o por la IA de Revitaly, incluyendo mensajes con adjuntos. La preparación ocurre antes de guardar el texto y vuelve a verificarse en el adaptador; no cambia el destino de otros comercios.

La migración `338_email_whatsapp_referrals.sql` separa los enlaces y sus clics (`email_whatsapp_links`) de los mensajes recibidos (`email_whatsapp_inquiries`). La fuente se verifica contra el workspace, la línea de WhatsApp y el mensaje entrante persistido. El registro es único por mensaje; para medir conversaciones procedentes de correo se cuenta `distinct conversation_id`, no clics ni mensajes. Los clics pueden incluir escáneres de correo y no representan personas ni consultas.

La bandeja muestra «Desde correo» y distingue «Guía de compra» de «Consulta derivada a WhatsApp». Para la guía conserva el pedido de referencia. La IA recibe ese contexto, pero el enlace no demuestra la identidad del remitente ni la titularidad del pedido: puede reenviarse y las operaciones privadas siguen exigiendo verificar los datos del cliente. No se fusionan contactos por este enlace.

La atribución requiere enviar el mensaje con la referencia preparada. Si el cliente la elimina, no se atribuye su consulta al correo. Los ecos salientes y la importación de historia no se cuentan. No se vuelven a enviar guías anteriores. El envío inicial de la guía sigue sin consumir créditos; una conversación de IA posterior en WhatsApp sigue las condiciones habituales del workspace.
