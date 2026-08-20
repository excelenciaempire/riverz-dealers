import { describe, it, expect, beforeAll } from 'vitest';
import { widgetKey, verifyWidgetKey, mintSession, verifySession } from './token';
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

  it('deja pasar localhost para poder probar la instalación', () => {
    expect(originAllowed('http://localhost:3000', [])).toBe(true);
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
