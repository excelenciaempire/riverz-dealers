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

  // La llave, del atributo o de la propia URL.
  //
  // El atributo es lo que se pega a mano. La query hace falta para la
  // instalación automática en Shopify: un ScriptTag sólo deja poner un `src`,
  // no atributos, así que sin esto el widget instalado por la app no arrancaba
  // nunca — y ese es justo el camino donde el comercio no toca código.
  var src = new URL(script.src);
  var KEY = script.getAttribute('data-riverz-key') || src.searchParams.get('k');
  if (!KEY) return;
  var BASE = src.origin;
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

  // `ready` = el iframe ya cargó nuestro origen y puede recibir mensajes.
  var state = {
    open: false,
    session: null,
    settings: null,
    unread: 0,
    ready: false,
    // La invitación sale UNA vez por visita, gane el disparador que gane.
    invitado: false,
  };

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

  /**
   * La burbuja de invitación. Vive al lado del lanzador y no dentro del
   * iframe: el iframe no se descarga hasta que alguien abre el chat, y el
   * sentido de esto es justamente hablarle a quien todavía no lo abrió.
   */
  var teaser = document.createElement('button');
  teaser.type = 'button';
  teaser.style.cssText = [
    'position:fixed',
    'bottom:88px',
    'max-width:260px',
    'border:0',
    'cursor:pointer',
    'text-align:left',
    'padding:12px 14px',
    'border-radius:16px',
    'background:#fff',
    'color:#111827',
    'font:400 13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif',
    'box-shadow:0 10px 32px rgba(0,0,0,.18)',
    'display:none',
    'opacity:0',
    'transform:translateY(6px)',
    'transition:opacity .18s ease, transform .18s ease',
  ].join(';');

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
    teaser.style[edge] = '20px';
    teaser.style[other] = 'auto';
  }

  /**
   * En un teléfono el chat ocupa la pantalla entera.
   *
   * Antes eran dos recortes —`max-width:calc(100vw - 32px)` y una altura
   * máxima— y con eso el panel quedaba flotando sobre la tienda con el
   * lanzador tapándole la esquina, la caja de escribir a 88 px del borde y el
   * pulgar del lado equivocado. En un teléfono un chat abierto no es un panel:
   * es la pantalla.
   *
   * Se hace con `matchMedia` y no con una hoja de estilos porque todo lo del
   * cargador va en estilos en línea —para que el tema de la tienda no lo
   * toque— y una regla de hoja no le gana a un estilo en línea sin
   * `!important`, que es peor de mantener.
   *
   * El teclado: en móvil el navegador encoge el viewport visual al abrirlo, y
   * un `height:100%` deja la caja de escribir debajo del teclado. Por eso la
   * altura sigue a `visualViewport` cuando existe.
   */
  var movil = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;

  function esMovil() {
    return Boolean(movil && movil.matches);
  }

  function aplicarTamano() {
    if (esMovil()) {
      var alto =
        window.visualViewport && window.visualViewport.height
          ? window.visualViewport.height + 'px'
          : '100%';
      frame.style.top = '0';
      frame.style.left = '0';
      frame.style.right = '0';
      frame.style.bottom = 'auto';
      frame.style.width = '100%';
      frame.style.maxWidth = 'none';
      frame.style.height = alto;
      frame.style.borderRadius = '0';
      frame.style.transform = state.open ? 'translateY(0)' : 'translateY(8px)';
      // Con el chat abierto el lanzador sólo estorba: el chat ya tiene su
      // propia cruz para cerrar.
      launcher.style.display = state.open ? 'none' : 'flex';
      return;
    }
    frame.style.top = 'auto';
    frame.style.bottom = '88px';
    frame.style.width = '400px';
    frame.style.maxWidth = 'calc(100vw - 32px)';
    frame.style.height = 'min(640px, calc(100vh - 120px))';
    frame.style.borderRadius = '16px';
    launcher.style.display = 'flex';
    applyPosition(state.settings && state.settings.position);
  }

  if (movil) {
    // `addListener` es lo único que entiende Safari viejo, y este archivo corre
    // en la tienda de otro: no se puede elegir el navegador del cliente.
    if (movil.addEventListener) movil.addEventListener('change', aplicarTamano);
    else if (movil.addListener) movil.addListener(aplicarTamano);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', function () {
      if (esMovil() && state.open) aplicarTamano();
    });
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
    state.invitado = true;
    ocultarTeaser();
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
    aplicarTamano();
    // Puede caer en el vacío: la primera vez el iframe todavía está en
    // `about:blank` —que hereda el origen de la TIENDA— y el navegador descarta
    // el mensaje porque el destino no coincide con el nuestro. Por eso el
    // estado se vuelve a mandar cuando el chat avisa que está listo.
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
    aplicarTamano();
    // El chat necesita saberlo para poder contar lo que llega mientras nadie
    // mira, que es de lo que se trata la burbuja del lanzador.
    post({ type: 'riverz:closed' });
  }

  function post(message) {
    // Sólo cuando el chat ya avisó que está en NUESTRO origen. Antes de eso el
    // iframe sigue en `about:blank`, que hereda el origen de la tienda: el
    // navegador descarta el mensaje y deja un aviso en la consola del comercio.
    // Lo que haya que decirle se le vuelve a decir al recibir `riverz:ready`.
    if (state.ready && frame.contentWindow) frame.contentWindow.postMessage(message, BASE);
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

  // Tocar la invitación abre el chat. Es el único botón que tiene: cerrarla
  // sin abrir se hace tocando el lanzador, que es lo que la persona ya sabe
  // hacer, y una cruz más en una burbuja de dos renglones es ruido.
  teaser.addEventListener('click', function () {
    ocultarTeaser();
    open();
  });

  // ── Sesión ─────────────────────────────────────────────────────

  /**
   * Pide una sesión. Emitirla es tarea de este archivo y de ningún otro: el
   * endpoint decide contra el `Origin` de la TIENDA si la llave se está usando
   * donde corresponde, y ese origen sólo lo tiene el código que corre en la
   * página del comercio. Desde el iframe, que vive en nuestro dominio, esa
   * comprobación ya no dice nada.
   */
  /** Una cookie de la tienda, o vacío. */
  function cookie(nombre) {
    var m = new RegExp('(?:^|;\\s*)' + nombre + '=([^;]*)').exec(document.cookie || '');
    return m ? decodeURIComponent(m[1]) : '';
  }

  /**
   * Lo que Meta necesita para saber que esta venta salió de su anuncio.
   *
   * `_fbp` identifica al navegador y `_fbc` al clic en el anuncio. Sin ellos el
   * evento de compra llega y no matchea con nadie: la venta se cuenta como
   * orgánica y la campaña que la trajo se ve peor de lo que fue.
   *
   * Si la persona acaba de llegar de un anuncio, el `fbclid` está en la URL
   * pero el píxel todavía puede no haber escrito `_fbc`. En ese caso se arma
   * con el formato que Meta documenta. Lo que NO se hace nunca es inventar uno
   * cuando no hubo clic: un `fbc` falso le atribuye la venta a un anuncio que
   * nadie vio.
   */
  function senalesDeMarketing() {
    var fbc = cookie('_fbc');
    if (!fbc) {
      var m = /[?&]fbclid=([^&#]+)/.exec(location.search || '');
      if (m) fbc = 'fb.1.' + Date.now() + '.' + decodeURIComponent(m[1]);
    }
    var out = {};
    var fbp = cookie('_fbp');
    if (fbp) out.fbp = fbp;
    if (fbc) out.fbc = fbc;
    out.url = location.href;
    return out;
  }

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
        // El idioma del navegador. Es el desempate cuando el comercio no fijó
        // el idioma de su agente; la página en la que está parada la persona
        // viaja aparte, con cada mensaje, porque cambia mientras navega.
        locale: (navigator.language || 'es').slice(0, 2),
        // Las señales que le permiten a Meta atribuir la venta a un anuncio.
        // Se leen ACÁ y en ningún otro lado: son cookies de la tienda, y el
        // iframe del chat vive en otro dominio, así que desde adentro no se ven.
        marketing: senalesDeMarketing(),
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

  /**
   * Abrir el chat solo, si el comercio lo pidió.
   *
   * Una vez por visita y sólo si la persona no lo cerró antes: un chat que se
   * abre de nuevo cada vez que uno lo cierra no es una invitación, es un
   * pop-up. Lo cerrado se recuerda en el dominio de la tienda, igual que el
   * hilo.
   */
  /**
   * ¿Vale la pena invitar en ESTA página?
   *
   * Con la lista vacía, en todas. Con algo cargado, sólo donde la dirección lo
   * contiene: un comercio que quiere salir a buscar en las fichas de producto
   * no quiere hacerlo en el checkout, donde interrumpir cuesta la venta que ya
   * tenía.
   */
  function paginaInvitable() {
    var urls = (state.settings && state.settings.proactive_urls) || [];
    if (!urls.length) return true;
    var aqui = location.pathname + location.search;
    for (var i = 0; i < urls.length; i++) {
      if (aqui.indexOf(urls[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * La invitación.
   *
   * Con texto, una burbuja al lado del lanzador; sin texto, el panel se abre
   * como antes. La burbuja existe porque abrir el panel de golpe tapa justo la
   * ficha que la persona estaba leyendo: es la diferencia entre invitar y
   * hacer un pop-up. Se muestra UNA vez por visita, nunca si la persona ya
   * cerró el chat a mano, y desaparece apenas lo abre.
   */
  function invitar() {
    if (state.invitado || state.open) return;
    if (storage(STORAGE_OPEN) === '0') return;
    if (!paginaInvitable()) return;
    state.invitado = true;
    var texto = (state.settings && state.settings.proactive_message) || '';
    if (!texto) {
      open();
      return;
    }
    teaser.textContent = texto;
    teaser.style.display = 'block';
    requestAnimationFrame(function () {
      teaser.style.opacity = '1';
      teaser.style.transform = 'translateY(0)';
    });
  }

  function ocultarTeaser() {
    teaser.style.opacity = '0';
    teaser.style.transform = 'translateY(6px)';
    setTimeout(function () {
      teaser.style.display = 'none';
    }, 180);
  }

  /**
   * Cuándo sale a buscar: por tiempo, por intención de salir, o por cuánto
   * leyó de la página. Los tres apuntan al mismo lugar y el primero que llega
   * gana — `invitar()` sólo actúa una vez.
   */
  function autoAbrir() {
    var s = state.settings || {};
    var seg = Number(s.auto_open_seconds || 0);
    if (seg >= 1) {
      setTimeout(invitar, seg * 1000);
    }

    // Intención de salir: el puntero cruza el borde superior de la ventana.
    // Sólo con mouse — en un teléfono ese gesto no existe y el evento lo
    // disparan cosas que no son irse.
    if (s.proactive_on_exit && !esMovil()) {
      document.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget && e.clientY <= 0) invitar();
      });
    }

    var tope = Number(s.proactive_scroll_percent || 0);
    if (tope >= 10) {
      var mirando = false;
      window.addEventListener(
        'scroll',
        function () {
          if (mirando || state.invitado) return;
          mirando = true;
          requestAnimationFrame(function () {
            mirando = false;
            var alto = document.documentElement.scrollHeight - window.innerHeight;
            if (alto <= 0) return;
            if (((window.scrollY || 0) / alto) * 100 >= tope) invitar();
          });
        },
        { passive: true },
      );
    }
  }

  function start() {
    mintSession()
      .then(function () {
        applyPosition(state.settings.position);
        aplicarTamano();
        renderLauncher();
        autoAbrir();
        root.appendChild(teaser);
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
  window.addEventListener('message', function (event) {
    if (event.origin !== BASE || !event.data || typeof event.data !== 'object') return;
    var data = event.data;
    if (data.type === 'riverz:close') close();
    else if (data.type === 'riverz:unread') setUnread(data.count);
    else if (data.type === 'riverz:ready') {
      state.ready = true;
      // La URL sirve para dos cosas distintas: autorizar los botones de compra
      // (el chat compara este origen contra el que ve el navegador) y contarle
      // al agente qué está mirando la persona. El título va con ella porque en
      // una tienda es el nombre del producto, que es lo único de esto que un
      // modelo puede usar tal cual.
      post({ type: 'riverz:context', url: location.href, title: document.title });
      // El estado real de la ventana, ahora que el iframe ya está en nuestro
      // origen y puede recibirlo. El `riverz:opened` de la primera apertura se
      // pierde siempre; sin esto, el chat nunca se entera de que está abierto y
      // le cuenta como no leído al visitante lo que está mirando.
      post({ type: state.open ? 'riverz:opened' : 'riverz:closed' });
      // Se estampa al abrir el chat y no en cada visita: quien sólo pasa por
      // la tienda no necesita que le toquemos el carrito.

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
