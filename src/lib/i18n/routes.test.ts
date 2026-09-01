import { describe, expect, it } from 'vitest';
import { canonicalizePath, localizePath } from './routes';

describe('localized account creation routes', () => {
  it('uses /crear in Spanish and /create in English', () => {
    expect(localizePath('/crear', 'es')).toBe('/crear');
    expect(localizePath('/crear', 'en')).toBe('/create');
    expect(localizePath('/crear?code=RIVZ', 'en')).toBe('/create?code=RIVZ');
  });

  it('keeps old signup URLs compatible', () => {
    expect(canonicalizePath('/create')).toBe('/crear');
    expect(canonicalizePath('/registro')).toBe('/crear');
    expect(canonicalizePath('/signup')).toBe('/crear');
  });
});
