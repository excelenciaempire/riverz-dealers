import { describe, it, expect, afterEach } from 'vitest';
import { isPlatformAdmin } from './platform-admin';

const ENV = process.env.PLATFORM_ADMIN_EMAILS;

afterEach(() => {
  if (ENV === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = ENV;
});

describe('isPlatformAdmin', () => {
  it('lets the Riverz team in with no env set', () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(isPlatformAdmin('juandiegoriosmesa@gmail.com')).toBe(true);
    expect(isPlatformAdmin('riverzoficial@gmail.com')).toBe(true);
  });

  it('keeps the team in even when the env allowlist lists someone else', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'otro@empresa.com';
    expect(isPlatformAdmin('juandiegoriosmesa@gmail.com')).toBe(true);
    expect(isPlatformAdmin('otro@empresa.com')).toBe(true);
  });

  it('treats gmail aliases as the same mailbox', () => {
    expect(isPlatformAdmin('riverzoficial+test@gmail.com')).toBe(true);
    expect(isPlatformAdmin('JuanDiego.RiosMesa+qa@Gmail.com ')).toBe(true);
  });

  it('rejects everyone else', () => {
    expect(isPlatformAdmin('merchant@tienda.com')).toBe(false);
    // La cuenta de un comercio NO es admin de plataforma: estuvo en la lista
    // y se saco. Un inquilino no puede ver los ajustes de todos los demas.
    expect(isPlatformAdmin('pilaroficialskin@hotmail.com')).toBe(false);
    expect(isPlatformAdmin('pilaroficialskin+x@hotmail.com')).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});
