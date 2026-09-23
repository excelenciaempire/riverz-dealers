import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const source = readFileSync(
  resolve('src/components/landing/v4/cards.tsx'),
  'utf8'
);

describe('reviewed landing media', () => {
  it('uses one lightweight editorial banner and keeps the navigation free of CTAs', async () => {
    const hero = readFileSync(resolve('src/components/landing/v4/landing-v4.tsx'), 'utf8');
    expect(hero.match(/src="\/portada-b\/hero-agents-brand.webp"/g)).toHaveLength(1);
    expect(hero).not.toContain('hero-mascot');
    expect(hero.split('function Nav()')[1].split('function Hero()')[0]).not.toContain('href="#acceso"');
    expect(hero).not.toContain('/portada-b/hero.jpg');
    expect(hero).toContain('sn-display sn-hero-title');
    expect(hero).toContain('fetchPriority="high"');
    const asset = resolve('public/portada-b/hero-agents-brand.webp');
    const meta = await sharp(asset).metadata();
    expect(meta.width).toBe(1792);
    expect(meta.height).toBe(1024);
    expect(statSync(asset).size).toBeLessThan(100_000);
  });

  it('retains thirteen cards and five animated sections', () => {
    expect(source.match(/key: 'sec/g)).toHaveLength(13);
    expect(source.match(/animation: '\/portada-b\//g)).toHaveLength(5);
    expect(source).toContain('/portada-b/i-campanas.webp');
    expect(source).toContain('/portada-b/i-roas.webp');
  });

  it('uses the original animated artwork in all five animated cards', async () => {
    for (const name of ['vendedor', 'carritos', 'campanas', 'minutos', 'roas']) {
      expect(source).toContain(`img: '/portada-b/i-${name}.jpg'`);
      expect(source).toContain(`animation: '/portada-b/i-${name}.webp'`);
      const path = resolve(`public/portada-b/i-${name}.webp`);
      expect(statSync(path).size).toBeGreaterThan(0);
      const animated = await sharp(path, { animated: true }).metadata();
      expect(animated.pages).toBeGreaterThan(1);
      expect(statSync(resolve(`public/portada-b/i-${name}.gif`)).size).toBeGreaterThan(0);
    }
    expect(source).not.toContain('seedance-');
  });

  it('preserves reduced motion and viewport loading', () => {
    expect(source).toContain('tile.animation && !reduced && cerca');
    expect(source).toContain('io.disconnect()');
    expect(source).toContain("tile.animation.replace(/\\.webp$/, '.gif')");
  });
});
