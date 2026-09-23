import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const source = readFileSync(
  resolve('src/components/landing/v4/cards.tsx'),
  'utf8'
);

describe('reviewed landing media', () => {
  it('retains thirteen cards and five animated sections', () => {
    expect(source.match(/key: 'sec/g)).toHaveLength(13);
    expect(source.match(/animation: '\/portada-b\//g)).toHaveLength(5);
    expect(source).toContain('/portada-b/i-campanas.webp');
    expect(source).toContain('/portada-b/i-roas.webp');
  });

  it('ships lightweight real animations with static fallbacks', async () => {
    let total = 0;
    for (const name of ['sales', 'recovery', 'setup']) {
      const path = resolve(`public/portada-b/seedance-${name}.webp`);
      total += statSync(path).size;
      const animated = await sharp(path, { animated: true }).metadata();
      expect(animated.width).toBe(800);
      expect(animated.pages).toBeGreaterThan(50);
      const poster = await sharp(
        resolve(`public/portada-b/seedance-${name}.jpg`)
      ).metadata();
      expect(poster.width).toBe(1200);
    }
    expect(total).toBeLessThan(2_000_000);
  });

  it('preserves reduced motion and viewport loading', () => {
    expect(source).toContain('tile.animation && !reduced && cerca');
    expect(source).toContain('io.disconnect()');
    expect(source).toMatch(/tile\.staticFallback\s*\?\s*tile\.img/);
  });
});
