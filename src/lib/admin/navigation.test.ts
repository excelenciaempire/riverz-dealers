import { describe, expect, it } from 'vitest';
import { sectionRedirect } from './feature-flags';
import { canAccessSection, sanitizeSections } from '@/lib/rbac/sections';
import { canonicalizePath } from '@/lib/i18n/routes';

describe('workspace navigation follows admin settings and member permissions together', () => {
  it('falls back to settings when the only granted feature is disabled, without bouncing', () => {
    const grants = ['/voz'];
    const flags = { voice: false };
    expect(sectionRedirect('/voz', grants, flags, false)).toBe('/ajustes');
    expect(sectionRedirect('/panel', grants, flags, false)).toBe('/ajustes');
    expect(sectionRedirect('/ajustes', grants, flags, false)).toBeNull();
  });
  it('chooses the next enabled granted section', () => {
    expect(sectionRedirect('/voz', ['/voz', '/bandeja'], { voice: false }, false)).toBe('/bandeja');
  });
  it('keeps the platform admin exception for ordinary features', () => {
    expect(sectionRedirect('/voz', null, { voice: false }, true)).toBeNull();
  });
  it('honors the operator switch even for platform admins', () => {
    expect(sectionRedirect('/chat', null, { riverz_2: false }, true)).toBe('/panel');
    expect(sectionRedirect('/chat', ['/chat'], { riverz_2: false }, false)).toBe('/ajustes');
    expect(sectionRedirect('/chat-web', null, { riverz_2: false }, false)).toBeNull();
  });
  it('restricts Comments AI in both languages, including child routes', () => {
    expect(sanitizeSections(['/comentarios'])).toEqual(['/comentarios']);
    for (const path of ['/comentarios', '/comments', '/comments/rules']) {
      expect(canAccessSection(['/bandeja'], canonicalizePath(path))).toBe(false);
      expect(canAccessSection(['/comentarios'], canonicalizePath(path))).toBe(true);
    }
  });
});
