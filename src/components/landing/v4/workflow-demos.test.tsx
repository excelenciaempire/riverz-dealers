import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { landingV4 } from '@/lib/i18n/messages/landingV4';

const current = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en' }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ locale: current.locale }),
  useT: () => (key: string) => {
    const value =
      landingV4[key.replace('landingV4.', '') as keyof typeof landingV4];
    if (!value) throw new Error(`Missing translation: ${key}`);
    return value[current.locale];
  },
}));
vi.mock('@/hooks/use-format', () => ({
  useFormat: () => ({
    number: (n: number) => new Intl.NumberFormat(current.locale).format(n),
  }),
}));
import {
  ConversationDemo,
  ContextDemo,
  PermissionsDemo,
  OrderDemo,
  ResultsDemo,
} from './workflow-videos';

describe('workflow demonstrations', () => {
  for (const locale of ['es', 'en'] as const) {
    it(`renders all five readable demos on the server in ${locale}`, () => {
      current.locale = locale;
      for (const Demo of [
        ConversationDemo,
        ContextDemo,
        PermissionsDemo,
        OrderDemo,
        ResultsDemo,
      ]) {
        const html = renderToStaticMarkup(<Demo />);
        expect(html).toContain(landingV4.videoPlay[locale]);
        expect(html).not.toContain(landingV4.chatCreativeLabel[locale]);
        expect(html).toContain('preload="none"');
        expect(html).toContain('<video');
        expect(html).toContain(`-${locale}.jpg`);
        expect(html).toContain('workflow-chat-v2-');
        expect(html).not.toContain('workflow-mascot-');
        expect(html).not.toContain('workflow-ui-');
        expect(html).not.toContain('src="');
        expect(html).not.toContain('landingV4.');
        expect(html).not.toContain('opacity:0');
        expect(html).not.toContain('�');
      }
    });
  }
  it('replaces only the five workflow panels, with matching permission content', () => {
    const scene = readFileSync('src/components/landing/v4/scene.tsx', 'utf8');
    expect(scene.match(/Panel: \w+Demo/g)).toHaveLength(5);
    expect(scene).not.toContain('@/components/landing/landing');
    current.locale = 'en';
    expect(renderToStaticMarkup(<PermissionsDemo />)).toContain(
      'Sensitive actions wait for your approval.'
    );
  });
  it('limits animation to visible demos and cleans up motion on unmount', () => {
    const source = readFileSync(
      'src/components/landing/v4/workflow-videos.tsx',
      'utf8'
    );
    expect(source).toContain('prefers-reduced-motion: reduce');
    expect(source).toContain('document.hidden');
    expect(source).toContain('el.pause()');
    expect(source).toContain("removeEventListener('canplay', sync)");
    expect(source).toContain('observer.disconnect()');
    expect(source).not.toContain('Infinity');
    expect(source).not.toContain('setInterval');
  });
  it('ships all five compact clips and static poster fallbacks', () => {
    const hashes = new Set<string>();
    for (const scene of [
      'conversation',
      'context',
      'permissions',
      'order',
      'results',
    ]) {
      for (const lang of ['es', 'en']) {
        const video = readFileSync(
          `public/portada-b/workflow-chat-v2-${scene}-${lang}.mp4`
        );
        expect(video.subarray(4, 8).toString()).toBe('ftyp');
        hashes.add(createHash('sha256').update(video).digest('hex'));
        expect(video.byteLength).toBeLessThan(2_000_000);
        expect(
          readFileSync(`public/portada-b/workflow-chat-v2-${scene}-${lang}.jpg`).byteLength
        ).toBeGreaterThan(1000);
      }
    }
    expect(hashes.size).toBe(10);
  });
});
