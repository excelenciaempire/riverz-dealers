=== Riverz — Recuperación de carritos ===
Contributors: riverz
Tags: woocommerce, abandoned cart, whatsapp, recovery
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Avisa a Riverz cuando alguien deja el checkout a medias, para escribirle
por WhatsApp con un link que restaura su carrito.

== Description ==

WooCommerce no registra carritos abandonados. Este plugin cubre ese hueco
para las tiendas conectadas a Riverz.

Qué hace:

* Detecta el checkout abandonado apenas el comprador deja su correo o su
  teléfono, aunque nunca llegue a enviar el pedido.
* Genera un link que **restaura el carrito** y lleva directo al checkout.
* Avisa cuando la compra se concreta, para que nadie reciba un
  recordatorio después de haber comprado.

Riverz decide cuándo y cómo se envía el mensaje de recuperación: este
plugin solo aporta la señal que WooCommerce no da.

**Sobre los datos.** Al servidor de Riverz configurado por el comercio se
envían el correo, el teléfono y el nombre que el comprador escribió en el
checkout, junto con el contenido del carrito. No se envía nada de pago. El
comercio es el responsable del tratamiento y debe reflejarlo en su
política de privacidad.

== Installation ==

1. Sube la carpeta `riverz-cart-recovery` a `/wp-content/plugins/` o
   instala el ZIP desde Plugins → Añadir nuevo → Subir plugin.
2. Actívalo.
3. Ve a WooCommerce → Riverz.
4. Pega el secreto que aparece en Riverz, en Ajustes → Canales →
   WooCommerce.

Requiere que la tienda ya esté conectada a Riverz.

== Frequently Asked Questions ==

= ¿Hace falta si ya conecté la tienda a Riverz? =

Sin el plugin, Riverz recupera igual a quien apretó "realizar pedido" y no
llegó a pagar: WooCommerce deja un pedido pendiente y ese sí se ve desde
fuera. Lo que agrega el plugin es a quien abandona **antes** de enviar el
pedido, que suele ser la mayoría.

= ¿Se puede manipular el carrito desde el navegador? =

No. El carrito se lee del lado del servidor, desde la sesión de
WooCommerce. Lo que envía el navegador son solo los datos de contacto que
el propio comprador escribió.

= ¿Cuánto dura el link de recuperación? =

30 días. Después el link lleva a la tienda en lugar de dar error.

== Changelog ==

= 1.0.0 =
* Versión inicial.
