import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';

import {
  pkceOk,
  redirectPermitido,
  scopeConcedido,
  scopeInterno,
  SCOPES,
} from './oauth';

/**
 * Las tres piezas de OAuth que, mal hechas, entregan una cuenta ajena:
 * PKCE (ata el canje a quien pidió el código), la comparación de redirecciones
 * (manda el código al lugar correcto) y la traducción de alcances (que pedir
 * lectura no termine dando escritura).
 */

function challengeDe(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

describe('pkceOk', () => {
  it('acepta el verifier que generó el challenge', () => {
    const v = randomBytes(32).toString('base64url');
    expect(pkceOk(v, challengeDe(v))).toBe(true);
  });

  it('rechaza cualquier otro verifier', () => {
    const v = randomBytes(32).toString('base64url');
    const otro = randomBytes(32).toString('base64url');
    expect(pkceOk(otro, challengeDe(v))).toBe(false);
  });

  it('rechaza el challenge en plano', () => {
    // `plain` es un modo del spec que dejaría el verifier a la vista de quien
    // intercepte la ida. Acá no se acepta ni por accidente.
    const v = randomBytes(32).toString('base64url');
    expect(pkceOk(v, v)).toBe(false);
  });

  it('rechaza vacíos', () => {
    expect(pkceOk('', '')).toBe(false);
    expect(pkceOk('algo', '')).toBe(false);
    expect(pkceOk('', 'algo')).toBe(false);
  });
});

describe('redirectPermitido', () => {
  const registradas = ['https://app.ejemplo.com/cb', 'http://localhost:7777/cb'];

  it('acepta exactamente las registradas', () => {
    expect(redirectPermitido(registradas, 'https://app.ejemplo.com/cb')).toBe(true);
    expect(redirectPermitido(registradas, 'http://localhost:7777/cb')).toBe(true);
  });

  it('no acepta prefijos ni sufijos', () => {
    // Aceptar "empieza con" es exactamente cómo se roban códigos: basta con
    // registrar un dominio y redirigir a un subpath ajeno.
    expect(redirectPermitido(registradas, 'https://app.ejemplo.com/cb/otro')).toBe(false);
    expect(redirectPermitido(registradas, 'https://app.ejemplo.com')).toBe(false);
    expect(redirectPermitido(registradas, 'https://app.ejemplo.com.malo/cb')).toBe(false);
    expect(redirectPermitido(registradas, 'https://app.ejemplo.com/cb?x=1')).toBe(false);
  });

  it('sin registradas no acepta nada', () => {
    expect(redirectPermitido([], 'https://app.ejemplo.com/cb')).toBe(false);
  });
});

describe('alcances', () => {
  it('sin scope declarado se da el más chico', () => {
    // Un cliente que no dijo qué necesita, no necesita escribir.
    expect(scopeInterno(undefined)).toBe('lectura');
    expect(scopeInterno('')).toBe('lectura');
    expect(scopeInterno('mcp:read')).toBe('lectura');
  });

  it('escribir se concede sólo si se pide', () => {
    expect(scopeInterno('mcp:read mcp:write')).toBe('total');
    expect(scopeInterno('mcp:write')).toBe('total');
  });

  it('un scope inventado no abre nada', () => {
    expect(scopeInterno('admin superuser mcp:todo')).toBe('lectura');
  });

  it('la ida y la vuelta son coherentes', () => {
    expect(scopeInterno(scopeConcedido('lectura'))).toBe('lectura');
    expect(scopeInterno(scopeConcedido('total'))).toBe('total');
  });

  it('sólo se anuncian los alcances que existen', () => {
    expect([...SCOPES]).toEqual(['mcp:read', 'mcp:write', 'offline_access']);
  });
});
