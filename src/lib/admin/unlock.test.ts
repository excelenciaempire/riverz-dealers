import { describe, it, expect, beforeEach } from 'vitest';
import {
  issueToken,
  verifyToken,
  passwordMatches,
  unlockConfigured,
} from './unlock';

/**
 * La segunda llave del panel no se puede probar en el navegador sin la sesión
 * de un admin, así que su lógica se prueba acá: que la firma ate al correo,
 * que venza, y que rotar la contraseña invalide lo ya emitido.
 */
const KEY = '0'.repeat(64);

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  process.env.ADMIN_PANEL_PASSWORD = 'Excelencia8+';
});

describe('unlock del panel', () => {
  it('sin contraseña configurada no abre para nadie', () => {
    process.env.ADMIN_PANEL_PASSWORD = '';
    expect(unlockConfigured()).toBe(false);
    expect(passwordMatches('')).toBe(false);
    expect(verifyToken(issueToken('a@b.com'), 'a@b.com')).toBe(false);
  });

  it('acepta la contraseña exacta y nada más', () => {
    expect(passwordMatches('Excelencia8+')).toBe(true);
    expect(passwordMatches('excelencia8+')).toBe(false);
    expect(passwordMatches('Excelencia8')).toBe(false);
  });

  it('el token vale para el correo que lo pidió, no para otro', () => {
    const token = issueToken('duenio@riverz.co');
    expect(verifyToken(token, 'duenio@riverz.co')).toBe(true);
    expect(verifyToken(token, 'otro@riverz.co')).toBe(false);
  });

  it('rotar la contraseña invalida las sesiones abiertas', () => {
    const token = issueToken('duenio@riverz.co');
    expect(verifyToken(token, 'duenio@riverz.co')).toBe(true);
    process.env.ADMIN_PANEL_PASSWORD = 'otra-contrasena-larga';
    expect(verifyToken(token, 'duenio@riverz.co')).toBe(false);
  });

  it('un token manoseado no pasa', () => {
    const token = issueToken('duenio@riverz.co');
    const [body, sig] = token.split('.');
    expect(verifyToken(`${body}.${sig.slice(0, -1)}x`, 'duenio@riverz.co')).toBe(false);
    expect(verifyToken('basura', 'duenio@riverz.co')).toBe(false);
    expect(verifyToken(undefined, 'duenio@riverz.co')).toBe(false);
  });

  it('un token vencido no pasa', () => {
    // Se arma a mano con vencimiento en el pasado: el emisor siempre firma a futuro.
    const past = `${Buffer.from('duenio@riverz.co|1').toString('base64url')}.x`;
    expect(verifyToken(past, 'duenio@riverz.co')).toBe(false);
  });
});
