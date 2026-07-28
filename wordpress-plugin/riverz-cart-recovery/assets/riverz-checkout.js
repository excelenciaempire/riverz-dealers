/**
 * Captura del checkout en curso.
 *
 * Escucha los campos de contacto y avisa al servidor cuando el comprador
 * deja un correo o un teléfono utilizable. A partir de ahí el carrito es
 * recuperable aunque abandone sin enviar el pedido.
 *
 * Tres decisiones que importan:
 *
 *  - El aviso sale con retraso (`DEBOUNCE`) y no en cada tecla: alguien
 *    escribiendo su correo dispararía veinte llamadas.
 *  - Nunca mandamos el carrito desde acá. El servidor lo lee de la sesión
 *    de WooCommerce; si viajara por el navegador, cualquiera podría
 *    inventar productos y precios.
 *  - No repetimos un envío idéntico. Volver a tocar un campo sin cambiar
 *    nada no genera tráfico.
 */
(function () {
  'use strict';

  if (typeof window.riverzCR === 'undefined') return;

  var DEBOUNCE = 1200;
  var timer = null;
  var lastSent = '';

  function val(selector) {
    var el = document.querySelector(selector);
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  function looksLikeEmail(v) {
    return v.indexOf('@') > 0 && v.indexOf('.') > v.indexOf('@');
  }

  function collect() {
    return {
      email: val('#billing_email'),
      phone: val('#billing_phone'),
      first_name: val('#billing_first_name'),
      last_name: val('#billing_last_name'),
      country: val('#billing_country'),
    };
  }

  function send() {
    var data = collect();

    // Un correo a medio escribir ("juan@") no sirve para contactar a
    // nadie y ensuciaría la base de contactos.
    var hasEmail = looksLikeEmail(data.email);
    // Los teléfonos varían mucho por país; nos alcanza con que haya
    // dígitos suficientes. La normalización real la hace Riverz.
    var hasPhone = data.phone.replace(/\D/g, '').length >= 8;
    if (!hasEmail && !hasPhone) return;

    var fingerprint = JSON.stringify(data);
    if (fingerprint === lastSent) return;
    lastSent = fingerprint;

    fetch(window.riverzCR.url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': window.riverzCR.nonce,
      },
      body: fingerprint,
      keepalive: true,
    }).catch(function () {
      // Un fallo de red no puede estorbar la compra. Si se pierde este
      // aviso, el siguiente cambio de campo vuelve a intentarlo.
      lastSent = '';
    });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(send, DEBOUNCE);
  }

  // Delegado en el documento: WooCommerce vuelve a dibujar el bloque del
  // checkout ante cada recálculo, así que enganchar los campos una sola
  // vez al cargar dejaría de funcionar apenas cambia el envío.
  document.addEventListener('input', function (e) {
    if (!e.target || !e.target.id) return;
    if (e.target.id.indexOf('billing_') !== 0) return;
    schedule();
  });

  document.addEventListener('change', function (e) {
    if (!e.target || !e.target.id) return;
    if (e.target.id.indexOf('billing_') !== 0) return;
    schedule();
  });

  // Último intento al irse de la página: es justo el momento del
  // abandono y suele ser la única señal que queda de esa visita.
  window.addEventListener('pagehide', function () {
    if (timer) clearTimeout(timer);
    send();
  });
})();
