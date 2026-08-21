/**
 * Riverz — cargador del chat web.
 *
 * Esto es lo único que corre en la tienda del comercio, así que hace lo mínimo:
 * pide una sesión, dibuja un botón y abre un iframe con el chat. Todo lo demás
 * —React, el hilo, el catálogo— vive del otro lado del iframe y no se descarga
 * hasta que alguien abre el chat.
 *
 * Por qué un iframe y no montar el chat acá: el tema de la tienda tiene su
 * propio CSS, sus propias variables y a veces su propio jQuery. Un chat metido
 * en ese documento se rompe en cada tienda de una forma distinta. Dentro del
 * iframe nada de eso lo toca.
 *
 * Sin dependencias, sin build: se sirve tal cual.
 */
(function () {
  'use strict';

  if (window.__riverzWidget) return;
  window.__riverzWidget = true;

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName('script');
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf('/widget/v1.js') !== -1) return all[i];
      }
      return null;
    })();
  if (!script) return;

  var KEY = script.getAttribute('data-riverz-key');
  if (!KEY) return;
  var BASE = new URL(script.src).origin;
  var STORAGE_VISITOR = 'riverz_wvid';
  var STORAGE_PROOF = 'riverz_wsig';
  var STORAGE_OPEN = 'riverz_wopen';

  /**
   * El id del visitante se guarda en el dominio de LA TIENDA, no en el del
   * iframe: Safari y los navegadores con protección de rastreo particionan el
   * almacenamiento de terceros, y ahí el hilo se perdía en cada recarga.
   */
  function storage(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
      return value;
    } catch (e) {
      return null;
    }
  }

  var state = { open: false, session: null, settings: null, unread: 0 };

  // ── Marco ──────────────────────────────────────────────────────

  var root = document.createElement('div');
  root.setAttribute('data-riverz-widget', '');
  root.style.cssText =
    'position:fixed;z-index:2147483000;bottom:0;right:0;width:0;height:0;color-scheme:light;';

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Chat');
  launcher.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'width:56px',
    'height:56px',
    'border-radius:9999px',
    'border:0',
    'cursor:pointer',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'box-shadow:0 6px 24px rgba(0,0,0,.22)',
    'transition:transform .18s ease, opacity .18s ease',
    'padding:0',
  ].join(';');

  var badge = document.createElement('span');
  badge.style.cssText = [
    'position:absolute',
    'top:-2px',
    'right:-2px',
    'min-width:20px',
    'height:20px',
    'border-radius:9999px',
    'background:#ef4444',
    'color:#fff',
    'font:600 11px/20px system-ui,-apple-system,Segoe UI,sans-serif',
    'text-align:center',
    'display:none',
  ].join(';');
  launcher.appendChild(badge);

  var frame = document.createElement('iframe');
  frame.title = 'Chat';
  frame.setAttribute('allow', 'clipboard-write');
  frame.style.cssText = [
    'position:fixed',
    'bottom:88px',
    'width:400px',
    'height:min(640px, calc(100vh - 120px))',
    'max-width:calc(100vw - 32px)',
    'border:0',
    'border-radius:16px',
    'box-shadow:0 16px 48px rgba(0,0,0,.24)',
    'background:#fff',
    'display:none',
    'opacity:0',
    'transform:translateY(8px)',
    'transition:opacity .18s ease, transform .18s ease',
  ].join(';');

  function applyPosition(side) {
    var edge = side === 'left' ? 'left' : 'right';
    var other = edge === 'left' ? 'right' : 'left';
    launcher.style[edge] = '20px';
    launcher.style[other] = 'auto';
    frame.style[edge] = '16px';
    frame.style[other] = 'auto';
  }

  function iconChat(color) {
    return (
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="' +
      color +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 21l1.9-5a8.4 8.4 0 0 1-.8-3.6 8.5 8.5 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.4 8.5z"/></svg>'
    );
  }

  function iconClose(color) {
    return (
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' +
      color +
      '" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    );
  }

  /** Negro o blanco según el color de marca, para que el ícono se lea. */
  function contrast(hex) {
    var c = (hex || '').replace('#', '');
    if (c.length !== 6) return '#111827';
    var r = parseInt(c.slice(0, 2), 16);
    var g = parseInt(c.slice(2, 4), 16);
    var b = parseInt(c.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
  }

  function renderLauncher() {
    var color = (state.settings && state.settings.primary_color) || '#A3E635';
    var ink = contrast(color);
    launcher.style.background = color;
    var icon = state.open ? iconClose(ink) : iconChat(ink);
    launcher.innerHTML = icon;
    launcher.appendChild(badge);
  }

  function setUnread(n) {
    state.unread = n || 0;
    badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
    badge.style.display = state.unread > 0 && !state.open ? 'block' : 'none';
  }

  function open() {
    if (state.open) return;
    state.open = true;
    storage(STORAGE_OPEN, '1');
    if (!frame.src) frame.src = frameUrl();
    frame.style.display = 'block';
    // Un frame en el mismo tick no anima: el navegador no llega a pintar el
    // estado inicial antes del cambio.
    requestAnimationFrame(function () {
      frame.style.opacity = '1';
      frame.style.transform = 'translateY(0)';
    });
    setUnread(0);
    renderLauncher();
    post({ type: 'riverz:opened' });
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    storage(STORAGE_OPEN, '0');
    frame.style.opacity = '0';
    frame.style.transform = 'translateY(8px)';
    setTimeout(function () {
      if (!state.open) frame.style.display = 'none';
    }, 180);
    renderLauncher();
  }

  function post(message) {
    if (frame.contentWindow) frame.contentWindow.postMessage(message, BASE);
  }

  function frameUrl() {
    // El token va en el fragmento y no en la query: el fragmento no viaja al
    // servidor, no queda en logs de acceso ni se filtra por el Referer.
    return BASE + '/widget/chat#s=' + encodeURIComponent(state.session);
  }

  launcher.addEventListener('click', function () {
    if (state.open) close();
    else open();
  });

  // ── Sesión ─────────────────────────────────────────────────────

  /**
   * Pide una sesión. Emitirla es tarea de este archivo y de ningún otro: el
   * endpoint decide contra el `Origin` de la TIENDA si la llave se está usando
   * donde corresponde, y ese origen sólo lo tiene el código que corre en la
   * página del comercio. Desde el iframe, que vive en nuestro dominio, esa
   * comprobación ya no dice nada.
   */
  function mintSession() {
    var visitorId = storage(STORAGE_VISITOR);
    return fetch(BASE + '/api/widget/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        k: KEY,
        visitorId: visitorId || undefined,
        // La prueba de que ese id es de esta persona. El id se publica —viaja
        // en el carrito hasta el pedido, para poder atribuir la venta—, así que
        // sin esto quien lo leyera pedía una sesión con él y se quedaba con la
        // conversación ajena. Esto no sale nunca del navegador.
        visitorProof: storage(STORAGE_PROOF) || undefined,
        page: { url: location.href, title: document.title },
        locale: (navigator.language || 'es').slice(0, 2),
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('session ' + r.status);
        return r.json();
      })
      .then(function (data) {
        state.session = data.sessionToken;
        state.settings = data.settings || {};
        if (data.visitorId) storage(STORAGE_VISITOR, data.visitorId);
        if (data.visitorProof) storage(STORAGE_PROOF, data.visitorProof);
        return data;
      });
  }

  function start() {
    mintSession()
      .then(function () {
        applyPosition(state.settings.position);
        renderLauncher();
        root.appendChild(launcher);
        root.appendChild(frame);
        document.body.appendChild(root);

        // Quien dejó el chat abierto y navegó a otra página lo encuentra
        // abierto: para esa persona es una conversación en curso, no un
        // panel que se cierra en cada clic.
        if (storage(STORAGE_OPEN) === '1') open();
      })
      .catch(function () {
        // El chat no está disponible (apagado, dominio no autorizado, red
        // caída). Se queda callado: un cartel de error en la tienda de
        // alguien es peor que no tener chat.
      });
  }

  // ── Carrito ────────────────────────────────────────────────────
  //
  // El chat corre en un iframe de otro dominio y desde ahí no puede tocar el
  // carrito de la tienda. Este cargador sí: corre en la página del comercio,
  // así que la API de carrito de Shopify le responde con la sesión de quien
  // está navegando. El chat pide, esto ejecuta.

  /**
   * Deja el id del visitante pegado al carrito.
   *
   * Es lo que después permite saber que ESA compra salió de ESTA conversación:
   * Shopify arrastra los atributos del carrito hasta el pedido, y el pedido
   * llega por webhook con el id adentro. Sin esto, una venta que empezó en el
   * chat y terminó media hora más tarde en el checkout es indistinguible de
   * cualquier otra.
   */
  function stampCart(extra) {
    var attrs = { riverz_origin: 'chat_web' };
    var visitorId = storage(STORAGE_VISITOR);
    if (visitorId) attrs.riverz_wvid = visitorId;
    // Los atributos que el agente puso en el enlace —el modo de pago, el
    // descuento pendiente por transferencia— viajan con el carrito hasta el
    // pedido. Pisarlos con sólo los nuestros los perdía en silencio.
    for (var k in extra || {}) attrs[k] = extra[k];
    return fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ attributes: attrs }),
    }).catch(function () {});
  }

  /**
   * Lee el enlace que arma el agente: `/cart/{id}:{qty},{id}:{qty}…?…`
   *
   * Devuelve TODAS las líneas, los `attributes[...]` y el cupón. Antes se leía
   * sólo la primera línea con una expresión anclada al principio: quien pedía
   * dos productos se llevaba uno, y el chat le decía que estaba todo bien.
   */
  function parseCart(path) {
    var partes = (path || '').split('?');
    var m = /^\/cart\/([\d:,]+)/.exec(partes[0]);
    if (!m) return null;

    var items = [];
    var pares = m[1].split(',');
    for (var i = 0; i < pares.length; i++) {
      var p = /^(\d+):(\d+)$/.exec(pares[i]);
      if (p) items.push({ id: Number(p[1]), quantity: Number(p[2]) });
    }
    if (!items.length) return null;

    var attrs = {};
    var discount = null;
    if (partes[1]) {
      var qs = new URLSearchParams(partes[1]);
      qs.forEach(function (valor, clave) {
        var a = /^attributes\[(.+)\]$/.exec(clave);
        if (a) attrs[a[1]] = valor;
        else if (clave === 'discount') discount = valor;
      });
    }
    return { items: items, attrs: attrs, discount: discount };
  }

  /** Agrega al carrito todo lo que el enlace describe. */
  function addToCart(path) {
    var carrito = parseCart(path);
    if (!carrito) return Promise.reject(new Error('bad_path'));
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ items: carrito.items }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('add ' + r.status);
        return stampCart(carrito.attrs);
      })
      .then(function () {
        // El contador del carrito del tema no se entera de un alta por API.
        // Estos son los avisos que escuchan los temas modernos; el que no
        // escucha ninguno muestra el número viejo hasta la próxima carga,
        // que es un defecto cosmético y no una venta perdida.
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:build', { bubbles: true }));
        return carrito;
      });
  }

  /**
   * Lleva al checkout de la tienda, con todo lo que la persona haya juntado
   * —lo del chat y lo que ya tuviera—, no sólo con este artículo.
   *
   * Con cupón se pasa por `/discount/CODE`, que es la única forma de aplicarlo:
   * la API de carrito no acepta códigos, así que ir derecho al checkout dejaba
   * pagando precio de lista a quien el agente le acababa de prometer un
   * descuento.
   */
  function goCheckout(carrito) {
    location.href =
      carrito && carrito.discount
        ? '/discount/' + encodeURIComponent(carrito.discount) + '?redirect=/checkout'
        : '/checkout';
  }

  // Mensajes desde el iframe.
  window.addEventListener('message', function (event) {
    if (event.origin !== BASE || !event.data || typeof event.data !== 'object') return;
    var data = event.data;
    if (data.type === 'riverz:close') close();
    else if (data.type === 'riverz:unread') setUnread(data.count);
    else if (data.type === 'riverz:ready') {
      post({ type: 'riverz:context', url: location.href });
      // Se estampa al abrir el chat y no en cada visita: quien sólo pasa por
      // la tienda no necesita que le toquemos el carrito.
      stampCart();
    } else if (data.type === 'riverz:add_to_cart') {
      addToCart(data.path).then(
        function (carrito) {
          post({ type: 'riverz:cart_result', ok: true });
          if (data.after === 'checkout') goCheckout(carrito);
        },
        function () {
          post({ type: 'riverz:cart_result', ok: false });
        },
      );
    } else if (data.type === 'riverz:go_checkout') {
      // Quien primero agregó y después decidió pagar ya tiene el producto en
      // el carrito: volver a agregarlo le cobraba dos unidades de algo que
      // pidió una sola vez. Falta sólo el cupón, que no se aplica al agregar.
      goCheckout(parseCart(data.path));
    } else if (data.type === 'riverz:resume') {
      // El token del chat caduca a las 24 h. Recargar el iframe no lo renueva:
      // el token viaja en el fragmento y el chat lo borra apenas lo lee, así
      // que la recarga volvía sin sesión y dejaba una caja de texto que no
      // mandaba nada.
      mintSession().then(
        function () {
          post({ type: 'riverz:session', token: state.session });
        },
        function () {
          post({ type: 'riverz:session', token: null });
        },
      );
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
