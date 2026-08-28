import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  widgetKey,
  verifyWidgetKey,
  mintSession,
  verifySession,
  sessionFromRequest,
  visitorProof,
  visitorProofValid,
  VISITOR_ID_RE,
} from './token';
import { normalizeOrigin, originAllowed } from './config';
import { visitorIdFromOrder } from './attribution';

/**
 * El chat web es la única superficie de Riverz abierta a Internet sin sesión:
 * cualquiera puede llamar a sus endpoints desde cualquier parte. Lo único que
 * la sostiene son estas dos funciones —la firma del token y la lista de
 * dominios—, así que se prueban solas y a propósito.
 */

const WORKSPACE = '11111111-2222-3333-4444-555555555555';

beforeAll(() => {
  // 32 bytes en hexadecimal, como la clave real.
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

describe('llave de instalación', () => {
  it('reconoce la que emitió', () => {
    expect(verifyWidgetKey(widgetKey(WORKSPACE))).toBe(WORKSPACE);
  });

  it('rechaza una firma alterada', () => {
    const key = widgetKey(WORKSPACE);
    const tampered = key.slice(0, -1) + (key.endsWith('a') ? 'b' : 'a');
    expect(verifyWidgetKey(tampered)).toBeNull();
  });

  it('rechaza una llave inventada para otro workspace', () => {
    // El caso que importa: quien ve una llave en el HTML de una tienda conoce
    // el formato y podría probar con el id de otro comercio.
    const otro = '99999999-8888-7777-6666-555555555555';
    const sig = widgetKey(WORKSPACE).split('.')[1];
    expect(verifyWidgetKey(`${otro}.${sig}`)).toBeNull();
  });

  it('rechaza basura', () => {
    expect(verifyWidgetKey('')).toBeNull();
    expect(verifyWidgetKey('sinpunto')).toBeNull();
    expect(verifyWidgetKey('.solofirma')).toBeNull();
  });
});

describe('token de sesión', () => {
  const base = { workspaceId: WORKSPACE, visitorId: 'wv_abc', origin: 'mitienda.com' };

  it('devuelve lo que se firmó', () => {
    const session = verifySession(mintSession(base));
    expect(session?.workspaceId).toBe(WORKSPACE);
    expect(session?.visitorId).toBe('wv_abc');
    expect(session?.origin).toBe('mitienda.com');
  });

  it('no deja cambiar de workspace reescribiendo el contenido', () => {
    // Sin esto, un visitante podría leer la conversación de otro comercio
    // simplemente editando el payload, que va en claro.
    const token = mintSession(base);
    const [, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...base, workspaceId: 'otro', exp: Date.now() + 1000 }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
  });

  it('caduca', () => {
    expect(verifySession(mintSession({ ...base, exp: Date.now() - 1 }))).toBeNull();
  });

  it('la marca de prueba viaja firmada y sólo si se pidió', () => {
    // Es lo único que exime del control de dominios (`requireSession`), así que
    // tiene que salir de la firma y no del cuerpo del pedido: un visitante que
    // pudiera ponérsela usaría el chat del comercio desde cualquier sitio.
    expect(verifySession(mintSession(base))?.pr).toBeUndefined();
    expect(verifySession(mintSession({ ...base, pr: 1 }))?.pr).toBe(1);

    const token = mintSession(base);
    const [, sig] = token.split('.');
    const forjado = Buffer.from(
      JSON.stringify({ ...base, pr: 1, exp: Date.now() + 1000 }),
    ).toString('base64url');
    expect(verifySession(`${forjado}.${sig}`)).toBeNull();
  });

  it('rechaza vacío y malformado', () => {
    expect(verifySession(null)).toBeNull();
    expect(verifySession('')).toBeNull();
    expect(verifySession('no.es.un.token')).toBeNull();
  });
});

describe('normalizeOrigin', () => {
  it('lleva todas las formas de escribir un dominio a la misma', () => {
    for (const escrito of [
      'https://mitienda.com',
      'https://www.mitienda.com/',
      'MiTienda.com',
      'http://mitienda.com:80',
      'https://mitienda.com:443',
    ]) {
      expect(normalizeOrigin(escrito)).toBe('mitienda.com');
    }
  });

  it('conserva un puerto que no es el estándar', () => {
    expect(normalizeOrigin('http://localhost:3000')).toBe('localhost:3000');
  });

  it('devuelve vacío con algo que no es un dominio', () => {
    expect(normalizeOrigin('')).toBe('');
    expect(normalizeOrigin('   ')).toBe('');
  });
});

describe('originAllowed', () => {
  const domains = ['mitienda.com'];

  it('acepta el dominio y sus subdominios', () => {
    expect(originAllowed('https://mitienda.com', domains)).toBe(true);
    expect(originAllowed('https://www.mitienda.com', domains)).toBe(true);
    expect(originAllowed('https://tienda.mitienda.com', domains)).toBe(true);
  });

  it('rechaza un dominio que sólo TERMINA parecido', () => {
    // El error clásico de comparar por sufijo: "otramitienda.com" termina en
    // "mitienda.com" y pasaría el filtro.
    expect(originAllowed('https://otramitienda.com', domains)).toBe(false);
    expect(originAllowed('https://mitienda.com.attacker.net', domains)).toBe(false);
  });

  it('rechaza cuando no hay dominios cargados', () => {
    expect(originAllowed('https://mitienda.com', [])).toBe(false);
    expect(originAllowed('https://mitienda.com', undefined)).toBe(false);
  });

  it('rechaza un origen vacío', () => {
    // Un request sin cabecera Origin no puede pasar como si fuera de la casa.
    expect(originAllowed('', domains)).toBe(false);
  });

  it('deja pasar la máquina local en desarrollo, con puerto o sin él', () => {
    // Las cuatro formas en que alguien levanta su tienda para probar. Con el
    // puerto pegado al host, comparar el string entero dejaba pasar
    // `localhost:3000` y bloqueaba `127.0.0.1:3000`.
    for (const local of [
      'http://localhost:3000',
      'http://localhost',
      'http://127.0.0.1:8080',
      'http://127.0.0.1',
    ]) {
      expect(originAllowed(local, [])).toBe(true);
    }
  });

  it('en PRODUCCIÓN la máquina local no pasa', () => {
    // Pasaba siempre, y eso anulaba la lista entera: la llave de instalación
    // está a la vista en el HTML de cualquier tienda, así que bastaba pedir la
    // sesión con `Origin: http://localhost` desde cualquier parte para
    // conseguir un token bueno del comercio ajeno.
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(originAllowed('http://localhost:3000', [])).toBe(false);
      expect(originAllowed('http://127.0.0.1', domains)).toBe(false);
      // Lo que SÍ está en la lista sigue entrando.
      expect(originAllowed('https://mitienda.com', domains)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('no confunde un dominio que EMPIEZA con localhost', () => {
    expect(originAllowed('https://localhost.ladron.net', [])).toBe(false);
    expect(originAllowed('https://127.0.0.1.ladron.net', [])).toBe(false);
  });
});

describe('prueba de visitante', () => {
  // El id se publica a propósito —viaja en los atributos del carrito hasta el
  // pedido, para poder atribuir la venta— así que aceptarlo pelado entregaba la
  // conversación de esa persona a cualquiera que lo leyera.
  const visitante = 'wv_73f8d901-a0d2-4a95-9bcc-4aaceb96e7d3';

  it('reconoce la prueba que emitió', () => {
    expect(visitorProofValid(WORKSPACE, visitante, visitorProof(WORKSPACE, visitante))).toBe(true);
  });

  it('no vale sin prueba, ni con una inventada', () => {
    expect(visitorProofValid(WORKSPACE, visitante, '')).toBe(false);
    expect(visitorProofValid(WORKSPACE, visitante, null)).toBe(false);
    expect(visitorProofValid(WORKSPACE, visitante, 'x'.repeat(32))).toBe(false);
  });

  it('la de OTRO visitante no sirve para éste', () => {
    const otro = 'wv_00000000-1111-2222-3333-444444444444';
    expect(visitorProofValid(WORKSPACE, visitante, visitorProof(WORKSPACE, otro))).toBe(false);
  });

  it('la de otro comercio tampoco', () => {
    const otroWs = '99999999-8888-7777-6666-555555555555';
    expect(visitorProofValid(WORKSPACE, visitante, visitorProof(otroWs, visitante))).toBe(false);
  });

  it('sólo acepta la forma que emitimos', () => {
    expect(VISITOR_ID_RE.test(visitante)).toBe(true);
    // Antes alcanzaba con `[0-9a-f-]{36}`, que da por bueno un id de 36 guiones
    // — y un id canónico y compartible es justo lo que no hay que regalar.
    expect(VISITOR_ID_RE.test(`wv_${'-'.repeat(36)}`)).toBe(false);
    expect(VISITOR_ID_RE.test('wv_no-es-un-uuid')).toBe(false);
  });
});

describe('token por query', () => {
  const pedido = (url: string, headers: Record<string, string> = {}) =>
    new Request(url, { headers });

  it('la cabecera sigue siendo el camino normal', () => {
    const t = mintSession({ workspaceId: WORKSPACE, visitorId: 'wv_x', origin: 'mitienda.com' });
    const s = sessionFromRequest(pedido('https://riverz.co/api/widget/messages', {
      authorization: `Bearer ${t}`,
    }));
    expect(s?.workspaceId).toBe(WORKSPACE);
  });

  it('acepta `?t=` sólo donde se habilita', () => {
    // Un `<img>` no manda cabeceras: exigiéndolas, cada foto que mandaba el
    // comercio se veía como un cuadro roto. Escribir sigue pidiendo la
    // cabecera, que no queda en el historial ni en el `Referer`.
    const t = mintSession({ workspaceId: WORKSPACE, visitorId: 'wv_x', origin: 'mitienda.com' });
    const req = pedido(`https://riverz.co/api/widget/media/a/b/c.jpg?t=${encodeURIComponent(t)}`);
    expect(sessionFromRequest(req)).toBeNull();
    expect(sessionFromRequest(req, { permitirQuery: true })?.workspaceId).toBe(WORKSPACE);
  });

  it('un `?t=` fabricado no entra ni con el permiso puesto', () => {
    const req = pedido('https://riverz.co/api/widget/media/a/b/c.jpg?t=basura.firma');
    expect(sessionFromRequest(req, { permitirQuery: true })).toBeNull();
  });
});

describe('visitorIdFromOrder', () => {
  const visitante = 'wv_73f8d901-a0d2-4a95-9bcc-4aaceb96e7d3';
  const conAtributos = (attrs: Array<{ name: string; value: string }>) => ({
    note_attributes: attrs,
  });

  it('encuentra el id que viajó pegado al carrito', () => {
    expect(
      visitorIdFromOrder(
        conAtributos([
          { name: 'riverz_origin', value: 'chat_web' },
          { name: 'riverz_wvid', value: visitante },
        ]),
      ),
    ).toBe(visitante);
  });

  it('devuelve null en un pedido normal', () => {
    expect(visitorIdFromOrder({})).toBeNull();
    expect(visitorIdFromOrder(conAtributos([]))).toBeNull();
    expect(visitorIdFromOrder(conAtributos([{ name: 'gift_note', value: 'hola' }]))).toBeNull();
  });

  it('ignora un valor con otra forma', () => {
    // El atributo lo puede escribir cualquiera que edite el carrito en su
    // navegador, y termina siendo el `external_id` de un contacto: sólo se
    // acepta exactamente el formato que emitimos.
    for (const basura of ['', '   ', 'wv_no-es-un-uuid', "'; drop table contacts;--", visitante + 'x']) {
      expect(visitorIdFromOrder(conAtributos([{ name: 'riverz_wvid', value: basura }]))).toBeNull();
    }
  });

  it('no se rompe si Shopify manda note_attributes con otra forma', () => {
    expect(visitorIdFromOrder({ note_attributes: 'nada' })).toBeNull();
    expect(visitorIdFromOrder({ note_attributes: null })).toBeNull();
    expect(visitorIdFromOrder({ note_attributes: [null, undefined] as never })).toBeNull();
  });
});
